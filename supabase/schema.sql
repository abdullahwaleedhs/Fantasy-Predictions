-- Fantasy Predictions - Database schema for Supabase
-- Paste this whole file into the Supabase SQL Editor and click "Run".

-- ============ PROFILES (one row per registered user) ============
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  username text not null unique,
  avatar text,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "Profiles are viewable by everyone"
  on profiles for select using (true);

create policy "Users can insert their own profile"
  on profiles for insert with check (auth.uid() = id);

create policy "Users can update their own profile"
  on profiles for update using (auth.uid() = id);

-- ============ TOURNAMENTS ============
create table if not exists tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  logo text,
  created_at timestamptz not null default now()
);

alter table tournaments enable row level security;

create policy "Tournaments are viewable by everyone"
  on tournaments for select using (true);

create policy "Authenticated users can manage tournaments"
  on tournaments for all using (auth.role() = 'authenticated');

-- ============ CLUBS ============
create table if not exists clubs (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  name text not null,
  logo text,
  created_at timestamptz not null default now()
);

alter table clubs enable row level security;

create policy "Clubs are viewable by everyone"
  on clubs for select using (true);

create policy "Authenticated users can manage clubs"
  on clubs for all using (auth.role() = 'authenticated');

-- ============ MATCHES ============
create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references tournaments(id) on delete set null,
  home text not null,
  home_logo text,
  away text not null,
  away_logo text,
  match_date date,
  match_time time,
  actual_home int,
  actual_away int,
  double_points boolean not null default false,
  created_at timestamptz not null default now()
);

alter table matches enable row level security;

create policy "Matches are viewable by everyone"
  on matches for select using (true);

create policy "Authenticated users can manage matches"
  on matches for all using (auth.role() = 'authenticated');

-- ============ PREDICTIONS (one row per user per match) ============
create table if not exists predictions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  pred_home int,
  pred_away int,
  user_boost boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (match_id, user_id)
);

alter table predictions enable row level security;

create policy "Predictions are viewable by everyone"
  on predictions for select using (true);

create policy "Users can insert their own predictions"
  on predictions for insert with check (auth.uid() = user_id);

create policy "Users can update their own predictions"
  on predictions for update using (auth.uid() = user_id);

-- ============ LEAGUES (private leagues) ============
create table if not exists leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table leagues enable row level security;

create policy "Leagues are viewable by everyone"
  on leagues for select using (true);

create policy "Authenticated users can create leagues"
  on leagues for insert with check (auth.role() = 'authenticated');

create policy "Creators can update their leagues"
  on leagues for update using (auth.uid() = created_by);

-- ============ LEAGUE MEMBERS ============
create table if not exists league_members (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  display_name text not null,
  joined_at timestamptz not null default now(),
  unique (league_id, user_id)
);

alter table league_members enable row level security;

create policy "League members are viewable by everyone"
  on league_members for select using (true);

create policy "Users can join leagues themselves"
  on league_members for insert with check (auth.uid() = user_id);

create policy "Users can update their own membership"
  on league_members for update using (auth.uid() = user_id);

-- ============ Helpful indexes ============
create index if not exists idx_clubs_tournament on clubs(tournament_id);
create index if not exists idx_matches_tournament on matches(tournament_id);
create index if not exists idx_predictions_match on predictions(match_id);
create index if not exists idx_predictions_user on predictions(user_id);
create index if not exists idx_league_members_league on league_members(league_id);
create index if not exists idx_league_members_user on league_members(user_id);
