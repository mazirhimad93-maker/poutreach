-- Install disabled. The primary keeps its original behavior until an explicit handoff.
create schema if not exists outreach_private;

create table if not exists outreach_private.backup_worker_control (
  singleton boolean primary key default true check (singleton),
  mode text not null default 'primary' check (mode in ('primary', 'backup', 'draining')),
  token text not null default (replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')),
  project_url text check (project_url ~ '^https://[a-z0-9]+[.]supabase[.]co$'),
  sender_url text check (sender_url ~ '^https://[a-z0-9-]+[.]netlify[.]app/[.]netlify/functions/send-smtp$'),
  batch_size integer not null default 3 check (batch_size between 1 and 4)
);
revoke all on outreach_private.backup_worker_control from public, anon, authenticated;
insert into outreach_private.backup_worker_control (singleton) values (true) on conflict do nothing;

-- The DB already checks the V5.4.5 revision. Run after that check and before dispatch.
create or replace function outreach_private.backup_fence_batch()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_mode text;
begin
  if new.dispatcher_key is distinct from 'v5_4_full_canvas_loop' then
    return new;
  end if;

  select mode into strict v_mode
    from outreach_private.backup_worker_control where singleton for share;

  if current_setting('poutreach.backup_dispatch', true) = 'on' then
    new.workflow_revision := 'poutreach_backup_v1';
    if v_mode <> 'backup' then new.dispatcher_key := 'backup_disabled'; end if;
  elsif v_mode <> 'primary' then
    new.dispatcher_key := 'primary_fenced';
  end if;
  return new;
end;
$$;

create trigger trg_02_outreach_backup_fence
before insert on public.outreach_dispatch_batches
for each row execute function outreach_private.backup_fence_batch();

create or replace function public.outreach_backup_authorize(p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('mode', mode, 'sender_url', sender_url,
                            'tracker_url', project_url || '/functions/v1/tracker')
  from outreach_private.backup_worker_control
  where singleton and token = p_token and project_url is not null and sender_url is not null;
$$;

create or replace function public.outreach_backup_preview()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'dispatcher', (select mode from outreach_private.backup_worker_control where singleton),
    'due_email_rows_before_send_window_and_inbox_checks', (
      select count(*) from public.lead_sequence_progress p
      join public.campaigns c on c.id = p.campaign_id
      where c.status = 'active' and p.status = 'ready' and p.type = 'email' and p.next_at <= now()
    ),
    'active_email_inboxes', (select count(*) from public.channels where channel_type = 'email' and is_active),
    'active_dispatch_jobs', (
      select count(*) from public.outreach_dispatch_jobs j
      join public.lead_sequence_progress p on p.id = j.progress_id
      where j.status in ('claimed', 'started') and p.status = 'running'
        and p.decision->>'claim_token' = j.claim_token::text
    )
  );
$$;

create or replace function public.outreach_backup_claim(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_control outreach_private.backup_worker_control%rowtype;
  v_batch uuid;
  v_jobs jsonb;
begin
  select * into v_control from outreach_private.backup_worker_control
  where singleton and token = p_token for share;
  if not found or v_control.mode <> 'backup' then return '[]'::jsonb; end if;

  perform set_config('poutreach.backup_dispatch', 'on', true);
  insert into public.outreach_dispatch_batches (requested_size, lease_seconds, dispatcher_key, workflow_revision)
    values (v_control.batch_size, 1800, 'v5_4_full_canvas_loop', 'item_link_fix_5')
    returning id into v_batch;
  perform set_config('poutreach.backup_dispatch', 'off', true);

  select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'claim_token', j.claim_token)
                           order by p.created_at, j.id), '[]'::jsonb)
    into v_jobs
  from public.outreach_dispatch_jobs j
  join public.lead_sequence_progress p on p.id = j.progress_id
  where j.batch_id = v_batch and j.status = 'claimed';
  return v_jobs;
end;
$$;

create or replace function public.outreach_backup_start_job(p_job_id uuid, p_claim_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_progress public.lead_sequence_progress%rowtype;
begin
  update public.outreach_dispatch_jobs j
  set status = 'started', started_at = now()
  from public.outreach_dispatch_batches b, public.lead_sequence_progress p
  where j.id = p_job_id and j.claim_token = p_claim_token and j.status = 'claimed'
    and b.id = j.batch_id and b.workflow_revision = 'poutreach_backup_v1'
    and p.id = j.progress_id and p.status = 'running' and p.next_at > now()
    and p.decision->>'claim_token' = p_claim_token::text
  returning p.* into v_progress;
  if not found then return null; end if;
  return jsonb_build_object('progress', to_jsonb(v_progress));
end;
$$;

create or replace function public.outreach_backup_begin_email(
  p_job_id uuid, p_claim_token uuid, p_step_id uuid, p_recipient text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_progress public.lead_sequence_progress%rowtype;
  v_campaign_status text;
  v_lead_status text;
  v_recipient text;
  v_last_reply timestamptz;
  v_stop_on_reply boolean;
begin
  select p.* into v_progress
  from public.outreach_dispatch_jobs j
  join public.outreach_dispatch_batches b on b.id = j.batch_id
  join public.lead_sequence_progress p on p.id = j.progress_id
  where j.id = p_job_id and j.claim_token = p_claim_token and j.status = 'started'
    and b.workflow_revision = 'poutreach_backup_v1'
    and p.status = 'running' and p.next_at > now() and p.decision->>'claim_token' = p_claim_token::text
  for update of p;
  if not found then return jsonb_build_object('guard_reason', 'backup_lease_lost'); end if;

  select status into v_campaign_status from public.campaigns where id = v_progress.campaign_id;
  if v_campaign_status is distinct from 'active' then
    return jsonb_build_object('guard_reason', 'campaign_inactive');
  end if;
  select status, last_reply_at, email into v_lead_status, v_last_reply, v_recipient
  from public.uploaded_leads where id = v_progress.lead_id;
  if not found or v_lead_status ~* '^(unsubscribed|opt[_ -]?out|bounced|invalid|do[_ -]?not[_ -]?contact)$' then
    return jsonb_build_object('guard_reason', 'suppressed_contact');
  end if;
  if btrim(v_recipient) is distinct from p_recipient then
    return jsonb_build_object('guard_reason', 'recipient_changed');
  end if;
  select stop_on_reply into v_stop_on_reply from public.campaign_sequences
  where id = p_step_id and campaign_id = v_progress.campaign_id
    and step_number = v_progress.step and lower(type) = 'email';
  if not found then return jsonb_build_object('guard_reason', 'sequence_changed'); end if;
  if v_last_reply is not null and v_stop_on_reply is distinct from false
     and lower(coalesce(v_progress.decision->>'manual_direct_reply', 'false')) <> 'true' then
    return jsonb_build_object('guard_reason', 'lead_replied');
  end if;
  return public.outreach_begin_email_send(v_progress.id, p_claim_token);
end;
$$;

create or replace function public.outreach_backup_finish_job(
  p_job_id uuid, p_claim_token uuid, p_outcome text, p_reason text,
  p_retry_at timestamptz default null, p_guard_id uuid default null,
  p_attempt_token uuid default null, p_message_id text default null,
  p_subject text default null, p_body text default null,
  p_from text default null, p_to text default null, p_quarantine boolean default false
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_job public.outreach_dispatch_jobs%rowtype;
  v_progress public.lead_sequence_progress%rowtype;
  v_guard public.outreach_email_send_guard%rowtype;
  v_now timestamptz := now();
  v_status text;
  v_message_id text;
begin
  -- Lock progress before job/guard to match the send and recovery paths.
  select p.* into v_progress
  from public.outreach_dispatch_jobs j join public.lead_sequence_progress p on p.id = j.progress_id
  where j.id = p_job_id and j.claim_token = p_claim_token for update of p;
  if not found then return false; end if;

  select j.* into v_job from public.outreach_dispatch_jobs j
  join public.outreach_dispatch_batches b on b.id = j.batch_id
  where j.id = p_job_id and j.claim_token = p_claim_token and j.status = 'started'
    and b.workflow_revision = 'poutreach_backup_v1' for update of j;
  if not found then return false; end if;

  if p_outcome in ('sent', 'failed', 'ambiguous', 'already_sent') then
    select * into v_guard from public.outreach_email_send_guard
    where id = p_guard_id and progress_id = v_job.progress_id and sequence_step = v_job.step
    for update;
    if not found then return false; end if;
    if p_outcome = 'already_sent' then
      if v_guard.state <> 'sent' then return false; end if;
    else
      if v_guard.state <> 'reserved' or v_guard.attempt_token is distinct from p_attempt_token
         or v_guard.claim_token is distinct from p_claim_token then return false; end if;
      update public.outreach_email_send_guard
      set state = p_outcome, lease_until = null, updated_at = v_now,
          last_error = case when p_outcome = 'sent' then null else left(p_reason, 250) end,
          sent_at = case when p_outcome = 'sent' then v_now else sent_at end,
          message_id = coalesce(p_message_id, message_id)
      where id = v_guard.id returning * into v_guard;
    end if;
    v_message_id := v_guard.message_id;
  end if;

  if p_outcome = 'sent' then
    insert into public.conversation_history (
      lead_id, campaign_id, channel, from_role, message, channel_id, email_subject,
      email_message_id, email_from, email_to
    ) values (
      v_job.lead_id, v_job.campaign_id, 'email', 'ai', p_body, v_guard.channel_id,
      p_subject, v_message_id, p_from, p_to
    ) on conflict do nothing;
    insert into public.lead_activity_history
      (lead_id, campaign_id, status, executed_at, type, channel_response)
    values (v_job.lead_id, v_job.campaign_id, 'sent', v_now, 'email', v_message_id);
  end if;

  if p_outcome = 'failed' and p_quarantine and v_guard.channel_id is not null then
    update public.channels set is_active = false where id = v_guard.channel_id;
  end if;

  v_status := case
    when p_outcome in ('sent', 'already_sent') then 'done'
    when p_outcome in ('deferred', 'failed') then 'ready'
    when p_outcome in ('stopped', 'ambiguous') then 'stopped'
  end;
  if v_status is null then raise exception 'Invalid backup dispatch outcome'; end if;

  -- A reply or cancellation may have won the race while SMTP was in flight.
  -- Keep the send history, but leave a stopped/reclaimed progress row alone.
  update public.lead_sequence_progress
  set status = v_status, stop_reason = left(p_reason, 250),
      next_at = case
        when v_status = 'ready' then coalesce(p_retry_at, v_now + interval '15 minutes')
        when v_status = 'stopped' then v_now + interval '24 hours'
        else next_at
      end,
      last_contacted_at = case when v_status = 'done' then v_now else last_contacted_at end,
      reply_to_message_id = case when v_status = 'done' then v_message_id else reply_to_message_id end,
      channel_id = case when v_status = 'done' then coalesce(v_guard.channel_id, channel_id) else channel_id end
  where id = v_progress.id and status = 'running' and decision->>'claim_token' = p_claim_token::text;

  update public.outreach_dispatch_jobs
  set status = 'finished', finished_at = v_now,
      last_error = case when v_status = 'done' then null else left(p_reason, 250) end
  where id = p_job_id;
  return true;
end;
$$;

revoke execute on function public.outreach_backup_authorize(text),
  public.outreach_backup_preview(),
  public.outreach_backup_claim(text),
  public.outreach_backup_start_job(uuid, uuid),
  public.outreach_backup_begin_email(uuid, uuid, uuid, text),
  public.outreach_backup_finish_job(uuid, uuid, text, text, timestamptz, uuid, uuid, text, text, text, text, text, boolean)
from public, anon, authenticated;
grant execute on function public.outreach_backup_authorize(text),
  public.outreach_backup_preview(),
  public.outreach_backup_claim(text),
  public.outreach_backup_start_job(uuid, uuid),
  public.outreach_backup_begin_email(uuid, uuid, uuid, text),
  public.outreach_backup_finish_job(uuid, uuid, text, text, timestamptz, uuid, uuid, text, text, text, text, text, boolean)
to service_role;

-- Admin-only controls. 'draining' stops new backup claims and keeps n8n fenced.
create or replace function outreach_private.backup_set_mode(p_mode text)
returns text language plpgsql set search_path = '' as $$
declare
  v_mode text;
begin
  if p_mode not in ('primary', 'backup', 'draining') then raise exception 'Unknown mode'; end if;
  select mode into strict v_mode from outreach_private.backup_worker_control where singleton for update;
  if p_mode = v_mode then return v_mode; end if;
  if p_mode = 'draining' and v_mode <> 'backup' then raise exception 'Start draining from backup mode'; end if;
  if p_mode = 'primary' and v_mode <> 'draining' then raise exception 'Drain backup before returning to primary'; end if;
  if p_mode = 'backup' and v_mode <> 'primary' then raise exception 'Start backup from primary mode'; end if;
  if p_mode <> 'draining' and exists (
    select 1 from public.outreach_dispatch_jobs j
    join public.lead_sequence_progress p on p.id = j.progress_id
    join public.outreach_dispatch_batches b on b.id = j.batch_id
    join public.campaigns c on c.id = j.campaign_id
    where j.status in ('claimed', 'started')
      and (b.workflow_revision = 'poutreach_backup_v1') = (p_mode = 'primary')
      and (
        (p.status = 'running' and p.decision->>'claim_token' = j.claim_token::text
          and p.next_at > now() and (c.status = 'active' or j.status = 'started'))
        or exists (
          select 1 from public.outreach_email_send_guard g
          where g.progress_id = j.progress_id and g.claim_token = j.claim_token
            and g.state = 'reserved' and g.lease_until > now()
        )
      )
  ) then
    raise exception 'Active dispatch jobs are still draining';
  end if;
  update outreach_private.backup_worker_control set mode = p_mode where singleton;
  return p_mode;
end;
$$;
revoke execute on function outreach_private.backup_set_mode(text) from public, anon, authenticated, service_role;

create or replace function outreach_private.backup_invoke(p_mode text)
returns bigint language plpgsql set search_path = '' as $$
declare
  v_control outreach_private.backup_worker_control%rowtype;
begin
  if p_mode not in ('preview', 'sender_health', 'tick') then raise exception 'Unknown invocation mode'; end if;
  select * into strict v_control from outreach_private.backup_worker_control where singleton;
  if v_control.project_url is null or v_control.sender_url is null then
    raise exception 'Backup worker endpoints must be configured';
  end if;
  if p_mode = 'tick' and v_control.mode <> 'backup' then return null; end if;
  return net.http_post(
    url := v_control.project_url || '/functions/v1/outreach-backup-worker',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-outreach-backup-token', v_control.token),
    body := jsonb_build_object('mode', p_mode),
    timeout_milliseconds := 100000
  );
end;
$$;
revoke execute on function outreach_private.backup_invoke(text) from public, anon, authenticated, service_role;

select cron.schedule(
  'poutreach-outreach-backup-worker',
  '* * * * *',
  $cron$select outreach_private.backup_invoke('tick');$cron$
);
