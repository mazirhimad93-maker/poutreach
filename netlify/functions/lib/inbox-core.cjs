const { createClient } = require('@supabase/supabase-js');
const crypto = require('node:crypto');
const net = require('node:net');
const dns = require('node:dns').promises;
const nodemailer = require('nodemailer');

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function problem(status, message) {
  return Object.assign(new Error(message), { status });
}

function result(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

async function context(event) {
  const url =
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    'https://zhlaaaysvzqixnugqbna.supabase.co';

  // The anon key is intentionally public and is also used by the browser app.
  // The authenticated user's JWT below is what enforces RLS.
  const key =
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpobGFhYXlzdnpxaXhudWdxYm5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE0MDYwOTUsImV4cCI6MjA2Njk4MjA5NX0.oS03M7cfw3JiQObDL5uwvTPc1F54awaOfdmqUBcIVTc';

  const token = (event.headers?.authorization || event.headers?.Authorization || '')
    .replace(/^Bearer\s+/i, '');

  if (!token) throw problem(401, 'Please sign in again.');

  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: 'Bearer ' + token } },
  });

  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) throw problem(401, 'Please sign in again.');

  return { db, uid: data.user.id };
}

async function checked(query) {
  const { data, error } = await query;
  if (error) throw problem(503, 'Inbox data is unavailable. Check the database installation.');
  return data;
}

async function channel(ctx, id) {
  if (!uuid.test(id || '')) throw problem(400, 'A connected sender is required.');

  const row = await checked(
    ctx.db
      .from('channels')
      .select('*')
      .eq('id', id)
      .eq('user_id', ctx.uid)
      .eq('channel_type', 'email')
      .maybeSingle()
  );

  if (!row) throw problem(404, 'Sender not found for this account.');
  return row;
}

const address = v => typeof v === 'string' ? v.trim().toLowerCase() : '';

function sender(row) {
  return address(
    row?.sender_id ||
    row?.credentials?.email_address ||
    row?.credentials?.smtp_username ||
    row?.credentials?.smtp_user ||
    row?.credentials?.email_username
  );
}

function headersafe(v) {
  return typeof v === 'string' && !/[\r\n]/.test(v);
}

function email(v) {
  return headersafe(v) && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(v);
}

function publicIP(ip) {
  if (net.isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }

  return net.isIP(ip) === 6 && /^[23][0-9a-f]{3}:/i.test(ip);
}

async function mailHost(host) {
  if (typeof host !== 'string' || !host || /[\s/:]/.test(host)) {
    throw problem(400, 'Invalid mail server hostname.');
  }

  const ips = await dns.lookup(host, { all: true });

  if (!ips.length || ips.some(r => !publicIP(r.address))) {
    throw problem(400, 'Mail server must resolve to a public address.');
  }

  return { host: ips[0].address, servername: host };
}

function stableUuid(seed) {
  const hex = crypto.createHash('sha256').update(String(seed)).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  const variant = parseInt(hex[16], 16);
  hex[16] = ((variant & 0x3) | 0x8).toString(16);
  const s = hex.join('');
  return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;
}

function smtpCredentials(ch) {
  const c = ch?.credentials || {};
  return {
    host: c.smtp_host || c.outgoing_server || '',
    port: Number(c.smtp_port || 465),
    username: c.smtp_username || c.smtp_user || c.email_username || c.username || '',
    password: c.smtp_password || c.smtp_pass || c.email_password || c.mailbox_password || c.password || '',
  };
}

function imapCredentials(ch) {
  const c = ch?.credentials || {};
  return {
    host: c.imap_host || c.incoming_server || c.smtp_host || '',
    port: Number(c.imap_port || 993),
    username: c.imap_username || c.email_username || c.username || ch?.sender_id || '',
    password: c.imap_password || c.email_password || c.mailbox_password || c.password || '',
  };
}

async function mapsForRows(ctx, rows) {
  const leadIds = [...new Set(rows.map(r => r.lead_id).filter(Boolean))];
  const campaignIds = [...new Set(rows.map(r => r.campaign_id).filter(Boolean))];
  const channelIds = [...new Set(rows.map(r => r.channel_id).filter(Boolean))];

  const [leads, campaigns, channels] = await Promise.all([
    leadIds.length
      ? checked(
          ctx.db
            .from('uploaded_leads')
            .select('id,name,email,campaign_id')
            .eq('user_id', ctx.uid)
            .in('id', leadIds)
        )
      : [],
    campaignIds.length
      ? checked(
          ctx.db
            .from('campaigns')
            .select('id,name,offer')
            .eq('user_id', ctx.uid)
            .in('id', campaignIds)
        )
      : [],
    channelIds.length
      ? checked(
          ctx.db
            .from('channels')
            .select('id,sender_id,is_active,provider,channel_type,credentials')
            .eq('user_id', ctx.uid)
            .in('id', channelIds)
        )
      : [],
  ]);

  return {
    leadMap: new Map((leads || []).map(x => [x.id, x])),
    campaignMap: new Map((campaigns || []).map(x => [x.id, x])),
    channelMap: new Map((channels || []).map(x => [x.id, x])),
  };
}

function historyToActivity(row, maps) {
  const lead = maps.leadMap.get(row.lead_id);
  const campaign = maps.campaignMap.get(row.campaign_id);
  const ch = row.channel_id ? maps.channelMap.get(row.channel_id) : null;
  const inbound = row.from_role === 'lead';
  const body = String(row.email_body || row.message || '');
  const bodyHtml = String(row.email_body_html || (/^\s*</.test(body) ? body : ''));
  const senderAddress = sender(ch);
  const attachments = Array.isArray(row.email_attachments) ? row.email_attachments : [];

  return {
    activity_id: 'history:' + row.id,
    history_id: row.id,
    channel_id: row.channel_id || null,
    campaign_id: row.campaign_id,
    lead_id: row.lead_id,
    lead_name: lead?.name || lead?.email || 'Unknown prospect',
    campaign_name: campaign?.offer || campaign?.name || 'Campaign',
    direction: inbound ? 'inbound' : 'outbound',
    status: inbound ? 'received' : 'sent',
    subject: row.email_subject || row.subject || '',
    body_text: body,
    body_html: bodyHtml,
    from_email: row.email_from || (inbound ? (lead?.email || '') : senderAddress),
    to_email: row.email_to || (inbound ? senderAddress : (lead?.email || '')),
    message_id: row.email_message_id || row.message_id || null,
    in_reply_to: row.email_in_reply_to || row.in_reply_to || row.reply_to_message_id || null,
    references: row.email_references || '',
    attachments,
    created_at: row.timestamp || row.created_at || new Date().toISOString(),
    source: inbound ? 'reply' : row.message_type === 'manual_reply' ? 'manual' : 'automation',
    error_code: null,
  };
}

async function activity(ctx, id) {
  if (!/^history:[0-9a-f-]{36}$/i.test(id || '')) {
    throw problem(400, 'Choose an email first.');
  }

  const historyId = id.split(':')[1];

  const row = await checked(
    ctx.db
      .from('conversation_history')
      .select('*')
      .eq('id', historyId)
      .maybeSingle()
  );

  if (!row) throw problem(404, 'Email not found.');

  const ownedCampaign = await checked(
    ctx.db
      .from('campaigns')
      .select('id')
      .eq('id', row.campaign_id)
      .eq('user_id', ctx.uid)
      .maybeSingle()
  );
  if (!ownedCampaign) throw problem(404, 'Email not found.');

  const maps = await mapsForRows(ctx, [row]);
  return historyToActivity(row, maps);
}

async function conversationThread(ctx, id) {
  const selected = await activity(ctx, id);

  const rows = await checked(
    ctx.db
      .from('conversation_history')
      .select('*')
      .eq('campaign_id', selected.campaign_id)
      .eq('lead_id', selected.lead_id)
      .eq('channel', 'email')
      .order('timestamp', { ascending: true })
      .order('id', { ascending: true })
      .limit(500)
  );

  const maps = await mapsForRows(ctx, rows || []);
  return (rows || []).map(row => historyToActivity(row, maps));
}

async function insertHistory(ctx, payload) {
  const rich = {
    id: payload.id || crypto.randomUUID(),
    lead_id: payload.lead_id,
    campaign_id: payload.campaign_id,
    channel: 'email',
    from_role: payload.from_role,
    message: payload.message || '',
    email_body: payload.email_body || payload.message || '',
    email_body_html: payload.email_body_html || null,
    timestamp: payload.timestamp || new Date().toISOString(),
    channel_id: payload.channel_id || null,
    email_subject: payload.email_subject || '',
    email_message_id: payload.email_message_id || null,
    email_from: payload.email_from || null,
    email_to: payload.email_to || null,
    email_in_reply_to: payload.email_in_reply_to || null,
    email_references: payload.email_references || null,
    email_attachments: payload.email_attachments || [],
    message_type: payload.message_type || (payload.from_role === 'lead' ? 'inbound_reply' : 'outbound'),
  };

  let attempt = await ctx.db
    .from('conversation_history')
    .upsert(rich, { onConflict: 'id' })
    .select('*')
    .maybeSingle();

  if (!attempt.error) return attempt.data;

  const fallback = {
    id: rich.id,
    lead_id: rich.lead_id,
    campaign_id: rich.campaign_id,
    channel: 'email',
    from_role: rich.from_role,
    message: rich.message,
    timestamp: rich.timestamp,
  };

  attempt = await ctx.db
    .from('conversation_history')
    .upsert(fallback, { onConflict: 'id' })
    .select('*')
    .maybeSingle();

  if (attempt.error) return null;
  return attempt.data;
}

async function legacyLog(ctx, row) {
  const saved = await insertHistory(ctx, {
    id: row.id || stableUuid(row.message_id || row.source_key || crypto.randomUUID()),
    lead_id: row.lead_id,
    campaign_id: row.campaign_id,
    channel_id: row.channel_id,
    from_role: row.direction === 'inbound' ? 'lead' : 'ai',
    message: row.body_text || '',
    timestamp: row.created_at || new Date().toISOString(),
    email_subject: row.subject || '',
    email_message_id: row.message_id || null,
  });

  return Boolean(saved);
}

function sanitizeRichHtml(input) {
  let html = typeof input === 'string' ? input : '';
  if (!html) return '';
  if (html.length > 2000000) throw problem(413, 'Formatted reply is too large.');

  html = html
    .replace(/<\s*(script|iframe|object|embed|form|style)[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|iframe|object|embed|form|style)\b[^>]*\/?>/gi, '')
    .replace(/\son\w+\s*=\s*(['"])[\s\S]*?\1/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript\s*:/gi, '');

  return html;
}

function htmlToPlainText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<\/div\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .trim();
}

async function sendReply(ctx, input) {
  if (!uuid.test(input.request_id || '')) throw problem(400, 'Invalid reply request.');

  const html = sanitizeRichHtml(input.html);
  const text = (typeof input.text === 'string' ? input.text : htmlToPlainText(html)).trim();
  const rawAttachments = Array.isArray(input.attachments) ? input.attachments : [];

  if (!text && !html && !rawAttachments.length) throw problem(400, 'Write a reply or attach a file.');
  if (text.length > 20000) throw problem(400, 'Reply text must be 20,000 characters or less.');
  if (rawAttachments.length > 5) throw problem(400, 'Attach up to 5 files per reply.');

  let attachmentBytes = 0;
  const attachments = rawAttachments.map(a => {
    const filename = typeof a?.filename === 'string' ? a.filename.trim() : '';
    const contentType = typeof a?.contentType === 'string' ? a.contentType.trim() : 'application/octet-stream';
    const contentBase64 = typeof a?.contentBase64 === 'string' ? a.contentBase64 : '';

    if (!filename || filename.length > 180 || /[\r\n/\\]/.test(filename)) {
      throw problem(400, 'Invalid attachment filename.');
    }

    if (!/^[\w.+-]+\/[\w.+-]+(?:;[\w=.+-]+)?$/i.test(contentType)) {
      throw problem(400, 'Invalid attachment type.');
    }

    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64)) {
      throw problem(400, 'Invalid attachment data.');
    }

    const content = Buffer.from(contentBase64, 'base64');
    attachmentBytes += content.length;

    if (attachmentBytes > 3000000) {
      throw problem(413, 'Attachments must be 3 MB total or less.');
    }

    return { filename, contentType, content };
  });

  const attachmentMetadata = attachments.map(a => ({
    filename: a.filename,
    contentType: a.contentType,
    size: a.content.length,
  }));

  const existing = await checked(
    ctx.db
      .from('conversation_history')
      .select('id')
      .eq('id', input.request_id)
      .maybeSingle()
  );

  if (existing) return { status: 'sent', duplicate: true };

  const target = await activity(ctx, input.activity_id);
  if (!['sent', 'received'].includes(target.status)) {
    throw problem(409, 'This email has no confirmed send/receive result.');
  }

  let ch = target.channel_id ? await channel(ctx, target.channel_id) : null;

  if (!ch && target.lead_id && target.campaign_id) {
    const progress = await checked(
      ctx.db
        .from('lead_sequence_progress')
        .select('channel_id,last_contacted_at')
        .eq('lead_id', target.lead_id)
        .eq('campaign_id', target.campaign_id)
        .not('channel_id', 'is', null)
        .order('last_contacted_at', { ascending: false })
        .limit(1)
    );

    if (progress?.[0]?.channel_id) ch = await channel(ctx, progress[0].channel_id);
  }

  if (!ch) throw problem(409, 'The original sender inbox could not be identified.');
  if (ch.is_active !== true) throw problem(409, 'The original sender is inactive.');

  const lead = await checked(
    ctx.db
      .from('uploaded_leads')
      .select('id,email,campaign_id')
      .eq('id', target.lead_id)
      .eq('user_id', ctx.uid)
      .maybeSingle()
  );

  if (!lead || lead.campaign_id !== target.campaign_id) {
    throw problem(409, 'The lead no longer matches this conversation.');
  }

  const from = sender(ch);
  const to = address(target.direction === 'inbound' ? target.from_email : lead.email);

  if (!email(from) || !email(to)) throw problem(400, 'Sender or prospect email is missing.');

  const subject = /^re:/i.test(target.subject || '')
    ? target.subject
    : 'Re: ' + (target.subject || 'BUSINESS INQUIRIES');

  if (!headersafe(subject) || subject.length > 500) throw problem(400, 'Invalid subject.');

  const smtp = smtpCredentials(ch);

  if (![465, 587].includes(smtp.port) || !smtp.password || !smtp.username || !smtp.host) {
    throw problem(400, 'The original inbox SMTP settings are incomplete.');
  }

  const resolved = await mailHost(smtp.host);
  const messageId = '<' + crypto.randomUUID() + '@' + from.split('@')[1] + '>';

  const transport = nodemailer.createTransport({
    host: resolved.host,
    port: smtp.port,
    secure: smtp.port === 465,
    requireTLS: smtp.port !== 465,
    tls: {
      servername: resolved.servername,
      rejectUnauthorized: true,
    },
    auth: {
      user: smtp.username,
      pass: smtp.password,
    },
    connectionTimeout: 7000,
    greetingTimeout: 7000,
    socketTimeout: 10000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });

  let status = 'unknown';

  try {
    const sendOptions = {
      from,
      to,
      subject,
      text,
      ...(html ? { html, attachDataUrls: true } : {}),
      attachments,
      messageId,
      disableFileAccess: true,
      disableUrlAccess: true,
    };

    if (/^<[^<>\s]+@[^<>\s]+>$/.test(target.message_id || '')) {
      sendOptions.inReplyTo = target.message_id;
      const previousRefs = String(target.references || '')
        .split(/\s+/)
        .filter(v => /^<[^<>\s]+@[^<>\s]+>$/.test(v));
      sendOptions.references = [...previousRefs, target.message_id].slice(-30);
    }

    const info = await transport.sendMail(sendOptions);
    status = Array.isArray(info.accepted) && info.accepted.length > 0 ? 'sent' : 'failed';
  } catch (e) {
    status = ['EAUTH', 'EENVELOPE', 'EDNS', 'ECONNECTION'].includes(e.code) ? 'failed' : 'unknown';
  } finally {
    transport.close();
  }

  if (status === 'sent' || status === 'unknown') {
    await insertHistory(ctx, {
      id: input.request_id,
      lead_id: target.lead_id,
      campaign_id: target.campaign_id,
      channel_id: ch.id,
      from_role: 'ai',
      message: text || '[attachment reply]',
      email_body: text || '[attachment reply]',
      email_body_html: html || null,
      timestamp: new Date().toISOString(),
      email_subject: subject,
      email_message_id: messageId,
      email_from: from,
      email_to: to,
      email_in_reply_to: target.message_id || null,
      email_references: String(target.references || target.message_id || ''),
      email_attachments: attachmentMetadata,
      message_type: 'manual_reply',
    });
  }

  return {
    status,
    historySaved: status === 'sent',
    from,
    to,
    attachmentCount: attachments.length,
    messageId,
    activityId: 'history:' + input.request_id,
  };
}

module.exports = {
  context,
  result,
  problem,
  checked,
  channel,
  sender,
  address,
  email,
  publicIP,
  mailHost,
  stableUuid,
  smtpCredentials,
  imapCredentials,
  mapsForRows,
  historyToActivity,
  activity,
  conversationThread,
  insertHistory,
  legacyLog,
  sendReply,
};
