ALTER TABLE public.marketplace_items 
  ADD COLUMN IF NOT EXISTS stock_quantity integer,
  ADD COLUMN IF NOT EXISTS track_stock boolean NOT NULL DEFAULT false;