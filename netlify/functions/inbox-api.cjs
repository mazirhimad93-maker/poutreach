const core = require('./lib/inbox-core.cjs');

function parseDateRange(p) {
  const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  const start = valid(p.start) ? String(p.start) : '';
  const end = valid(p.end) ? String(p.end) : start;
  if (!start) return null;

  const a = start <= end ? start : end;
  const b = start <= end ? end : start;
  const endExclusive = new Date(b + 'T00:00:00.000Z');
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

  return {
    start: a + 'T00:00:00.000Z',
    endExclusive: endExclusive.toISOString(),
  };
}

function csvSafeText(value) {
  return String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

async function listMessages(ctx, p) {
  const ownedCampaigns = await core.checked(
    ctx.db
      .from('campaigns')
      .select('id')
      .eq('user_id', ctx.uid)
      .limit(5000)
  );
  const campaignIds = (ownedCampaigns || []).map(row => row.id);
  if (!campaignIds.length) {
    return { messages: [], more: false, snapshot: new Date().toISOString(), total: 0 };
  }

  const offset = Math.max(0, Math.min(Number(p.offset) || 0, 1000000));
  const snapshot =
    p.snapshot && Number.isFinite(Date.parse(p.snapshot))
      ? new Date(p.snapshot).toISOString()
      : new Date().toISOString();

  let q = ctx.db
    .from('conversation_history')
    .select('*', { count: 'exact' })
    .eq('channel', 'email')
    .in('campaign_id', campaignIds)
    .lte('timestamp', snapshot);

  if (p.direction === 'inbound') q = q.eq('from_role', 'lead');
  if (p.direction === 'outbound') q = q.eq('from_role', 'ai');
  if (p.campaign) q = q.eq('campaign_id', p.campaign);
  if (p.channel) q = q.eq('channel_id', p.channel);

  if (p.replyable === '1') {
    q = q.eq('from_role', 'lead').not('channel_id', 'is', null);
  }

  const dateRange = parseDateRange(p);
  if (dateRange) {
    q = q.gte('timestamp', dateRange.start).lt('timestamp', dateRange.endExclusive);
  }

  const fetchSize = p.search ? 200 : 51;
  const start = p.search ? 0 : offset;
  const end = start + fetchSize - 1;

  const page = await q
    .order('timestamp', { ascending: false })
    .order('id', { ascending: false })
    .range(start, end);

  if (page.error) {
    throw core.problem(
      503,
      'Inbox data is unavailable. Check the email history database fields.'
    );
  }

  let rows = page.data || [];
  const maps = await core.mapsForRows(ctx, rows);
  let messages = rows.map(row => core.historyToActivity(row, maps));

  if (p.search) {
    const needle = String(p.search || '').trim().toLowerCase();
    if (needle) {
      messages = messages.filter(message =>
        [
          message.lead_name,
          message.subject,
          message.from_email,
          message.to_email,
          message.body_text,
          message.campaign_name,
        ]
          .join(' ')
          .toLowerCase()
          .includes(needle)
      );
    }

    messages = messages.slice(offset, offset + 50);
  } else {
    messages = messages.slice(0, 50);
  }

  return {
    messages: messages.map(r => ({
      ...r,
      body_text: String(r.body_text || '').slice(0, 350),
      body_html: '',
    })),
    more: p.search
      ? messages.length === 50
      : rows.length > 50,
    snapshot,
    total: p.search ? messages.length : (page.count || 0),
  };
}


async function exportConversations(ctx, p) {
  const ownedCampaigns = await core.checked(
    ctx.db
      .from('campaigns')
      .select('id,name,offer')
      .eq('user_id', ctx.uid)
      .limit(5000)
  );

  const campaignMap = new Map((ownedCampaigns || []).map(row => [row.id, row]));
  let campaignIds = (ownedCampaigns || []).map(row => row.id);
  if (p.campaign) {
    campaignIds = campaignIds.filter(id => id === p.campaign);
  }
  if (!campaignIds.length) return { conversations: [], count: 0 };

  let q = ctx.db
    .from('conversation_history')
    .select('*')
    .eq('channel', 'email')
    .eq('from_role', 'lead')
    .in('campaign_id', campaignIds)
    .order('timestamp', { ascending: false })
    .order('id', { ascending: false })
    .limit(5000);

  if (p.channel) q = q.eq('channel_id', p.channel);

  const dateRange = parseDateRange(p);
  if (dateRange) {
    q = q.gte('timestamp', dateRange.start).lt('timestamp', dateRange.endExclusive);
  }

  const rawIds = String(p.ids || '')
    .split(',')
    .map(value => value.replace(/^history:/, '').trim())
    .filter(value => /^[0-9a-f-]{36}$/i.test(value))
    .slice(0, 1000);

  if (rawIds.length) q = q.in('id', rawIds);

  const inboundRows = await core.checked(q);
  if (!inboundRows.length) return { conversations: [], count: 0 };

  const inboundMaps = await core.mapsForRows(ctx, inboundRows);
  let inbound = inboundRows.map(row => core.historyToActivity(row, inboundMaps));

  const needle = String(p.search || '').trim().toLowerCase();
  if (needle) {
    inbound = inbound.filter(message =>
      [
        message.lead_name,
        message.subject,
        message.from_email,
        message.to_email,
        message.body_text,
        message.campaign_name,
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    );
  }

  if (!inbound.length) return { conversations: [], count: 0 };

  const selectedKeys = new Map();
  for (const message of inbound) {
    if (!message.lead_id || !message.campaign_id) continue;
    const key = message.campaign_id + ':' + message.lead_id;
    const current = selectedKeys.get(key) || {
      campaign_id: message.campaign_id,
      lead_id: message.lead_id,
      replies: [],
    };
    current.replies.push(message);
    selectedKeys.set(key, current);
  }

  const leadIds = [...new Set([...selectedKeys.values()].map(item => item.lead_id))];
  const threadRows = [];
  for (let i = 0; i < leadIds.length; i += 100) {
    const ids = leadIds.slice(i, i + 100);
    const rows = await core.checked(
      ctx.db
        .from('conversation_history')
        .select('*')
        .eq('channel', 'email')
        .in('campaign_id', campaignIds)
        .in('lead_id', ids)
        .order('timestamp', { ascending: true })
        .order('id', { ascending: true })
        .limit(5000)
    );
    threadRows.push(...(rows || []));
  }

  const threadMaps = await core.mapsForRows(ctx, threadRows);
  const threadMessages = threadRows.map(row => core.historyToActivity(row, threadMaps));
  const threadsByKey = new Map();

  for (const message of threadMessages) {
    const key = message.campaign_id + ':' + message.lead_id;
    if (!selectedKeys.has(key)) continue;
    const list = threadsByKey.get(key) || [];
    list.push(message);
    threadsByKey.set(key, list);
  }

  const conversations = [...selectedKeys.entries()].map(([key, selected]) => {
    const messages = (threadsByKey.get(key) || []).sort(
      (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)
    );
    const replies = selected.replies.sort(
      (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)
    );
    const campaign = campaignMap.get(selected.campaign_id);
    const firstReply = replies[0];
    const lastReply = replies[replies.length - 1];
    const subject =
      [...messages].reverse().find(message => message.subject)?.subject ||
      lastReply?.subject ||
      firstReply?.subject ||
      '';

    const transcript = messages
      .map(message => {
        const who = message.direction === 'inbound' ? 'Prospect' : 'You';
        return [
          '[' + new Date(message.created_at).toISOString() + '] ' + who,
          'From: ' + (message.from_email || ''),
          'To: ' + (message.to_email || ''),
          message.subject ? 'Subject: ' + message.subject : '',
          csvSafeText(message.body_text),
        ]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n\n---\n\n');

    return {
      conversation_key: key,
      campaign_id: selected.campaign_id,
      campaign_name: campaign?.offer || campaign?.name || firstReply?.campaign_name || 'Campaign',
      lead_id: selected.lead_id,
      prospect_name: firstReply?.lead_name || lastReply?.lead_name || 'Unknown prospect',
      prospect_email:
        firstReply?.from_email ||
        lastReply?.from_email ||
        messages.find(message => message.direction === 'inbound')?.from_email ||
        '',
      sender_inbox:
        firstReply?.to_email ||
        lastReply?.to_email ||
        messages.find(message => message.direction === 'outbound')?.from_email ||
        '',
      subject,
      selected_reply_count: replies.length,
      first_selected_reply_at: firstReply?.created_at || '',
      last_selected_reply_at: lastReply?.created_at || '',
      message_count: messages.length,
      transcript,
      messages: messages.map(message => ({
        timestamp: message.created_at,
        direction: message.direction,
        from: message.from_email,
        to: message.to_email,
        subject: message.subject,
        body: csvSafeText(message.body_text),
      })),
    };
  });

  conversations.sort((a, b) =>
    Date.parse(b.last_selected_reply_at || '1970-01-01') -
    Date.parse(a.last_selected_reply_at || '1970-01-01')
  );

  return { conversations, count: conversations.length };
}

exports.handler = async event => {
  try {
    if (!['GET', 'POST'].includes(event.httpMethod)) {
      return core.result(405, { error: 'Method not allowed' });
    }

    const ctx = await core.context(event);

    if (event.httpMethod === 'POST') {
      if (Buffer.byteLength(event.body || '') > 4500000) {
        throw core.problem(413, 'Reply and attachments are too large.');
      }

      let body;
      try {
        body = JSON.parse(event.body || '{}');
      } catch {
        throw core.problem(400, 'Invalid request.');
      }

      return core.result(200, await core.sendReply(ctx, body));
    }

    const p = event.queryStringParameters || {};

    if (p.id) {
      const [message, thread] = await Promise.all([
        core.activity(ctx, p.id),
        core.conversationThread(ctx, p.id),
      ]);
      return core.result(200, { message, thread });
    }

    if (p.export === '1') {
      return core.result(200, await exportConversations(ctx, p));
    }

    if (p.channels === '1') {
      const rows = await core.checked(
        ctx.db
          .from('channels')
          .select('id,name,sender_id,is_active,provider,credentials,max_usage,channel_type')
          .eq('user_id', ctx.uid)
          .eq('channel_type', 'email')
          .order('sender_id')
          .limit(2000)
      );

      const gmailRows = (rows || []).filter(row => {
        const provider = String(row.provider || '').toLowerCase();
        const sender = String(row.sender_id || '').toLowerCase();
        const name = String(row.name || '').toLowerCase();
        const emailProvider = String(row.credentials?.email_provider || '').toLowerCase();
        return provider === 'gmail' || emailProvider === 'gmail' || sender.endsWith('@gmail.com') || name.includes('gmail');
      });

      if (gmailRows.length) {
        const gmailIds = gmailRows.map(row => row.id).filter(Boolean);
        const deletion = await ctx.db
          .from('channels')
          .delete()
          .eq('user_id', ctx.uid)
          .in('id', gmailIds);

        if (deletion.error) {
          throw core.problem(503, 'Could not remove the unused Gmail channels.');
        }
      }

      const filtered = (rows || []).filter(row => !gmailRows.some(g => g.id === row.id));

      return core.result(200, {
        channels: filtered.map(row => ({
          id: row.id,
          name: row.name,
          sender_id: row.sender_id,
          is_active: row.is_active,
        })),
        deleted_gmail_channels: gmailRows.length,
      });
    }

    return core.result(200, await listMessages(ctx, p));
  } catch (e) {
    return core.result(e.status || 500, {
      error:
        e.status
          ? e.message
          : 'Inbox request failed. No automatic send retry was performed.',
    });
  }
};

exports.listMessages = listMessages;
