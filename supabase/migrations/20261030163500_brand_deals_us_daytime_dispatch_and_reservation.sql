-- Poutreach 2026-10-30: switch Creator Brand Deals from nighttime
-- NY (20:00-02:00) to US working hours: NY >= 08:00, LA < 20:00.
-- Keep sender channel cooldown, daily caps, claim tokens, no sender swaps,
-- and manual reply overrides. Francisco A/B/C test campaigns remain paused.
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
           or (p.campaign_id='96448213-5086-4e04-bc7c-53e9101a6aca'::uuid and ((now() at time zone 'America/New_York')::time >= time '08:00' and (now() at time zone 'America/Los_Angeles')::time < time '20:00'))
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

CREATE OR REPLACE FUNCTION public.outreach_email_reservation_before_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_progress public.lead_sequence_progress%rowtype;
  v_channel public.channels%rowtype;
  v_locked_id uuid;
  v_history_locked_id uuid;
  v_shared_result jsonb;
  v_manual_reply boolean := false;
  v_cooldown integer := greatest(30, least(coalesce(new.cooldown_seconds, 900), 86400));
  v_next_midnight timestamptz :=
    ((date_trunc('day', now() at time zone 'UTC') + interval '1 day') at time zone 'UTC');
  v_warm_campaign constant uuid := '1317e852-9bc7-4447-9c7a-802f1789be75'::uuid;
begin
  if new.id is null then new.id := gen_random_uuid(); end if;

  select * into v_progress
  from public.lead_sequence_progress p
  where p.id = new.progress_id
  for update;

  if not found then
    new.available := false; new.skip_reason := 'progress_not_found';
    new.retry_at := now() + interval '15 minutes'; return new;
  end if;

  if v_progress.status <> 'running' then
    new.available := false; new.skip_reason := 'progress_not_running';
    new.retry_at := now() + interval '15 minutes'; return new;
  end if;

  if new.claim_token is null
     or coalesce(v_progress.decision->>'claim_token','') <> new.claim_token::text then
    new.available := false; new.skip_reason := 'claim_token_mismatch';
    new.retry_at := now() + interval '15 minutes'; return new;
  end if;

  if v_progress.next_at is null or v_progress.next_at <= now() then
    new.available := false; new.skip_reason := 'claim_lease_expired';
    new.retry_at := now() + interval '1 minute'; return new;
  end if;

  v_manual_reply := lower(coalesce(v_progress.decision->>'manual_direct_reply','false')) = 'true';

  if v_progress.campaign_id='96448213-5086-4e04-bc7c-53e9101a6aca'::uuid
     and not v_manual_reply
     and not (
       (now() at time zone 'America/New_York')::time >= time '08:00'
       and (now() at time zone 'America/Los_Angeles')::time < time '20:00'
     ) then
    new.available := false;
    new.skip_reason := 'outside_brand_deals_us_daytime_window';
    -- Next New York 08:00 opening, in the same time zone used by dispatch.
    new.retry_at := (
      date_trunc('day', now() at time zone 'America/New_York')
      + case
          when (now() at time zone 'America/New_York')::time < time '08:00'
          then interval '8 hours'
          else interval '1 day 8 hours'
        end
    ) at time zone 'America/New_York';
    return new;
  end if;

  select h.channel_id into v_history_locked_id
  from public.conversation_history h
  where h.lead_id = v_progress.lead_id
    and h.channel = 'email'
    and h.from_role = 'ai'
    and h.channel_id is not null
    and (
      v_progress.campaign_id = v_warm_campaign
      or h.campaign_id = v_progress.campaign_id
    )
  order by coalesce(h.created_at,h."timestamp") desc nulls last,h.id desc
  limit 1;

  -- Manual replies are different from cold follow-ups:
  -- the explicitly locked inbox on the reply request is authoritative.
  if v_manual_reply then
    v_locked_id := v_progress.channel_id;
  else
    v_locked_id := coalesce(v_history_locked_id, v_progress.channel_id);
  end if;

  if v_locked_id is not null then
    select * into v_channel
    from public.channels c
    where c.id = v_locked_id
      and c.user_id = v_progress.user_id
      and c.channel_type = 'email'
    for update;

    if not found then
      new.available := false;
      new.channel_id := v_locked_id;
      new.skip_reason := 'historical_email_channel_missing_no_sender_swap';
      new.retry_at := now() + interval '1 hour';
      return new;
    end if;

    if not v_manual_reply and v_progress.channel_id is distinct from v_channel.id then
      update public.lead_sequence_progress p
      set channel_id = v_channel.id
      where p.id = v_progress.id;
      v_progress.channel_id := v_channel.id;
    end if;

    if coalesce(v_channel.is_active,false) is false then
      new.available := false; new.channel_id := v_channel.id;
      new.skip_reason := 'locked_email_channel_inactive_no_sender_swap';
      new.retry_at := now() + interval '1 hour'; return new;
    end if;

    if not v_manual_reply
       and coalesce(v_channel.usage_count,0) >= greatest(coalesce(v_channel.max_usage,0),0) then
      new.available := false; new.channel_id := v_channel.id;
      new.skip_reason := 'locked_email_channel_daily_cap_no_sender_swap';
      new.retry_at := v_next_midnight; return new;
    end if;

    if not v_manual_reply
       and v_channel.last_used_at is not null
       and v_channel.last_used_at > now() - make_interval(secs => v_cooldown) then
      new.available := false; new.channel_id := v_channel.id;
      new.skip_reason := 'locked_email_channel_cooling_down';
      new.retry_at := v_channel.last_used_at + make_interval(secs => v_cooldown);
      return new;
    end if;
  else
    if v_manual_reply then
      new.available := false;
      new.skip_reason := 'manual_reply_missing_locked_channel';
      new.retry_at := now() + interval '15 minutes';
      return new;
    end if;

    select * into v_channel
    from public.channels c
    where c.user_id = v_progress.user_id
      and c.channel_type = 'email'
      and coalesce(c.is_active,false) = true
      and coalesce(c.usage_count,0) < greatest(coalesce(c.max_usage,0),0)
      and (c.last_used_at is null or c.last_used_at <= now() - make_interval(secs => v_cooldown))
      and outreach_private.can_reserve_shared_email(c.id, v_cooldown)
      and coalesce(
        nullif(c.credentials->>'smtp_username',''),
        nullif(c.credentials->>'smtp_user',''),
        nullif(c.email_address,'')
      ) is not null
      and coalesce(
        nullif(c.credentials->>'smtp_password',''),
        nullif(c.credentials->>'smtp_pass','')
      ) is not null
      and (
        (v_progress.campaign_id = 'd585c61d-2387-44c2-9adb-fe5d932b40dd'::uuid
          and lower(coalesce(nullif(c.email_address,''),nullif(c.credentials->>'email_address',''),nullif(c.credentials->>'smtp_username',''),c.credentials->>'smtp_user','')) like 'francisco@%')
        or
        (v_progress.campaign_id <> 'd585c61d-2387-44c2-9adb-fe5d932b40dd'::uuid
          and (v_progress.user_id <> 'cdc6a64a-50e8-4519-9a55-3f16c13ab759'::uuid
            or lower(coalesce(nullif(c.email_address,''),nullif(c.credentials->>'email_address',''),nullif(c.credentials->>'smtp_username',''),c.credentials->>'smtp_user','')) not like 'francisco@%'))
      )
    order by
      (coalesce(c.usage_count,0)::numeric / greatest(coalesce(c.max_usage,1),1)) asc,
      c.last_used_at asc nulls first,
      c.id
    for update skip locked
    limit 1;

    if not found then
      new.available := false;
      new.skip_reason := case
        when v_progress.campaign_id = 'd585c61d-2387-44c2-9adb-fe5d932b40dd'::uuid
          then 'no_working_francisco_email_channel_for_youtube_campaign'
        when v_progress.user_id = 'cdc6a64a-50e8-4519-9a55-3f16c13ab759'::uuid
          then 'no_non_francisco_email_channel_available_for_campaign'
        else 'no_email_channel_currently_available'
      end;
      new.retry_at := now() + interval '15 minutes';
      return new;
    end if;
  end if;

  if coalesce(nullif(v_channel.credentials->>'smtp_username',''),nullif(v_channel.credentials->>'smtp_user',''),nullif(v_channel.email_address,'')) is null
     or coalesce(nullif(v_channel.credentials->>'smtp_password',''),nullif(v_channel.credentials->>'smtp_pass','')) is null then
    new.available := false; new.channel_id := v_channel.id;
    new.skip_reason := 'locked_email_channel_missing_smtp_no_sender_swap';
    new.retry_at := now() + interval '1 hour'; return new;
  end if;

  v_shared_result := outreach_private.reserve_shared_email(v_channel.id, v_cooldown, v_manual_reply);
  if not coalesce((v_shared_result->>'available')::boolean,false) then
    new.available := false;
    new.channel_id := v_channel.id;
    new.skip_reason := v_shared_result->>'skip_reason';
    new.retry_at := (v_shared_result->>'retry_at')::timestamptz;
    return new;
  end if;

  update public.channels c
  set usage_count = case when v_manual_reply then coalesce(c.usage_count,0)
                         else coalesce(c.usage_count,0) + 1 end,
      last_used_at = now(),
      updated_at = now()
  where c.id = v_channel.id
  returning * into v_channel;

  new.available := true;
  new.channel_id := v_channel.id;
  new.skip_reason := null;
  new.retry_at := null;
  new.reserved_at := v_channel.last_used_at;
  return new;
end;
$function$

