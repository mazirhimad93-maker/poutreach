
-- Read-only, RLS-respecting engagement metrics for Poutreach.
-- p_end is exclusive. "Unique replied leads" and "conversations" are distinct metrics.
CREATE OR REPLACE FUNCTION public.poutreach_campaign_engagement(
  p_start timestamptz DEFAULT NULL,
  p_end timestamptz DEFAULT NULL
)
RETURNS TABLE (
  campaign_id uuid,
  campaign_name text,
  sent_messages bigint,
  contacted_leads bigint,
  inbound_replies bigint,
  unique_replied_leads bigint,
  conversation_threads bigint,
  reply_rate numeric,
  booked_appointments bigint,
  booked_people bigint,
  latest_reply_at timestamptz
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $fn$
WITH scoped_campaigns AS (
  SELECT c.id, c.name
  FROM public.campaigns c
  WHERE c.user_id = (SELECT auth.uid())
),
outbound AS (
  SELECT a.campaign_id, a.lead_id
  FROM public.lead_activity_history a
  JOIN scoped_campaigns c ON c.id = a.campaign_id
  WHERE a.type = 'email'
    AND a.status = 'sent'
    AND a.lead_id IS NOT NULL
    AND (p_start IS NULL OR a.executed_at >= p_start)
    AND (p_end IS NULL OR a.executed_at < p_end)
),
outbound_agg AS (
  SELECT campaign_id,
         count(*)::bigint AS sent_messages,
         count(DISTINCT lead_id)::bigint AS contacted_leads
  FROM outbound
  GROUP BY campaign_id
),
outbound_unique AS (
  SELECT DISTINCT campaign_id, lead_id FROM outbound
),
inbound AS (
  SELECT h.campaign_id, h.lead_id, h.timestamp,
    COALESCE(
      NULLIF((regexp_match(coalesce(h.email_references, ''), '<([^>]+)>'))[1], ''),
      NULLIF(btrim(split_part(coalesce(h.email_references, ''), ' ', 1)), ''),
      NULLIF(regexp_replace(coalesce(h.email_in_reply_to, ''), '[<>]', '', 'g'), ''),
      h.lead_id::text
    ) AS thread_root
  FROM public.conversation_history h
  JOIN scoped_campaigns c ON c.id = h.campaign_id
  WHERE h.channel = 'email'
    AND h.from_role = 'lead'
    AND h.lead_id IS NOT NULL
    AND (p_start IS NULL OR h.timestamp >= p_start)
    AND (p_end IS NULL OR h.timestamp < p_end)
),
inbound_agg AS (
  SELECT campaign_id,
         count(*)::bigint AS inbound_replies,
         count(DISTINCT lead_id)::bigint AS unique_replied_leads,
         count(DISTINCT (lead_id, thread_root))::bigint AS conversation_threads,
         max(timestamp) AS latest_reply_at
  FROM inbound
  GROUP BY campaign_id
),
inbound_unique AS (
  SELECT DISTINCT campaign_id, lead_id FROM inbound
),
cohort_replies AS (
  SELECT s.campaign_id, count(*)::bigint AS replied_contacted_leads
  FROM outbound_unique s
  JOIN inbound_unique r USING (campaign_id, lead_id)
  GROUP BY s.campaign_id
),
booking_rows AS (
  SELECT b.campaign_id,
    COALESCE(nullif(b.provider,''),'unknown') AS provider,
    COALESCE(nullif(b.provider_event_id,''),b.id::text) AS event_key,
    COALESCE(b.lead_id::text, nullif(lower(btrim(b.invitee_email)), ''), b.id::text) AS person_key
  FROM public.bookings b
  JOIN scoped_campaigns c ON c.id = b.campaign_id
  WHERE COALESCE(b.booking_status,'booked') NOT IN ('cancelled','canceled')
    AND (p_start IS NULL OR b.created_at >= p_start)
    AND (p_end IS NULL OR b.created_at < p_end)
),
booking_agg AS (
  SELECT campaign_id,
         count(DISTINCT (provider, event_key))::bigint AS booked_appointments,
         count(DISTINCT person_key)::bigint AS booked_people
  FROM booking_rows
  GROUP BY campaign_id
)
SELECT c.id AS campaign_id, c.name AS campaign_name,
  COALESCE(o.sent_messages,0)::bigint AS sent_messages,
  COALESCE(o.contacted_leads,0)::bigint AS contacted_leads,
  COALESCE(i.inbound_replies,0)::bigint AS inbound_replies,
  COALESCE(i.unique_replied_leads,0)::bigint AS unique_replied_leads,
  COALESCE(i.conversation_threads,0)::bigint AS conversation_threads,
  CASE WHEN COALESCE(o.contacted_leads,0)=0 THEN 0::numeric
       ELSE round(COALESCE(cr.replied_contacted_leads,0)::numeric / o.contacted_leads * 100,2)
  END AS reply_rate,
  COALESCE(b.booked_appointments,0)::bigint AS booked_appointments,
  COALESCE(b.booked_people,0)::bigint AS booked_people,
  i.latest_reply_at
FROM scoped_campaigns c
LEFT JOIN outbound_agg o ON o.campaign_id = c.id
LEFT JOIN inbound_agg i ON i.campaign_id = c.id
LEFT JOIN cohort_replies cr ON cr.campaign_id = c.id
LEFT JOIN booking_agg b ON b.campaign_id = c.id
ORDER BY COALESCE(o.sent_messages,0) DESC, c.name;
$fn$;
REVOKE ALL ON FUNCTION public.poutreach_campaign_engagement(timestamptz,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.poutreach_campaign_engagement(timestamptz,timestamptz) TO authenticated;
