-- Run once in Supabase SQL Editor. Lets an item suit several occasion levels (1 to 5).
alter table public.clothing_items add column if not exists formality_levels smallint[];
update public.clothing_items set formality_levels = array[formality::smallint] where formality_levels is null;
