-- Automatically attach every uploaded lead to the outreach engine.
-- This removes the old 1,000-row workflow dependency and works even when a
-- campaign is already active.

create or replace function public.sync_uploaded_lead_to_outreach()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.campaign_id is null then
    return new;
  end if;

  insert into public.leads (
    id,
    campaign_id,
    name,
    phone,
    status,
    user_id
  )
  values (
    new.id,
    new.campaign_id,
    new.name,
    coalesce(new.phone, ''),
    'not_called',
    new.user_id
  )
  on conflict (id) do update
  set campaign_id = excluded.campaign_id,
      name = excluded.name,
      phone = excluded.phone,
      user_id = excluded.user_id;

  if not exists (
    select 1
    from public.lead_sequence_progress p
    where p.lead_id = new.id
      and p.campaign_id = new.campaign_id
  ) then
    insert into public.lead_sequence_progress (
      lead_id,
      campaign_id,
      user_id,
      step,
      status,
      next_at
    )
    values (
      new.id,
      new.campaign_id,
      new.user_id,
      1,
      'ready',
      now()
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_uploaded_lead_to_outreach
  on public.uploaded_leads;

create trigger trg_sync_uploaded_lead_to_outreach
after insert
on public.uploaded_leads
for each row
execute function public.sync_uploaded_lead_to_outreach();

-- Repair existing active/paused/draft campaigns that were affected by
-- Supabase/PostgREST's 1,000-row response cap.
insert into public.leads (
  id,
  campaign_id,
  name,
  phone,
  status,
  user_id
)
select
  u.id,
  u.campaign_id,
  u.name,
  coalesce(u.phone, ''),
  'not_called',
  u.user_id
from public.uploaded_leads u
join public.campaigns c on c.id = u.campaign_id
where c.status in ('active','paused','draft')
on conflict (id) do update
set campaign_id = excluded.campaign_id,
    name = excluded.name,
    phone = excluded.phone,
    user_id = excluded.user_id;

insert into public.lead_sequence_progress (
  lead_id,
  campaign_id,
  user_id,
  step,
  status,
  next_at
)
select
  u.id,
  u.campaign_id,
  u.user_id,
  1,
  'ready',
  now()
from public.uploaded_leads u
join public.campaigns c on c.id = u.campaign_id
where c.status in ('active','paused','draft')
  and not exists (
    select 1
    from public.lead_sequence_progress p
    where p.lead_id = u.id
      and p.campaign_id = u.campaign_id
  );
