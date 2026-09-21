-- Keep outreach-engine queue rows runnable by n8n.
-- n8n Get Ready Leads filters next_at <= now(), and SQL NULL never satisfies
-- that predicate. Make initial sequence rows due immediately unless explicitly
-- scheduled for a later time.

update public.lead_sequence_progress
set next_at = now()
where status = 'ready'
  and next_at is null;

alter table public.lead_sequence_progress
  alter column next_at set default now();

-- Do not leave an exhausted campaign active forever. The n8n campaign picker
-- only pulls active campaigns, so an active campaign with no runnable sequence
-- rows can otherwise block a newer campaign.
create or replace function public.complete_campaign_when_sequences_finish()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.campaign_id is not null
     and new.status in ('done','completed','failed','error') then
    update public.campaigns c
    set status = 'completed',
        updated_at = now()
    where c.id = new.campaign_id
      and c.status = 'active'
      and exists (
        select 1
        from public.lead_sequence_progress p
        where p.campaign_id = new.campaign_id
      )
      and not exists (
        select 1
        from public.lead_sequence_progress p
        where p.campaign_id = new.campaign_id
          and p.status in ('ready','queued','running','processing')
      );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_complete_campaign_when_sequences_finish
  on public.lead_sequence_progress;

create trigger trg_complete_campaign_when_sequences_finish
after insert or update of status
on public.lead_sequence_progress
for each row
execute function public.complete_campaign_when_sequences_finish();
