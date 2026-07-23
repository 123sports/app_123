
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS dominant_hand text,
  ADD COLUMN IF NOT EXISTS games_won integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS aces integer NOT NULL DEFAULT 0;
