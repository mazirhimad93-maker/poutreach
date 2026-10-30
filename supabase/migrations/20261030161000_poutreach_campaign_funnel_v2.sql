-- Poutreach cold performance funnel: all counters use the same UTC period,
-- authenticated user's RLS-visible records, and stable email-normalized identities.
CREATE OR REPLACE FUNCTION public.poutreach_campaign_funnel_v2(
  p_start timestamptz DEFAULT NULL,
  p_end timestamptz DEFAULT NULL
)
RETURNS TABLE(
  campaign_id uuid,
  campaign_name text,
  sent_messages bigint,
  contacted_leads bigint,
  inbound_replies bigint,
  unique_replied_leads bigint,
  conversation_threads bigint,
  booked_appointments bigint,
  booked_people bigint,
  replied_contacted_leads bigint,
  booked_contacted_leads bigint,
  booked_replied_leads bigint,
  reply_rate numeric,
  booking_rate numeric,
  reply_to_booking_rate numeric
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $f$
WITH mine AS (
  SELECT c.id, c.name
  FROM public.campaigns c
  WHERE c.user_id = (SELECT auth.uid())
),
sent_events AS (
  SELECT a.campaign_id,
    COALESCE(NULLIF(lower(btrim(u.email)), ''), a.lead_id::text) AS person
  FROM public.lead_activity_history a
  JOIN mine c ON c.id = a.campaign_id
  LEFT JOIN public.uploaded_leads u ON u.id = a.lead_id
  WHERE a.type = 'email' AND a.status = 'sent' AND a.lead_id IS NOT NULL
    AND (p_start IS NULL OR a.executed_at >= p_start)
    AND (p_end IS NULL OR a.executed_at < p_end)
),
sent_people AS (
  SELECT DISTINCT campaign_id, person FROM sent_events
),
inbound_events AS (
  SELECT h.campaign_id,
    COALESCE(NULLIF(lower(btrim(u.email)), ''), h.lead_id::text) AS person,
    COALESCE(
      NULLIF((regexp_match(COALESCE(h.email_references, ''), '<([^>]+)>'))[1], ''),
      NULLIF(btrim(split_part(COALESCE(h.email_references, ''), ' ', 1)), ''),
      NULLIF(regexp_replace(COALESCE(h.email_in_reply_to, ''), '[<>]', '', 'g'), ''),
      h.lead_id::text
    ) AS thread_key
  FROM public.conversation_history h
  JOIN mine c ON c.id = h.campaign_id
  LEFT JOIN public.uploaded_leads u ON u.id = h.lead_id
  WHERE h.channel = 'email' AND h.from_role = 'lead' AND h.lead_id IS NOT NULL
    AND (p_start IS NULL OR h.timestamp >= p_start)
    AND (p_end IS NULL OR h.timestamp < p_end)
),
reply_people AS (
  SELECT DISTINCT campaign_id, person FROM inbound_events
),
booking_events AS (
  SELECT b.campaign_id,
    COALESCE(NULLIF(lower(btrim(u.email)), ''), NULLIF(lower(btrim(b.invitee_email)), ''), b.lead_id::text, b.id::text) AS person,
    COALESCE(NULLIF(b.provider, ''), 'unknown') AS provider_key,
    COALESCE(NULLIF(b.provider_event_id, ''), b.id::text) AS event_key
  FROM public.bookings b
  JOIN mine c ON c.id = b.campaign_id
  LEFT JOIN public.uploaded_leads u ON u.id = b.lead_id
  WHERE COALESCE(b.booking_status, 'booked') NOT IN ('cancelled', 'canceled')
    AND (p_start IS NULL OR b.created_at >= p_start)
    AND (p_end IS NULL OR b.created_at < p_end)
),
booking_people AS (
  SELECT DISTINCT campaign_id, person FROM booking_events
),
sent_agg AS (
  SELECT campaign_id, count(*) AS messages, count(DISTINCT person) AS people
  FROM sent_events GROUP BY campaign_id
),
reply_agg AS (
  SELECT campaign_id, count(*) AS messages, count(DISTINCT person) AS people,
    count(DISTINCT (person, thread_key)) AS threads
  FROM inbound_events GROUP BY campaign_id
),
booking_agg AS (
  SELECT campaign_id, count(DISTINCT (provider_key, event_key)) AS appointments,
    count(DISTINCT person) AS people
  FROM booking_events GROUP BY campaign_id
),
reply_from_sent AS (
  SELECT s.campaign_id, count(*) AS people
  FROM sent_people s JOIN reply_people r USING(campaign_id, person)
  GROUP BY s.campaign_id
),
booked_from_sent AS (
  SELECT s.campaign_id, count(*) AS people
  FROM sent_people s JOIN booking_people b USING(campaign_id, person)
  GROUP BY s.campaign_id
),
booked_from_replies AS (
  SELECT r.campaign_id, count(*) AS people
  FROM reply_people r JOIN booking_people b USING(campaign_id, person)
  GROUP BY r.campaign_id
)
SELECT c.id, c.name,
  COALESCE(s.messages, 0)::bigint,
  COALESCE(s.people, 0)::bigint,
  COALESCE(r.messages, 0)::bigint,
  COALESCE(r.people, 0)::bigint,
  COALESCE(r.threads, 0)::bigint,
  COALESCE(b.appointments, 0)::bigint,
  COALESCE(b.people, 0)::bigint,
  COALESCE(rs.people, 0)::bigint,
  COALESCE(bs.people, 0)::bigint,
  COALESCE(br.people, 0)::bigint,
  CASE WHEN COALESCE(s.people, 0) = 0 THEN NULL::numeric
    ELSE round(COALESCE(rs.people, 0)::numeric / s.people * 100, 2) END,
  CASE WHEN COALESCE(s.people, 0) = 0 THEN NULL::numeric
    ELSE round(COALESCE(bs.people, 0)::numeric / s.people * 100, 2) END,
  CASE WHEN COALESCE(r.people, 0) = 0 THEN NULL::numeric
    ELSE round(COALESCE(br.people, 0)::numeric / r.people * 100, 2) END
FROM mine c
LEFT JOIN sent_agg s ON s.campaign_id = c.id
LEFT JOIN reply_agg r ON r.campaign_id = c.id
LEFT JOIN booking_agg b ON b.campaign_id = c.id
LEFT JOIN reply_from_sent rs ON rs.campaign_id = c.id
LEFT JOIN booked_from_sent bs ON bs.campaign_id = c.id
LEFT JOIN booked_from_replies br ON br.campaign_id = c.id
ORDER BY COALESCE(s.messages, 0) DESC, c.name;
$f$;

REVOKE ALL ON FUNCTION public.poutreach_campaign_funnel_v2(timestamptz,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.poutreach_campaign_funnel_v2(timestamptz,timestamptz) TO authenticated;
