-- Run once in Supabase SQL Editor. Adds the accessory type (bag, watch, ring...).
alter table public.clothing_items add column if not exists subtype text;
update public.clothing_items set subtype = 'other' where category = 'accessory' and subtype is null;
