-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run.

create table if not exists public.wardrobe_data (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.wardrobe_data enable row level security;

create policy "own row: select" on public.wardrobe_data
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "own row: insert" on public.wardrobe_data
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "own row: update" on public.wardrobe_data
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "own row: delete" on public.wardrobe_data
  for delete to authenticated using ((select auth.uid()) = user_id);
