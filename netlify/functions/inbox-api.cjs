const core = require('./lib/inbox-core.cjs');

async function listMessages(ctx, p) {
  const offset = Math.max(0, Math.min(Number(p.offset) || 0, 1000000));
  const snapshot =
    p.snapshot && Number.isFinite(Date.parse(p.snapshot))
      ? new Date(p.snapshot).toISOString()
      : new Date().toISOString();

  let q = ctx.db
    .from('conversation_history')
    .select('*', { count: 'exact' })
    .eq('channel', 'email')
    .lte('timestamp', snapshot);

  if (p.direction === 'inbound') q = q.eq('from_role', 'lead');
  if (p.direction === 'outbound') q = q.eq('from_role', 'ai');
  if (p.campaign) q = q.eq('campaign_id', p.campaign);
  if (p.channel) q = q.eq('channel_id', p.channel);

  if (p.replyable === '1') {
    q = q.eq('from_role', 'lead').not('channel_id', 'is', null);
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

      if (filtered.some(row => Number(row.max_usage) !== 10)) {
        const limitUpdate = await ctx.db
          .from('channels')
          .update({ max_usage: 10 })
          .eq('user_id', ctx.uid)
          .eq('channel_type', 'email');

        if (limitUpdate.error) {
          throw core.problem(503, 'Could not set email inbox daily limits to 10.');
        }
      }

      return core.result(200, {
        channels: filtered.map(row => ({
          id: row.id,
          name: row.name,
          sender_id: row.sender_id,
          is_active: row.is_active,
        })),
        deleted_gmail_channels: gmailRows.length,
        daily_limit: 10,
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
