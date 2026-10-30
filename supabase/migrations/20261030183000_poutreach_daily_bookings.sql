
-- Poutreach daily booking chart series. Read-only; only the signed-in user's
-- campaigns are visible (SECURITY INVOKER plus explicit auth.uid filter).
-- p_end exclusive; grouping by UTC calendar day to match daily outreach charts.
-- "booked" = when booked, "scheduled" = when the meeting is scheduled to start.
CREATE OR REPLACE FUNCTION public.poutreach_daily_bookings(
  p_start timestamptz,
  p_end timestamptz
)
RETURNS TABLE(
  campaign_id uuid,
  booking_day date,
  date_basis text,
  appointment_count bigint,
  unique_people bigint
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public
AS $fn$
WITH owned AS (
  SELECT id FROM public.campaigns WHERE user_id = (SELECT auth.uid())
),
events AS (
  SELECT b.campaign_id,
    COALESCE(NULLIF(b.provider, ''), 'unknown') AS provider_key,
    COALESCE(NULLIF(b.provider_event_id, ''), b.id::text) AS event_key,
    COALESCE(NULLIF(lower(btrim(b.invitee_email)), ''),
             NULLIF(lower(btrim(u.email)), ''),
             b.lead_id::text, b.id::text) AS person_key,
    b.created_at AS event_at, 'booked'::text AS basis, b.updated_at, b.id
  FROM public.bookings b
  JOIN owned c ON c.id = b.campaign_id
  LEFT JOIN public.uploaded_leads u ON u.id = b.lead_id
  WHERE COALESCE(b.booking_status,'booked') NOT IN ('cancelled','canceled')
    AND b.created_at >= p_start AND b.created_at < p_end
  UNION ALL
  SELECT b.campaign_id,
    COALESCE(NULLIF(b.provider, ''), 'unknown'),
    COALESCE(NULLIF(b.provider_event_id, ''), b.id::text),
    COALESCE(NULLIF(lower(btrim(b.invitee_email)), ''),
             NULLIF(lower(btrim(u.email)), ''),
             b.lead_id::text, b.id::text),
    b.scheduled_at, 'scheduled'::text, b.updated_at, b.id
  FROM public.bookings b
  JOIN owned c ON c.id = b.campaign_id
  LEFT JOIN public.uploaded_leads u ON u.id = b.lead_id
  WHERE COALESCE(b.booking_status,'booked') NOT IN ('cancelled','canceled')
    AND b.scheduled_at IS NOT NULL
    AND b.scheduled_at >= p_start AND b.scheduled_at < p_end
),
one_per_appointment AS (
  SELECT e.*,
    ROW_NUMBER() OVER (
      PARTITION BY e.campaign_id, e.basis, e.provider_key, e.event_key
      ORDER BY e.updated_at DESC NULLS LAST, e.event_at DESC, e.id DESC
    ) AS rn
  FROM events e
)
SELECT campaign_id, (event_at AT TIME ZONE 'UTC')::date AS booking_day,
       basis AS date_basis,
       count(*)::bigint AS appointment_count,
       count(DISTINCT person_key)::bigint AS unique_people
FROM one_per_appointment
WHERE rn = 1
GROUP BY campaign_id, (event_at AT TIME ZONE 'UTC')::date, basis
ORDER BY booking_day, campaign_id, date_basis;
$fn$;

REVOKE ALL ON FUNCTION public.poutreach_daily_bookings(timestamptz,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.poutreach_daily_bookings(timestamptz,timestamptz) TO authenticated;
