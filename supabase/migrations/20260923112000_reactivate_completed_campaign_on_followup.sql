-- Append deterministic follow-ups to completed campaigns safely.
-- A completed campaign is reactivated only when adding a new sequence step
-- actually reopens one or more non-replied leads.

create or replace function public.on_campaign_sequence_saved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_content text;
  v_reopened integer := 0;
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

    get diagnostics v_reopened = row_count;

    if v_reopened > 0 then
      update public.campaigns
      set status = 'active',
          updated_at = now()
      where id = new.campaign_id
        and status = 'completed';
    end if;
  end if;

  return new;
end;
$$;
