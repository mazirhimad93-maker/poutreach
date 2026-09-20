const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const core = require('./lib/inbox-core.cjs');

function ids(parsed) {
  return [
    ...new Set(
      [
        parsed.inReplyTo,
        ...(Array.isArray(parsed.references)
          ? parsed.references
          : [parsed.references]),
      ].filter(
        v =>
          typeof v === 'string' &&
          /^<[^<>\s]+@[^<>\s]+>$/.test(v)
      )
    ),
  ].slice(-30);
}

function isWarmup(parsed) {
  const subject = String(parsed.subject || '');
  const text = String(parsed.text || '');
  const combined = subject + '\n' + text;

  if (/\bJWEFBSA\b/i.test(combined)) return true;

  if (/\|\s*[A-Z0-9]{6,12}\s+[A-Z]{5,12}\s*$/i.test(subject)) {
    return true;
  }

  if (/\b(?:warm[- ]?up|mailwarm|instantly warmup)\b/i.test(combined)) {
    return true;
  }

  return false;
}

function isReply(parsed) {
  return /^\s*re\s*:/i.test(String(parsed.subject || ''));
}

function addresses(field) {
  if (!field?.value || !Array.isArray(field.value)) return [];

  return field.value
    .map(v => core.address(v.address))
    .filter(core.email);
}

function headerText(parsed, name) {
  const value = parsed?.headers?.get?.(name);
  if (!value) return '';

  if (typeof value === 'string') return value;

  if (Array.isArray(value)) {
    return value
      .map(v => typeof v === 'string' ? v : (v?.value || v?.text || ''))
      .join(' ');
  }

  return String(value?.value || value?.text || '');
}

function headerAddresses(parsed) {
  const candidates = [
    headerText(parsed, 'delivered-to'),
    headerText(parsed, 'x-original-to'),
    headerText(parsed, 'envelope-to'),
    headerText(parsed, 'x-envelope-to'),
  ];

  const found = [];

  for (const value of candidates) {
    const matches = String(value).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
    for (const email of matches) {
      const normalized = core.address(email);
      if (core.email(normalized)) found.push(normalized);
    }
  }

  return [...new Set(found)];
}

async function inferChannel(ctx, parsed, allowedChannels) {
  const recipients = [
    ...addresses(parsed.to),
    ...addresses(parsed.cc),
    ...headerAddresses(parsed),
  ];

  const map = new Map(
    allowedChannels
      .map(ch => [core.sender(ch), ch])
      .filter(([email]) => core.email(email))
  );

  for (const recipient of recipients) {
    if (map.has(recipient)) return map.get(recipient);
  }

  return null;
}

async function match(ctx, parsed, allowedChannels) {
  const refs = ids(parsed);

  if (refs.length) {
    const { data, error } = await ctx.db
      .from('conversation_history')
      .select('lead_id,campaign_id,channel_id,email_message_id,timestamp')
      .eq('channel', 'email')
      .eq('from_role', 'ai')
      .in('email_message_id', refs)
      .order('timestamp', { ascending: false })
      .limit(100);

    if (!error && data?.length) {
      const unique = new Map(
        data.map(row => [row.lead_id + ':' + row.campaign_id, row])
      );

      if (unique.size === 1) {
        const row = [...unique.values()][0];
        return {
          lead_id: row.lead_id,
          campaign_id: row.campaign_id,
          channel_id: row.channel_id,
        };
      }
    }
  }

  const from = core.address(parsed.from?.value?.[0]?.address);
  if (!core.email(from)) return null;

  const leads = await core.checked(
    ctx.db
      .from('uploaded_leads')
      .select('id,campaign_id,email')
      .eq('user_id', ctx.uid)
      .ilike('email', from)
      .limit(50)
  );

  if (!leads?.length) return null;

  const originalChannel = await inferChannel(ctx, parsed, allowedChannels);

  if (originalChannel) {
    if (leads.length === 1) {
      return {
        lead_id: leads[0].id,
        campaign_id: leads[0].campaign_id,
        channel_id: originalChannel.id,
      };
    }

    const leadIds = leads.map(lead => lead.id);

    const { data, error } = await ctx.db
      .from('conversation_history')
      .select('lead_id,campaign_id,channel_id,timestamp')
      .eq('channel', 'email')
      .eq('from_role', 'ai')
      .eq('channel_id', originalChannel.id)
      .in('lead_id', leadIds)
      .order('timestamp', { ascending: false })
      .limit(50);

    if (!error && data?.length) {
      const first = data[0];
      return {
        lead_id: first.lead_id,
        campaign_id: first.campaign_id,
        channel_id: originalChannel.id,
      };
    }

    return {
      lead_id: leads[0].id,
      campaign_id: leads[0].campaign_id,
      channel_id: originalChannel.id,
    };
  }

  if (leads.length === 1) {
    const lead = leads[0];

    const { data: history } = await ctx.db
      .from('conversation_history')
      .select('channel_id,timestamp')
      .eq('channel', 'email')
      .eq('from_role', 'ai')
      .eq('lead_id', lead.id)
      .not('channel_id', 'is', null)
      .order('timestamp', { ascending: false })
      .limit(1);

    if (history?.[0]?.channel_id) {
      return {
        lead_id: lead.id,
        campaign_id: lead.campaign_id,
        channel_id: history[0].channel_id,
      };
    }

    const { data: progress } = await ctx.db
      .from('lead_sequence_progress')
      .select('channel_id,last_contacted_at')
      .eq('lead_id', lead.id)
      .eq('campaign_id', lead.campaign_id)
      .not('channel_id', 'is', null)
      .order('last_contacted_at', { ascending: false })
      .limit(1);

    if (progress?.[0]?.channel_id) {
      return {
        lead_id: lead.id,
        campaign_id: lead.campaign_id,
        channel_id: progress[0].channel_id,
      };
    }
  }

  return null;
}

function chooseFolders(list) {
  const folders = list || [];
  const replies = [];
  const inboxes = [];
  const junk = [];
  const seen = new Set();

  const push = (bucket, path) => {
    if (!path || seen.has(path)) return;
    seen.add(path);
    bucket.push(path);
  };

  for (const folder of folders) {
    const path = String(folder.path || '');
    const low = path.toLowerCase();
    const special = String(folder.specialUse || '').toLowerCase();
    const leaf = low.split(/[/.]/).pop();

    if (leaf === 'replies' || low.includes('/replies') || low.includes('.replies')) {
      push(replies, path);
      continue;
    }

    if (low === 'inbox') {
      push(inboxes, path);
      continue;
    }

    if (
      leaf === 'junk' ||
      leaf === 'spam' ||
      low.includes('junk e-mail') ||
      special.includes('junk')
    ) {
      push(junk, path);
    }
  }

  if (!inboxes.length) push(inboxes, 'INBOX');

  // The manually-created Replies folder contains the highest-value historical
  // replies, so scan it before the high-volume Inbox/Junk folders.
  return [...replies, ...inboxes, ...junk];
}

exports.handler = async event => {
  let client;

  try {
    if (event.httpMethod !== 'POST') {
      return core.result(405, { error: 'Method not allowed' });
    }

    const ctx = await core.context(event);

    const channels = await core.checked(
      ctx.db
        .from('channels')
        .select('*')
        .eq('user_id', ctx.uid)
        .eq('channel_type', 'email')
        .limit(2000)
    );

    const allowedChannels = (channels || []).filter(ch => {
      const provider = String(ch.provider || '').toLowerCase();
      const sender = String(ch.sender_id || '').toLowerCase();
      const name = String(ch.name || '').toLowerCase();
      const gmailLike = provider === 'gmail' || sender.endsWith('@gmail.com') || name.includes('gmail');

      return (
        !gmailLike &&
        ch.is_active === true &&
        core.email(core.sender(ch))
      );
    });

    if (!allowedChannels.length) {
      return core.result(200, {
        imported: 0,
        warmups: 0,
        unmatched: 0,
        skipped: 0,
        duplicates: 0,
        folders: [],
        scanned: 0,
      });
    }

    const masterAddress = core.address(
      process.env.MASTER_IMAP_USERNAME ||
      'master@hellonanakifriends.shop'
    );

    const masterChannel = (channels || []).find(
      ch => core.sender(ch) === masterAddress
    );

    const masterCreds = core.imapCredentials(masterChannel || {});

    // Current SiteGround mailboxes share the same mailbox credential. If the
    // dedicated master channel is not present in this app, reuse the password
    // already stored on one of the connected SiteGround sender inboxes. The
    // password never leaves the server and is never committed to the repo.
    const credentialDonor = allowedChannels.find(ch => {
      const creds = core.imapCredentials(ch);
      const addr = core.sender(ch);
      return (
        creds.password &&
        (
          addr.endsWith('@hellonanakifriends.shop') ||
          creds.host === 'mail.hellonanakifriends.shop'
        )
      );
    }) || allowedChannels.find(ch => core.imapCredentials(ch).password);

    const donorCreds = core.imapCredentials(credentialDonor || {});

    const host =
      masterCreds.host ||
      process.env.MASTER_IMAP_HOST ||
      'mail.hellonanakifriends.shop';

    const username =
      masterCreds.username ||
      process.env.MASTER_IMAP_USERNAME ||
      masterAddress;

    const password =
      masterCreds.password ||
      process.env.MASTER_IMAP_PASSWORD ||
      donorCreds.password ||
      '';

    const port = Number(
      masterCreds.port ||
      process.env.MASTER_IMAP_PORT ||
      993
    );

    if (!password) {
      throw core.problem(
        503,
        'No stored SiteGround mailbox password is available to open the master inbox.'
      );
    }

    if (port !== 993) {
      throw core.problem(
        400,
        'Master inbox must use secure IMAP port 993.'
      );
    }

    const resolved = await core.mailHost(host);

    client = new ImapFlow({
      host: resolved.host,
      port: 993,
      secure: true,
      tls: {
        servername: resolved.servername,
        rejectUnauthorized: true,
      },
      auth: {
        user: username,
        pass: password,
      },
      logger: false,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });

    await client.connect();

    const folderList = await client.list();
    const folders = chooseFolders(folderList);

    let imported = 0;
    let warmups = 0;
    let unmatched = 0;
    let skipped = 0;
    let duplicates = 0;
    let scanned = 0;

    const folderStats = [];
    const started = Date.now();

    for (const folder of folders) {
      if (Date.now() - started > 22000) break;

      await client.mailboxOpen(folder, { readOnly: true });

      const isRepliesFolder =
        String(folder).toLowerCase().split(/[/.]/).pop() === 'replies';

      const search = isRepliesFolder
        ? { all: true }
        : {
            since: new Date(
              Date.now() -
              Math.max(
                7,
                Math.min(
                  Number(process.env.MASTER_IMAP_LOOKBACK_DAYS || 60),
                  180
                )
              ) *
              86400000
            ),
            subject: 'Re:'
          };

      const found = (
        (await client.search(search, { uid: true })) || []
      ).sort((a, b) => b - a);

      const selected = found.slice(
        0,
        isRepliesFolder ? 250 : 150
      );

      let folderImported = 0;
      let folderScanned = 0;

      for (const uid of selected) {
        if (Date.now() - started > 22000) break;

        const meta = await client.fetchOne(
          String(uid),
          { size: true },
          { uid: true }
        );

        if (!meta) continue;

        if (meta.size > 2000000) {
          skipped++;
          continue;
        }

        const message = await client.fetchOne(
          String(uid),
          { source: true },
          { uid: true }
        );

        if (!message?.source) {
          skipped++;
          continue;
        }

        folderScanned++;
        scanned++;

        const parsed = await simpleParser(
          message.source,
          { skipImageLinks: true }
        );

        if (isWarmup(parsed)) {
          warmups++;
          continue;
        }

        const matched = await match(
          ctx,
          parsed,
          allowedChannels
        );

        if (!matched?.channel_id) {
          unmatched++;
          continue;
        }

        const from = core.address(
          parsed.from?.value?.[0]?.address
        );

        if (!core.email(from)) {
          skipped++;
          continue;
        }

        const messageKey =
          parsed.messageId ||
          `${folder}:${uid}:${from}:${parsed.subject || ''}`;

        const historyId = core.stableUuid(
          'master-imap:' + messageKey
        );

        const existing = await core.checked(
          ctx.db
            .from('conversation_history')
            .select('id')
            .eq('id', historyId)
            .maybeSingle()
        );

        if (existing) {
          duplicates++;
          continue;
        }

        const saved = await core.insertHistory(ctx, {
          id: historyId,
          lead_id: matched.lead_id,
          campaign_id: matched.campaign_id,
          channel_id: matched.channel_id,
          from_role: 'lead',
          message: String(parsed.text || '').slice(0, 100000),
          timestamp:
            parsed.date &&
            Number.isFinite(parsed.date.getTime())
              ? parsed.date.toISOString()
              : new Date().toISOString(),
          email_subject: String(parsed.subject || '').slice(0, 500),
          email_message_id: parsed.messageId || null,
        });

        if (!saved) {
          skipped++;
          continue;
        }

        imported++;
        folderImported++;
      }

      folderStats.push({
        folder,
        scanned: folderScanned,
        imported: folderImported,
        available: found.length,
        more: found.length > selected.length,
      });
    }

    return core.result(200, {
      imported,
      warmups,
      unmatched,
      skipped,
      duplicates,
      scanned,
      folders: folderStats,
      folderNames: folders,
      more: folderStats.some(f => f.more),
    });
  } catch (e) {
    return core.result(
      e.status || 502,
      {
        error:
          e.status
            ? e.message
            : 'Could not sync the master inbox folders.',
      }
    );
  } finally {
    if (client) {
      try {
        await client.logout();
      } catch {
        client.close();
      }
    }
  }
};

exports.match = match;
exports.isWarmup = isWarmup;
exports.chooseFolders = chooseFolders;
