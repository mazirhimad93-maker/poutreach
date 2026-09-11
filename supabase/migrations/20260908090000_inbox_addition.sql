begin;
create table if not exists public.outreach_inbox_mail (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id),
 channel_id uuid not null references public.channels(id),
 lead_id uuid not null references public.uploaded_leads(id),
 campaign_id uuid not null references public.campaigns(id),
 direction text not null check (direction in ('inbound','outbound')),
 status text not null check (status in ('received','sending','sent','failed','unknown')),
 subject text not null default '', body_text text not null default '', body_html text not null default '',
 from_email text not null, to_email text not null,
 message_id text, in_reply_to text, thread_refs text[] not null default '{}',
 source_key text not null, error_code text,
 created_at timestamptz not null default now(),
 unique(user_id, source_key)
);
create index if not exists outreach_inbox_mail_owner_time on public.outreach_inbox_mail(user_id,created_at desc,id desc);
alter table public.outreach_inbox_mail enable row level security;
revoke all on public.outreach_inbox_mail from anon, authenticated;
grant all on public.outreach_inbox_mail to service_role;
create table if not exists public.outreach_inbox_sync (
 user_id uuid not null references auth.users(id), channel_id uuid not null references public.channels(id),
 uid_validity text, last_uid bigint not null default 0, updated_at timestamptz,
 primary key(user_id,channel_id)
);
alter table public.outreach_inbox_sync enable row level security;
revoke all on public.outreach_inbox_sync from anon, authenticated;
grant all on public.outreach_inbox_sync to service_role;
-- This view is server-only. Each API request additionally filters the verified user_id.
-- JSON access tolerates optional columns on the older interface's history schema.
create or replace view public.outreach_inbox_activity with (security_invoker=true) as
select 'history:'||h.id::text as activity_id, c.user_id, h.lead_id,h.campaign_id,
 nullif(to_jsonb(h)->>'channel_id','')::uuid as channel_id,
 case when h.from_role='lead' then 'inbound' else 'outbound' end as direction,
 case when h.from_role='lead' then 'received' else 'sent' end as status,
 coalesce(to_jsonb(h)->>'email_subject','') as subject,
 coalesce(nullif(to_jsonb(h)->>'email_body',''),h.message,'') as body_text,
 coalesce(nullif(to_jsonb(h)->>'email_body',''),h.message,'') as body_html,
 case when h.from_role='lead' then coalesce(l.email,'') else coalesce(ch.sender_id,'') end as from_email,
 case when h.from_role='lead' then coalesce(ch.sender_id,'') else coalesce(l.email,'') end as to_email,
 coalesce(to_jsonb(h)->>'email_message_id',to_jsonb(h)->>'message_id') as message_id,
 coalesce(to_jsonb(h)->>'in_reply_to',to_jsonb(h)->>'reply_to_message_id') as in_reply_to,
 '{}'::text[] as thread_refs,
 coalesce(nullif(to_jsonb(h)->>'timestamp','')::timestamptz,nullif(to_jsonb(h)->>'created_at','')::timestamptz,'epoch'::timestamptz) as created_at,
 case when h.from_role='lead' then 'reply' else 'automation' end as source,
 coalesce(l.name,l.email,'Lead') as lead_name,coalesce(c.offer,c.name,'Campaign') as campaign_name,
 null::text as error_code
from public.conversation_history h
join public.campaigns c on c.id=h.campaign_id
join public.uploaded_leads l on l.id=h.lead_id and l.user_id=c.user_id
left join public.channels ch on ch.id=nullif(to_jsonb(h)->>'channel_id','')::uuid and ch.user_id=c.user_id
where h.channel='email'
and not exists(select 1 from public.outreach_inbox_mail m where m.id=h.id)
union all
select 'mail:'||m.id::text,m.user_id,m.lead_id,m.campaign_id,m.channel_id,m.direction,m.status,
 m.subject,m.body_text,m.body_html,m.from_email,m.to_email,m.message_id,m.in_reply_to,m.thread_refs,m.created_at,
 case when m.direction='inbound' then 'imap' else 'manual' end,
 coalesce(l.name,l.email,'Lead'),coalesce(c.offer,c.name,'Campaign'),m.error_code
from public.outreach_inbox_mail m
join public.uploaded_leads l on l.id=m.lead_id and l.user_id=m.user_id
join public.campaigns c on c.id=m.campaign_id and c.user_id=m.user_id;
revoke all on public.outreach_inbox_activity from public,anon,authenticated;
grant select on public.outreach_inbox_activity to service_role;
notify pgrst,'reload schema';
commit;
