-- Multi-step outreach sequences with per-step training/copy.
-- Each lead keeps one progress row and advances through campaign_sequences.
-- Replying stops future follow-ups. Adding a new follow-up to an existing
-- campaign re-opens only leads that exhausted the old sequence and did not reply.

alter table public.campaign_sequences
  add column if not exists ai_training text,
  add column if not exists stop_on_reply boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists campaign_sequences_campaign_step_uidx
  on public.campaign_sequences(campaign_id, step_number);

create or replace function public.sequence_training_payload(s public.campaign_sequences)
returns text
language sql
stable
as $$
  select jsonb_build_object(
    'sequence_step_id', s.id,
    'step_number', s.step_number,
    'type', s.type,
    'ai_training', coalesce(s.ai_training, ''),
    'email_subject', coalesce(s.email_subject, ''),
    'email_template', coalesce(s.email_template, ''),
    'stop_on_reply', coalesce(s.stop_on_reply, true)
  )::text;
$$;

create or replace function public.apply_sequence_step_to_progress(
  p_progress_id uuid,
  p_sequence_id uuid,
  p_due_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.campaign_sequences%rowtype;
begin
  select * into s
  from public.campaign_sequences
  where id = p_sequence_id;

  if not found then
    return;
  end if;

  update public.lead_sequence_progress
  set
    step = s.step_number,
    type = s.type,
    sequence_step_id = s.id,
    prompt = coalesce(s.prompt, s.ai_training),
    prompt_override = coalesce(s.ai_training, s.prompt),
    step_name = 'Sequence ' || s.step_number,
    step_training = public.sequence_training_payload(s),
    step_goal = coalesce(s.ai_training, s.prompt),
    step_training_updated_at = now(),
    status = 'ready',
    next_at = coalesce(
      p_due_at,
      now() + make_interval(secs => greatest(coalesce(s.wait_seconds, 0), 0))
    ),
    stop_reason = null,
    channel_id = null
  where id = p_progress_id;
end;
$$;

create or replace function public.sync_uploaded_lead_to_outreach()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  first_step public.campaign_sequences%rowtype;
begin
  if new.campaign_id is null then
    return new;
  end if;

  insert into public.leads (
    id, campaign_id, name, phone, status, user_id
  )
  values (
    new.id, new.campaign_id, new.name, coalesce(new.phone, ''), 'not_called', new.user_id
  )
  on conflict (id) do update
  set campaign_id = excluded.campaign_id,
      name = excluded.name,
      phone = excluded.phone,
      user_id = excluded.user_id;

  if exists (
    select 1 from public.lead_sequence_progress p
    where p.lead_id = new.id and p.campaign_id = new.campaign_id
  ) then
    return new;
  end if;

  select * into first_step
  from public.campaign_sequences
  where campaign_id = new.campaign_id
  order by step_number
  limit 1;

  if found then
    insert into public.lead_sequence_progress (
      lead_id, campaign_id, user_id, step, status, next_at,
      type, sequence_step_id, prompt, prompt_override,
      step_name, step_training, step_goal, step_training_updated_at
    )
    values (
      new.id, new.campaign_id, new.user_id, first_step.step_number, 'ready',
      now() + make_interval(secs => greatest(coalesce(first_step.wait_seconds,0),0)),
      first_step.type, first_step.id,
      coalesce(first_step.prompt, first_step.ai_training),
      coalesce(first_step.ai_training, first_step.prompt),
      'Sequence ' || first_step.step_number,
      public.sequence_training_payload(first_step),
      coalesce(first_step.ai_training, first_step.prompt),
      now()
    );
  else
    insert into public.lead_sequence_progress (
      lead_id, campaign_id, user_id, step, status, next_at, stop_reason
    )
    values (
      new.id, new.campaign_id, new.user_id, 1, 'queued', null, 'waiting_for_sequence'
    );
  end if;

  return new;
end;
$$;

create or replace function public.on_campaign_sequence_saved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.lead_sequence_progress p
  set
    type = new.type,
    sequence_step_id = new.id,
    prompt = coalesce(new.prompt, new.ai_training),
    prompt_override = coalesce(new.ai_training, new.prompt),
    step_name = 'Sequence ' || new.step_number,
    step_training = public.sequence_training_payload(new),
    step_goal = coalesce(new.ai_training, new.prompt),
    step_training_updated_at = now()
  where p.campaign_id = new.campaign_id
    and p.step = new.step_number
    and p.status in ('queued','ready');

  if new.step_number = (
    select min(step_number)
    from public.campaign_sequences
    where campaign_id = new.campaign_id
  ) then
    update public.lead_sequence_progress p
    set
      step = new.step_number,
      type = new.type,
      sequence_step_id = new.id,
      prompt = coalesce(new.prompt, new.ai_training),
      prompt_override = coalesce(new.ai_training, new.prompt),
      step_name = 'Sequence ' || new.step_number,
      step_training = public.sequence_training_payload(new),
      step_goal = coalesce(new.ai_training, new.prompt),
      step_training_updated_at = now(),
      status = 'ready',
      next_at = now() + make_interval(secs => greatest(coalesce(new.wait_seconds,0),0)),
      stop_reason = null
    where p.campaign_id = new.campaign_id
      and p.status = 'queued'
      and p.stop_reason = 'waiting_for_sequence';
  end if;

  if tg_op = 'INSERT' then
    update public.lead_sequence_progress p
    set
      step = new.step_number,
      type = new.type,
      sequence_step_id = new.id,
      prompt = coalesce(new.prompt, new.ai_training),
      prompt_override = coalesce(new.ai_training, new.prompt),
      step_name = 'Sequence ' || new.step_number,
      step_training = public.sequence_training_payload(new),
      step_goal = coalesce(new.ai_training, new.prompt),
      step_training_updated_at = now(),
      status = 'ready',
      next_at = greatest(
        now(),
        coalesce(p.last_contacted_at, now()) +
          make_interval(secs => greatest(coalesce(new.wait_seconds,0),0))
      ),
      stop_reason = null,
      channel_id = null
    where p.campaign_id = new.campaign_id
      and p.status in ('done','completed')
      and p.step < new.step_number
      and not exists (
        select 1
        from public.conversation_history h
        where h.lead_id = p.lead_id
          and h.campaign_id = p.campaign_id
          and h.from_role = 'lead'
      );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_campaign_sequence_saved on public.campaign_sequences;
create trigger trg_campaign_sequence_saved
after insert or update of
  step_number, type, wait_seconds, prompt, ai_training,
  email_subject, email_template, stop_on_reply
on public.campaign_sequences
for each row
execute function public.on_campaign_sequence_saved();

create or replace function public.aaa_advance_sequence_after_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_step public.campaign_sequences%rowtype;
  has_reply boolean;
  current_stop_on_reply boolean := true;
begin
  if new.status not in ('done','completed') then
    return new;
  end if;

  select coalesce(s.stop_on_reply,true)
    into current_stop_on_reply
  from public.campaign_sequences s
  where s.campaign_id = new.campaign_id
    and s.step_number = new.step
  order by s.step_number
  limit 1;

  select exists (
    select 1
    from public.conversation_history h
    where h.lead_id = new.lead_id
      and h.campaign_id = new.campaign_id
      and h.from_role = 'lead'
  ) into has_reply;

  if current_stop_on_reply and has_reply then
    update public.lead_sequence_progress
    set status = 'stopped',
        next_at = null,
        stop_reason = 'replied'
    where id = new.id;
    return new;
  end if;

  select * into next_step
  from public.campaign_sequences s
  where s.campaign_id = new.campaign_id
    and s.step_number > new.step
  order by s.step_number
  limit 1;

  if found then
    perform public.apply_sequence_step_to_progress(
      new.id,
      next_step.id,
      coalesce(new.last_contacted_at, now()) +
        make_interval(secs => greatest(coalesce(next_step.wait_seconds,0),0))
    );
  end if;

  return new;
end;
$$;

drop trigger if exists aaa_advance_sequence_after_completion
  on public.lead_sequence_progress;
create trigger aaa_advance_sequence_after_completion
after update of status
on public.lead_sequence_progress
for each row
when (new.status in ('done','completed'))
execute function public.aaa_advance_sequence_after_completion();

create or replace function public.stop_sequence_on_lead_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.from_role <> 'lead' then
    return new;
  end if;

  update public.uploaded_leads
  set last_reply_at = coalesce(new.timestamp, now()),
      updated_at = now()
  where id = new.lead_id;

  update public.lead_sequence_progress
  set status = 'stopped',
      next_at = null,
      stop_reason = 'replied'
  where lead_id = new.lead_id
    and campaign_id = new.campaign_id
    and status in ('queued','ready','running');

  return new;
end;
$$;

drop trigger if exists trg_stop_sequence_on_lead_reply
  on public.conversation_history;
create trigger trg_stop_sequence_on_lead_reply
after insert
on public.conversation_history
for each row
when (new.from_role = 'lead')
execute function public.stop_sequence_on_lead_reply();

update public.lead_sequence_progress p
set
  type = s.type,
  sequence_step_id = s.id,
  prompt = coalesce(s.prompt, s.ai_training),
  prompt_override = coalesce(s.ai_training, s.prompt),
  step_name = 'Sequence ' || s.step_number,
  step_training = public.sequence_training_payload(s),
  step_goal = coalesce(s.ai_training, s.prompt),
  step_training_updated_at = now()
from public.campaign_sequences s
where s.campaign_id = p.campaign_id
  and s.step_number = p.step
  and p.status in ('queued','ready');
