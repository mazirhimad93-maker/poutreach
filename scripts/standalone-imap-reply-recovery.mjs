import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS || 14);
const OUTPUT_DIR = process.env.OUTPUT_DIR || 'reply-recovery-output';
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY GitHub secrets.');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const since = new Date(Date.now() - LOOKBACK_DAYS * 86400_000);
const rows = [];
const errors = [];
const mailboxStats = [];
const seenMailboxKeys = new Set();
const seenMessages = new Set();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clean = v => String(v ?? '').replace(/[\r\n\t]+/g, ' ').trim();
const csv = values => values.map(v => {
  const s = String(v ?? '');
  return '"' + s.replace(/"/g, '""') + '"';
}).join(',');
const writeCsv = (file, headers, data) => {
  fs.writeFileSync(path.join(OUTPUT_DIR, file), [headers, ...data].map(csv).join('\r\n'), 'utf8');
};
const addresses = list => (list || []).map(x => x.address || '').filter(Boolean);
const getCred = (c, ...keys) => {
  for (const k of keys) if (c?.[k] !== undefined && c?.[k] !== null && c?.[k] !== '') return c[k];
  return '';
};
function classify({ from, subject, text, headers, replyTo, matchedCampaign }) {
  const haystack = [from, subject, text.slice(0, 1800), headers].join(' ').toLowerCase();
  const warmSignals = [
    /mailwarm/i, /instantly/i, /warmup|warm-up|warm up/i,
    /\bjwefbsa\b/i, /\b(?:warm|warming)[-_ ]?mail\b/i
  ];
  if (warmSignals.some(re => re.test(haystack))) return { label: 'WARMUP', reason: 'Known warm-up indicator' };
  if (matchedCampaign) return { label: 'CAMPAIGN_REPLY', reason: 'Sender matched outbound email tracking' };
  if (replyTo || /\bre:\s*/i.test(subject) || /\baw:\s*/i.test(subject) || /\bfwd?:\s*/i.test(subject)) {
    if (/\b\d{3,}\b/.test(subject)) return { label: 'REVIEW', reason: 'Reply-like subject with numeric warm-up marker; needs review' };
    return { label: 'REVIEW', reason: 'Reply-like message; no confirmed campaign match' };
  }
  if (/\b\d{3,}\b/.test(subject)) return { label: 'REVIEW', reason: 'Subject contains numeric marker; not enough evidence to call warm-up' };
  return { label: 'REVIEW', reason: 'Unmatched inbound message' };
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const { data: channels, error: channelError } = await supabase
  .from('channels')
  .select('id,user_id,email_address,name,credentials')
  .eq('channel_type', 'email')
  .eq('is_active', true);
if (channelError) throw new Error('Could not load active email channels: ' + channelError.message);

const unique = [];
for (const ch of channels || []) {
  const c = ch.credentials || {};
  const host = getCred(c, 'imap_host', 'imapHost');
  const username = getCred(c, 'imap_username', 'imapUsername', 'email_username') || ch.email_address;
  const password = getCred(c, 'imap_password', 'imapPassword', 'email_password');
  const port = Number(getCred(c, 'imap_port', 'imapPort') || 993);
  if (!host || !username || !password) {
    errors.push({ mailbox: ch.email_address || ch.name || ch.id, folder: '', error: 'Missing IMAP host, username, or password in stored credentials' });
    continue;
  }
  const key = (String(host).toLowerCase() + '|' + String(username).toLowerCase());
  if (seenMailboxKeys.has(key)) continue;
  seenMailboxKeys.add(key);
  unique.push({ id: ch.id, user_id: ch.user_id, address: ch.email_address || username, name: ch.name || '', host, username, password, port, secure: getCred(c, 'imap_secure', 'imapSecure') !== false });
}

// Use tracking records to identify known campaign recipients. Never print or export credentials.
const { data: tracking, error: trackingError } = await supabase
  .from('email_tracking')
  .select('email_address,subject,sent_at,message_id,channel_id,lead_id,campaign_id')
  .gte('sent_at', new Date(Date.now() - 45 * 86400_000).toISOString())
  .limit(20000);
if (trackingError) errors.push({ mailbox: 'SUPABASE', folder: 'email_tracking', error: trackingError.message });
const tracked = new Map();
for (const item of tracking || []) {
  const key = String(item.email_address || '').toLowerCase();
  if (!key) continue;
  if (!tracked.has(key)) tracked.set(key, []);
  tracked.get(key).push(item);
}

for (const box of unique) {
  const stat = { mailbox: box.address, folders_checked: 0, messages_found: 0, campaign_replies: 0, warmup: 0, review: 0, status: 'ok' };
  const client = new ImapFlow({
    host: box.host,
    port: box.port,
    secure: box.secure,
    auth: { user: box.username, pass: box.password },
    logger: false,
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 45000
  });
  try {
    await client.connect();
    const folders = await client.list();
    const relevant = folders.filter(f => {
      const name = String(f.path || '');
      const attrs = (f.flags ? [...f.flags] : []).map(x => String(x).toLowerCase());
      if (attrs.includes('\\noselect')) return false;
      return name.toLowerCase() === 'inbox' || /repl|response|inbound/i.test(name);
    });
    const folderNames = [...new Set(relevant.map(f => f.path))];
    for (const folder of folderNames) {
      try {
        await client.mailboxOpen(folder, { readOnly: true });
        stat.folders_checked++;
        const uids = await client.search({ since }, { uid: true });
        if (!uids || !uids.length) continue;
        for await (const msg of client.fetch(uids, { uid: true, source: true, envelope: true, internalDate: true }, { uid: true })) {
          if (!msg.source) continue;
          const parsed = await simpleParser(msg.source);
          const from = addresses(parsed.from?.value).join('; ');
          const to = addresses(parsed.to?.value).join('; ');
          const subject = clean(parsed.subject);
          const messageId = clean(parsed.messageId || msg.envelope?.messageId);
          const dedupe = [box.username.toLowerCase(), messageId || folder + ':' + msg.uid].join('|');
          if (seenMessages.has(dedupe)) continue;
          seenMessages.add(dedupe);
          const fromEmails = addresses(parsed.from?.value).map(x => x.toLowerCase());
          const match = fromEmails.map(x => tracked.get(x)).find(x => x?.length)?.[0];
          const bodyText = String(parsed.text || parsed.html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
          const headers = [
            parsed.inReplyTo || '',
            Array.isArray(parsed.references) ? parsed.references.join(' ') : (parsed.references || ''),
            parsed.headers?.get('x-mailer') || '',
            parsed.headers?.get('x-lookup') || ''
          ].join(' ');
          const result = classify({
            from, subject, text: bodyText, headers,
            replyTo: parsed.inReplyTo || parsed.references,
            matchedCampaign: match
          });
          rows.push({
            received_at: (msg.internalDate || parsed.date || new Date()).toISOString?.() || String(msg.internalDate || parsed.date || ''),
            mailbox: box.address, folder, uid: msg.uid, from, to, subject,
            classification: result.label, classification_reason: result.reason,
            matched_campaign_id: match?.campaign_id || '',
            matched_lead_id: match?.lead_id || '',
            outbound_subject: match?.subject || '',
            message_id: messageId, in_reply_to: parsed.inReplyTo || '',
            body_text: bodyText, body_html: typeof parsed.html === 'string' ? parsed.html : ''
          });
          stat.messages_found++;
          if (result.label === 'CAMPAIGN_REPLY') stat.campaign_replies++;
          else if (result.label === 'WARMUP') stat.warmup++;
          else stat.review++;
        }
      } catch (err) {
        errors.push({ mailbox: box.address, folder, error: String(err?.message || err) });
      }
    }
    await client.logout();
  } catch (err) {
    stat.status = 'connection_failed';
    errors.push({ mailbox: box.address, folder: '', error: String(err?.message || err) });
    try { await client.logout(); } catch {}
  }
  mailboxStats.push(stat);
  console.log('Checked mailbox:', box.address, 'status:', stat.status, 'messages:', stat.messages_found);
  await sleep(250);
}

const headers = ['received_at','mailbox','folder','uid','from','to','subject','classification','classification_reason','matched_campaign_id','matched_lead_id','outbound_subject','message_id','in_reply_to','body_text','body_html'];
writeCsv('all_messages.csv', headers, rows.map(r => headers.map(h => r[h])));
writeCsv('campaign_replies.csv', headers, rows.filter(r => r.classification === 'CAMPAIGN_REPLY').map(r => headers.map(h => r[h])));
writeCsv('needs_review.csv', headers, rows.filter(r => r.classification === 'REVIEW').map(r => headers.map(h => r[h])));
writeCsv('warmup_messages.csv', headers, rows.filter(r => r.classification === 'WARMUP').map(r => headers.map(h => r[h])));
writeCsv('mailbox_summary.csv', ['mailbox','folders_checked','messages_found','campaign_replies','warmup','review','status'], mailboxStats.map(s => ['mailbox','folders_checked','messages_found','campaign_replies','warmup','review','status'].map(k => s[k])));
fs.writeFileSync(path.join(OUTPUT_DIR, 'summary.json'), JSON.stringify({
  generated_at: new Date().toISOString(),
  lookback_days: LOOKBACK_DAYS,
  active_channel_records: channels?.length || 0,
  unique_mailboxes_attempted: unique.length,
  messages_found: rows.length,
  campaign_replies: rows.filter(r => r.classification === 'CAMPAIGN_REPLY').length,
  warmup_messages: rows.filter(r => r.classification === 'WARMUP').length,
  needs_review: rows.filter(r => r.classification === 'REVIEW').length,
  mailbox_stats: mailboxStats,
  errors
}, null, 2));
console.log(JSON.stringify({
  active_channel_records: channels?.length || 0,
  unique_mailboxes_attempted: unique.length,
  messages_found: rows.length,
  campaign_replies: rows.filter(r => r.classification === 'CAMPAIGN_REPLY').length,
  warmup_messages: rows.filter(r => r.classification === 'WARMUP').length,
  needs_review: rows.filter(r => r.classification === 'REVIEW').length,
  mailbox_errors: errors.length
}, null, 2));
