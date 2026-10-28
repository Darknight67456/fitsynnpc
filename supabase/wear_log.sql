-- Run this once in Supabase: SQL Editor > New query > paste > Run.
create table if not exists public.wear_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_id uuid not null references public.clothing_items(id) on delete cascade,
  worn_on date not null,
  created_at timestamptz not null default now()
);

create index if not exists wear_log_item_idx on public.wear_log (item_id, worn_on desc);

alter table public.wear_log enable row level security;

create policy "own wear log" on public.wear_log
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
