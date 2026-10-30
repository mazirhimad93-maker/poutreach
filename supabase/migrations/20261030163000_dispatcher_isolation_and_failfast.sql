-- Incident recovery 2026-10-30 for Poutreach dispatch
-- 1. A paused campaign's claimed/unstarted jobs must not block active campaigns.
-- 2. Fail fast on overlapping scheduler ticks instead of waiting and timing out.
-- Preserve all send guards, lease handling, working hours, and sequence logic.
CREATE OR REPLACE FUNCTION public.outreach_dispatch_batch_before_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_claimed integer := 0;
  v_lease integer := greatest(120, least(coalesce(new.lease_seconds, 1800), 7200));
  v_batch integer := greatest(1, least(coalesce(new.requested_size, 25), 500));
  v_active integer := 0;
begin
  if new.id is null then new.id := gen_random_uuid(); end if;

  -- Only the corrected full-canvas loop may claim new work.
  if coalesce(new.dispatcher_key,'') <> 'v5_4_full_canvas_loop' then
    new.claimed_count := 0;
    new.lease_seconds := v_lease;
    new.requested_size := v_batch;
    return new;
  end if;

  -- Serialize the short dispatcher transaction; a minute tick cannot overlap an active batch.
  if not pg_try_advisory_xact_lock(hashtext('outreach_v5_full_canvas_dispatch')) then
    -- Skip overlapping ticks rather than waiting until a statement timeout.
    new.claimed_count := 0;
    new.lease_seconds := v_lease;
    new.requested_size := v_batch;
    return new;
  end if;

  -- A reply/cancel/reclaim must not leave a job blocking every future batch.
  update public.outreach_dispatch_jobs j
  set status='orphaned', finished_at=now(),
      last_error=coalesce(j.last_error,'Progress stopped, completed, disappeared, or changed owner.')
  where j.status in ('claimed','started')
    and not exists (
      select 1 from public.lead_sequence_progress p
      where p.id=j.progress_id and p.status='running'
        and coalesce(p.decision->>'claim_token','')=j.claim_token::text
    );

  with stale_started as (
    select j.id, j.progress_id, j.claim_token
    from public.outreach_dispatch_jobs j
    join public.lead_sequence_progress p on p.id=j.progress_id
    where j.status='started'
      and p.status='running'
      and p.next_at <= now()
      and coalesce(p.decision->>'claim_token','') = j.claim_token::text
    for update of j, p skip locked
    limit 5000
  ),
  released as (
    update public.lead_sequence_progress p
    set status='ready',
        next_at=now(),
        stop_reason='stale_worker_recovered_by_dispatcher',
        decision=(case when jsonb_typeof(p.decision)='object' then p.decision else '{}'::jsonb end)
          - 'claim_token' - 'claim_batch_id' - 'claimed_at'
    from stale_started s
    where p.id=s.progress_id
    returning s.id
  )
  update public.outreach_dispatch_jobs j
  set status='orphaned', finished_at=now(),
      last_error=coalesce(j.last_error,'Worker lease expired before completion.')
  from released r
  where j.id=r.id;

  with stale_claimed as (
    select j.id, j.progress_id, j.claim_token
    from public.outreach_dispatch_jobs j
    join public.lead_sequence_progress p on p.id=j.progress_id
    where j.status='claimed'
      and j.created_at <= now() - interval '45 minutes'
      and p.status='running'
      and coalesce(p.decision->>'claim_token','') = j.claim_token::text
    for update of j, p skip locked
    limit 5000
  ),
  released as (
    update public.lead_sequence_progress p
    set status='ready',
        next_at=now(),
        stop_reason='stale_unstarted_dispatch_recovered',
        decision=(case when jsonb_typeof(p.decision)='object' then p.decision else '{}'::jsonb end)
          - 'claim_token' - 'claim_batch_id' - 'claimed_at'
    from stale_claimed s
    where p.id=s.progress_id
    returning s.id
  )
  update public.outreach_dispatch_jobs j
  set status='orphaned', finished_at=now(),
      last_error=coalesce(j.last_error,'Claimed job never started.')
  from released r
  where j.id=r.id;

  select count(*) into v_active
  from public.outreach_dispatch_jobs j
  join public.campaigns c on c.id=j.campaign_id
  where j.status in ('claimed','started')
    and c.status='active';

  if v_active > 0 then
    new.claimed_count := 0;
    new.lease_seconds := v_lease;
    new.requested_size := v_batch;
    return new;
  end if;

  with ranked as (
    select p.id, p.next_at, p.created_at,
      row_number() over (
        partition by p.campaign_id
        order by p.next_at asc, p.created_at asc, p.id
      ) as campaign_rank
    from public.lead_sequence_progress p
    join public.campaigns c on c.id=p.campaign_id
    where p.status='ready'
      and p.next_at <= now()
      and c.status='active'
      -- Email work for this account starts only during the US campaign window.
      and (p.user_id IS DISTINCT FROM 'cdc6a64a-50e8-4519-9a55-3f16c13ab759'::uuid
           or p.type IS DISTINCT FROM 'email'
           or lower(coalesce(p.decision->>'manual_direct_reply','false'))='true'
           or (p.campaign_id='96448213-5086-4e04-bc7c-53e9101a6aca'::uuid and ((now() at time zone 'America/New_York')::time >= time '20:00' or (now() at time zone 'America/New_York')::time < time '02:00'))
           or (p.campaign_id IS DISTINCT FROM '96448213-5086-4e04-bc7c-53e9101a6aca'::uuid
               and ((now() at time zone 'America/New_York')::time >= time '08:00'
               and (now() at time zone 'America/Los_Angeles')::time < time '20:00')))
      -- Brand Deals: send all eligible initial emails before step 2 or later.
      and (p.campaign_id IS DISTINCT FROM '96448213-5086-4e04-bc7c-53e9101a6aca'::uuid
           or coalesce(p.step,1)=1
           or not exists (select 1 from public.lead_sequence_progress first_pass
               where first_pass.campaign_id=p.campaign_id
                 and first_pass.step=1
                 and first_pass.status in ('ready','running')))
  ),
  picked as (
    select p.id
    from public.lead_sequence_progress p
    join ranked r on r.id=p.id
    order by r.campaign_rank asc, r.next_at asc, r.created_at asc, p.id
    for update of p skip locked
    limit v_batch
  ),
  claimed as (
    update public.lead_sequence_progress p
    set status='running',
        next_at=now()+make_interval(secs=>v_lease),
        stop_reason='running_workflow_lease',
        decision=(case when jsonb_typeof(p.decision)='object' then p.decision else '{}'::jsonb end)
          || jsonb_build_object(
            'claim_token',gen_random_uuid(),
            'claim_batch_id',new.id,
            'claimed_at',now()
          )
    from picked
    where p.id=picked.id
    returning p.*
  )
  insert into public.outreach_dispatch_jobs(
    batch_id,progress_id,claim_token,lead_id,campaign_id,user_id,step,type,status
  )
  select new.id,c.id,(c.decision->>'claim_token')::uuid,c.lead_id,c.campaign_id,c.user_id,c.step,c.type,'claimed'
  from claimed c;

  get diagnostics v_claimed = row_count;
  new.claimed_count := v_claimed;
  new.lease_seconds := v_lease;
  new.requested_size := v_batch;
  return new;
end;
$function$

