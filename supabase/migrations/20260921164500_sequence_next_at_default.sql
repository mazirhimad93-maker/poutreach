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
