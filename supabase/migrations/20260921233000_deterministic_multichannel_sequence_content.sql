-- Deterministic multi-channel sequence content.
-- The sequence builder writes exact copy/scripts to campaign_sequences.
-- n8n routing remains channel-based; content is attached to the current
-- lead_sequence_progress row as each lead advances.

alter table public.campaign_sequences
  add column if not exists message_template text;

update public.campaign_sequences
set message_template = case
  when type = 'email' then coalesce(message_template, email_template)
  else coalesce(message_template, prompt, ai_training)
end
where message_template is null;

create or replace function public.sequence_training_payload(s public.campaign_sequences)
returns text
language sql
stable
as $$
  select jsonb_build_object(
    'sequence_step_id', s.id,
    'step_number', s.step_number,
    'type', s.type,
    'message_template', coalesce(s.message_template, ''),
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
  v_content text;
begin
  select * into s
  from public.campaign_sequences
  where id = p_sequence_id;

  if not found then
    return;
  end if;

  v_content := coalesce(
    s.message_template,
    case when s.type = 'email' then s.email_template else null end,
    s.prompt,
    s.ai_training
  );

  update public.lead_sequence_progress
  set
    step = s.step_number,
    type = s.type,
    sequence_step_id = s.id,
    prompt = v_content,
    prompt_override = v_content,
    step_name = 'Sequence ' || s.step_number,
    step_training = public.sequence_training_payload(s),
    step_goal = v_content,
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
  v_content text;
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
    v_content := coalesce(
      first_step.message_template,
      case when first_step.type = 'email' then first_step.email_template else null end,
      first_step.prompt,
      first_step.ai_training
    );

    insert into public.lead_sequence_progress (
      lead_id, campaign_id, user_id, step, status, next_at,
      type, sequence_step_id, prompt, prompt_override,
      step_name, step_training, step_goal, step_training_updated_at
    )
    values (
      new.id, new.campaign_id, new.user_id, first_step.step_number, 'ready',
      now() + make_interval(secs => greatest(coalesce(first_step.wait_seconds,0),0)),
      first_step.type, first_step.id,
      v_content,
      v_content,
      'Sequence ' || first_step.step_number,
      public.sequence_training_payload(first_step),
      v_content,
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
declare
  v_content text;
begin
  v_content := coalesce(
    new.message_template,
    case when new.type = 'email' then new.email_template else null end,
    new.prompt,
    new.ai_training
  );

  update public.lead_sequence_progress p
  set
    type = new.type,
    sequence_step_id = new.id,
    prompt = v_content,
    prompt_override = v_content,
    step_name = 'Sequence ' || new.step_number,
    step_training = public.sequence_training_payload(new),
    step_goal = v_content,
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
      prompt = v_content,
      prompt_override = v_content,
      step_name = 'Sequence ' || new.step_number,
      step_training = public.sequence_training_payload(new),
      step_goal = v_content,
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
      prompt = v_content,
      prompt_override = v_content,
      step_name = 'Sequence ' || new.step_number,
      step_training = public.sequence_training_payload(new),
      step_goal = v_content,
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
  message_template, email_subject, email_template, stop_on_reply
on public.campaign_sequences
for each row
execute function public.on_campaign_sequence_saved();

update public.lead_sequence_progress p
set
  prompt = coalesce(
    s.message_template,
    case when s.type = 'email' then s.email_template else null end,
    s.prompt,
    s.ai_training
  ),
  prompt_override = coalesce(
    s.message_template,
    case when s.type = 'email' then s.email_template else null end,
    s.prompt,
    s.ai_training
  ),
  step_training = public.sequence_training_payload(s),
  step_goal = coalesce(
    s.message_template,
    case when s.type = 'email' then s.email_template else null end,
    s.prompt,
    s.ai_training
  ),
  step_training_updated_at = now()
from public.campaign_sequences s
where s.campaign_id = p.campaign_id
  and s.step_number = p.step
  and p.status in ('queued','ready');
