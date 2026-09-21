-- Scalable campaign analytics that are not capped by PostgREST's 1,000-row
-- response limit. Frontend reads one aggregate row per campaign.

create or replace view public.campaign_performance_summary
with (security_invoker = true)
as
with lead_counts as (
  select campaign_id, count(*)::bigint as total_leads
  from public.uploaded_leads
  group by campaign_id
),
sequence_counts as (
  select
    campaign_id,
    count(*) filter (where lower(coalesce(status,'')) in ('queued','ready'))::bigint as queued,
    count(*) filter (where lower(coalesce(status,'')) in ('running','processing'))::bigint as running,
    count(*) filter (where lower(coalesce(status,'')) in ('done','completed'))::bigint as done,
    count(*) filter (where lower(coalesce(status,'')) in ('failed','error'))::bigint as failed
  from public.lead_sequence_progress
  group by campaign_id
),
activity_counts as (
  select
    campaign_id,
    count(*) filter (
      where lower(coalesce(status,'')) in ('sent','completed','complete','success','succeeded','delivered')
        and lower(coalesce(type,'')) in ('email','sms','whatsapp','call','vapi')
    )::bigint as reach,
    count(distinct lead_id) filter (
      where lower(coalesce(status,'')) in ('sent','completed','complete','success','succeeded','delivered')
        and lower(coalesce(type,'')) in ('email','sms','whatsapp','call','vapi')
    )::bigint as reached_leads,
    count(*) filter (
      where lower(coalesce(status,'')) in ('sent','completed','complete','success','succeeded','delivered')
        and lower(coalesce(type,'')) in ('call','vapi')
    )::bigint as calls,
    count(*) filter (
      where lower(coalesce(status,'')) in ('sent','completed','complete','success','succeeded','delivered')
        and lower(coalesce(type,'')) = 'sms'
    )::bigint as sms,
    count(*) filter (
      where lower(coalesce(status,'')) in ('sent','completed','complete','success','succeeded','delivered')
        and lower(coalesce(type,'')) = 'whatsapp'
    )::bigint as whatsapp,
    count(*) filter (
      where lower(coalesce(status,'')) in ('sent','completed','complete','success','succeeded','delivered')
        and lower(coalesce(type,'')) = 'email'
    )::bigint as email
  from public.lead_activity_history
  group by campaign_id
),
reply_counts as (
  select campaign_id, count(*)::bigint as replies
  from public.conversation_history
  where from_role = 'lead'
  group by campaign_id
),
booking_counts as (
  select campaign_id, count(*)::bigint as bookings
  from public.bookings
  group by campaign_id
)
select
  c.id as campaign_id,
  c.user_id,
  coalesce(l.total_leads,0)::bigint as total_leads,
  coalesce(s.queued,0)::bigint as queued,
  coalesce(s.running,0)::bigint as running,
  coalesce(s.done,0)::bigint as done,
  coalesce(s.failed,0)::bigint as failed,
  coalesce(a.reach,0)::bigint as reach,
  coalesce(a.reached_leads,0)::bigint as reached_leads,
  coalesce(a.calls,0)::bigint as calls,
  coalesce(a.sms,0)::bigint as sms,
  coalesce(a.whatsapp,0)::bigint as whatsapp,
  coalesce(a.email,0)::bigint as email,
  coalesce(r.replies,0)::bigint as replies,
  coalesce(b.bookings,0)::bigint as bookings
from public.campaigns c
left join lead_counts l on l.campaign_id = c.id
left join sequence_counts s on s.campaign_id = c.id
left join activity_counts a on a.campaign_id = c.id
left join reply_counts r on r.campaign_id = c.id
left join booking_counts b on b.campaign_id = c.id;

create or replace view public.campaign_daily_reach
with (security_invoker = true)
as
select
  h.campaign_id,
  c.user_id,
  (h.executed_at at time zone 'UTC')::date as activity_date,
  count(*)::bigint as total
from public.lead_activity_history h
join public.campaigns c on c.id = h.campaign_id
where lower(coalesce(h.status,'')) in ('sent','completed','complete','success','succeeded','delivered')
  and lower(coalesce(h.type,'')) in ('email','sms','whatsapp','call','vapi')
group by h.campaign_id, c.user_id, (h.executed_at at time zone 'UTC')::date;
