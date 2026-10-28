-- Run once in Supabase SQL Editor. Lets clothing_items.category accept 'dress'.
alter table public.clothing_items drop constraint if exists clothing_items_category_check;
alter table public.clothing_items
  add constraint clothing_items_category_check
  check (category in ('top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory'));
