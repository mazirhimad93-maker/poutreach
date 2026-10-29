
-- Global deduplicated totals across campaigns, respecting RLS (SECURITY INVOKER).
CREATE OR REPLACE FUNCTION public.poutreach_engagement_totals(
  p_start timestamptz DEFAULT NULL,
  p_end timestamptz DEFAULT NULL
)
RETURNS TABLE (
  sent_messages bigint,
  contacted_leads bigint,
  inbound_replies bigint,
  unique_replied_leads bigint,
  conversation_threads bigint,
  booked_appointments bigint,
  booked_people bigint,
  reply_rate numeric
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public
AS $fn$
WITH accessible_campaigns AS (
 SELECT id FROM public.campaigns
),
sent AS (
 SELECT COALESCE(NULLIF(lower(btrim(u.email)),''), a.lead_id::text) person
 FROM public.lead_activity_history a
 JOIN accessible_campaigns c ON c.id=a.campaign_id
 LEFT JOIN public.uploaded_leads u ON u.id=a.lead_id
 WHERE a.status='sent' AND a.type='email' AND a.lead_id IS NOT NULL
   AND (p_start IS NULL OR a.executed_at >= p_start)
   AND (p_end IS NULL OR a.executed_at < p_end)
),
inbound AS (
 SELECT COALESCE(NULLIF(lower(btrim(u.email)),''), h.lead_id::text) person,
   COALESCE(
     NULLIF((regexp_match(coalesce(h.email_references,''),'<([^>]+)>'))[1],''),
     NULLIF(btrim(split_part(coalesce(h.email_references,''),' ',1)),''),
     NULLIF(regexp_replace(coalesce(h.email_in_reply_to,''),'[<>]','','g'),''),
     h.lead_id::text
   ) thread
 FROM public.conversation_history h
 JOIN accessible_campaigns c ON c.id=h.campaign_id
 LEFT JOIN public.uploaded_leads u ON u.id=h.lead_id
 WHERE h.channel='email' AND h.from_role='lead' AND h.lead_id IS NOT NULL
   AND (p_start IS NULL OR h.timestamp >= p_start)
   AND (p_end IS NULL OR h.timestamp < p_end)
),
booking_rows AS (
 SELECT COALESCE(NULLIF(b.provider,''),'unknown') provider,
   COALESCE(NULLIF(b.provider_event_id,''),b.id::text) event_key,
   COALESCE(NULLIF(lower(btrim(b.invitee_email)),''),NULLIF(lower(btrim(u.email)),''),b.lead_id::text,b.id::text) person
 FROM public.bookings b
 JOIN accessible_campaigns c ON c.id=b.campaign_id
 LEFT JOIN public.uploaded_leads u ON u.id=b.lead_id
 WHERE coalesce(b.booking_status,'booked') NOT IN ('canceled','cancelled')
   AND (p_start IS NULL OR b.created_at >= p_start)
   AND (p_end IS NULL OR b.created_at < p_end)
)
SELECT
 (SELECT count(*) FROM sent)::bigint,
 (SELECT count(DISTINCT person) FROM sent)::bigint,
 (SELECT count(*) FROM inbound)::bigint,
 (SELECT count(DISTINCT person) FROM inbound)::bigint,
 (SELECT count(DISTINCT (person,thread)) FROM inbound)::bigint,
 (SELECT count(DISTINCT (provider,event_key)) FROM booking_rows)::bigint,
 (SELECT count(DISTINCT person) FROM booking_rows)::bigint,
 CASE WHEN (SELECT count(DISTINCT person) FROM sent)=0 THEN 0::numeric
      ELSE round((SELECT count(DISTINCT person) FROM inbound WHERE person IN (SELECT person FROM sent))::numeric /
            (SELECT count(DISTINCT person) FROM sent) * 100,2)
 END;
$fn$;
REVOKE ALL ON FUNCTION public.poutreach_engagement_totals(timestamptz,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.poutreach_engagement_totals(timestamptz,timestamptz) TO authenticated;
