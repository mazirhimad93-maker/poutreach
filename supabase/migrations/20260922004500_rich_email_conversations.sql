-- Rich CRM email conversations.
-- Preserve formatted outbound replies and inbound HTML/attachment metadata
-- so the Inbox can render a persistent thread.

alter table public.conversation_history
  add column if not exists email_body_html text,
  add column if not exists email_to text,
  add column if not exists email_attachments jsonb not null default '[]'::jsonb;

create index if not exists conversation_history_email_thread_idx
  on public.conversation_history(campaign_id, lead_id, timestamp);

update public.conversation_history
set email_body_html = email_body
where email_body_html is null
  and email_body ~* '<[a-z][^>]*>';
