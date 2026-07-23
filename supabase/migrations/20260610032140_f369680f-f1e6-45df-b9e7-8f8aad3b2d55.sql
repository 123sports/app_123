
CREATE OR REPLACE FUNCTION public.get_players_stats(_user_ids uuid[])
RETURNS TABLE(
  user_id uuid,
  level_name text,
  level_color text,
  level_slug text,
  matches_played int,
  certificates_count int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH ids AS (
    SELECT unnest(_user_ids) AS uid
  ),
  evals AS (
    SELECT student_id, AVG(overall_score)::numeric(4,2) AS avg_s
    FROM public.student_evaluations
    WHERE student_id = ANY(_user_ids)
      AND evaluation_date >= (CURRENT_DATE - INTERVAL '90 days')
    GROUP BY student_id
  ),
  user_level AS (
    SELECT i.uid,
      (SELECT l.name FROM public.student_levels l
        WHERE l.min_score <= COALESCE(e.avg_s, 0)
        ORDER BY l.rank_order DESC LIMIT 1) AS lname,
      (SELECT l.color FROM public.student_levels l
        WHERE l.min_score <= COALESCE(e.avg_s, 0)
        ORDER BY l.rank_order DESC LIMIT 1) AS lcolor,
      (SELECT l.slug FROM public.student_levels l
        WHERE l.min_score <= COALESCE(e.avg_s, 0)
        ORDER BY l.rank_order DESC LIMIT 1) AS lslug
    FROM ids i LEFT JOIN evals e ON e.student_id = i.uid
  ),
  matches AS (
    SELECT i.uid,
      (
        (SELECT COUNT(*)::int FROM public.open_matches om
          WHERE om.creator_id = i.uid
            AND om.status IN ('aprovado','fechado')
            AND om.match_date <= CURRENT_DATE)
        +
        (SELECT COUNT(*)::int FROM public.open_match_participants omp
          JOIN public.open_matches om2 ON om2.id = omp.match_id
          WHERE omp.user_id = i.uid
            AND om2.creator_id <> i.uid
            AND om2.status IN ('aprovado','fechado')
            AND om2.match_date <= CURRENT_DATE)
        +
        (SELECT COUNT(*)::int FROM public.bookings b
          WHERE b.user_id = i.uid
            AND b.status = 'confirmada'
            AND b.booking_date <= CURRENT_DATE)
        +
        (SELECT COUNT(*)::int FROM public.booking_participants bp
          JOIN public.bookings b2 ON b2.id = bp.booking_id
          WHERE bp.user_id = i.uid
            AND b2.user_id <> i.uid
            AND b2.status = 'confirmada'
            AND b2.booking_date <= CURRENT_DATE)
      ) AS cnt
    FROM ids i
  ),
  certs AS (
    SELECT i.uid,
      (SELECT COUNT(*)::int FROM public.certificates c WHERE c.student_id = i.uid) AS cnt
    FROM ids i
  )
  SELECT
    i.uid,
    ul.lname,
    ul.lcolor,
    ul.lslug,
    COALESCE(m.cnt, 0),
    COALESCE(c.cnt, 0)
  FROM ids i
  LEFT JOIN user_level ul ON ul.uid = i.uid
  LEFT JOIN matches m ON m.uid = i.uid
  LEFT JOIN certs c ON c.uid = i.uid;
$$;

REVOKE EXECUTE ON FUNCTION public.get_players_stats(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_players_stats(uuid[]) TO authenticated;
