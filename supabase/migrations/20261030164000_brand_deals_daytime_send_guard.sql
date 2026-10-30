-- Align final duplicate-send authorization with daytime campaign dispatch.
-- Keep already-sent, ambiguous, reserved/in-flight and claim-token protections intact.
CREATE OR REPLACE FUNCTION public.outreach_email_guard_request_before_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_progress public.lead_sequence_progress%rowtype;
  v_guard public.outreach_email_send_guard%rowtype;
  v_attempt uuid := gen_random_uuid();
begin
  if new.id is null then
    new.id := gen_random_uuid();
  end if;

  select * into v_progress
  from public.lead_sequence_progress p
  where p.id = new.progress_id
  for update;

  if not found or v_progress.status <> 'running' then
    new.send_allowed := false;
    new.reason := 'progress_not_running';
    return new;
  end if;

  if v_progress.campaign_id='96448213-5086-4e04-bc7c-53e9101a6aca'::uuid
     and lower(coalesce(v_progress.decision->>'manual_direct_reply','false')) <> 'true'
     and not (
       (now() at time zone 'America/New_York')::time >= time '08:00'
       and (now() at time zone 'America/Los_Angeles')::time < time '20:00'
     ) then
    new.send_allowed := false;
    new.reason := 'outside_brand_deals_us_daytime_window';
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

  if new.claim_token is null or coalesce(v_progress.decision->>'claim_token','') <> new.claim_token::text then
    new.send_allowed := false;
    new.reason := 'claim_token_mismatch';
    return new;
  end if;

  if v_progress.next_at is null or v_progress.next_at <= now()
     or not exists(select 1 from public.campaigns c where c.id=v_progress.campaign_id and c.status='active') then
    new.send_allowed := false; new.reason := 'claim_expired_or_campaign_paused';
    new.retry_at := now() + interval '15 minutes'; return new;
  end if;

  select * into v_guard
  from public.outreach_email_send_guard g
  where g.progress_id = v_progress.id
    and g.sequence_step = coalesce(v_progress.step,0)
  for update;

  if not found then
    insert into public.outreach_email_send_guard (
      progress_id, campaign_id, lead_id, sequence_step,
      state, attempt_token, claim_token, channel_id,
      reserved_at, lease_until, created_at, updated_at
    )
    values (
      v_progress.id, v_progress.campaign_id, v_progress.lead_id, coalesce(v_progress.step,0),
      'reserved', v_attempt, new.claim_token, v_progress.channel_id,
      now(), now() + interval '30 minutes', now(), now()
    )
    returning * into v_guard;

    new.send_allowed := true;
    new.reason := 'new_reservation';
    new.guard_id := v_guard.id;
    new.attempt_token := v_guard.attempt_token;
    return new;
  end if;

  new.guard_id := v_guard.id;
  new.attempt_token := v_guard.attempt_token;
  new.message_id := v_guard.message_id;

  if v_guard.state = 'sent' then
    new.send_allowed := false;
    new.reason := 'already_sent';
    return new;
  end if;

  if v_guard.state = 'failed' then
    update public.outreach_email_send_guard g
    set state = 'reserved',
        attempt_token = v_attempt,
        claim_token = new.claim_token,
        channel_id = v_progress.channel_id,
        reserved_at = now(),
        lease_until = now() + interval '30 minutes',
        last_error = null,
        updated_at = now()
    where g.id = v_guard.id
    returning * into v_guard;

    new.send_allowed := true;
    new.reason := 'retry_after_known_failure';
    new.guard_id := v_guard.id;
    new.attempt_token := v_guard.attempt_token;
    new.message_id := v_guard.message_id;
    return new;
  end if;

  if v_guard.state = 'reserved' and v_guard.lease_until > now() then
    new.send_allowed := false;
    new.reason := 'send_in_flight';
    new.retry_at := v_guard.lease_until;
    return new;
  end if;

  update public.outreach_email_send_guard g
  set state = 'ambiguous',
      last_error = coalesce(g.last_error, 'Previous SMTP attempt expired without a terminal result.'),
      updated_at = now()
  where g.id = v_guard.id
  returning * into v_guard;

  new.send_allowed := false;
  new.reason := 'ambiguous_previous_attempt';
  new.guard_id := v_guard.id;
  new.attempt_token := v_guard.attempt_token;
  return new;
end;
$function$

