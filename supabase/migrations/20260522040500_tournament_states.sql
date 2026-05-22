create table if not exists public.tournament_states (
  id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.tournament_states enable row level security;

drop policy if exists "anyone can read tournament states" on public.tournament_states;
drop policy if exists "anyone can create tournament states" on public.tournament_states;
drop policy if exists "anyone can update tournament states" on public.tournament_states;

create policy "anyone can read tournament states"
  on public.tournament_states
  for select
  to anon, authenticated
  using (true);

create policy "anyone can create tournament states"
  on public.tournament_states
  for insert
  to anon, authenticated
  with check (true);

create policy "anyone can update tournament states"
  on public.tournament_states
  for update
  to anon, authenticated
  using (true)
  with check (true);

create or replace function public.set_tournament_state_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_tournament_state_updated_at on public.tournament_states;

create trigger set_tournament_state_updated_at
  before update on public.tournament_states
  for each row
  execute function public.set_tournament_state_updated_at();

alter table public.tournament_states replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.tournament_states;
exception
  when duplicate_object then null;
end $$;
