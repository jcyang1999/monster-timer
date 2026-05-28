create table if not exists public.users (
  id text primary key,
  username text not null,
  salt text not null,
  password_hash text not null,
  is_admin boolean not null default false,
  admin_since timestamptz,
  created_at timestamptz not null
);

create unique index if not exists users_username_lower_idx
  on public.users (lower(username));

create table if not exists public.sessions (
  token text primary key,
  user_id text not null references public.users(id) on delete cascade,
  created_at timestamptz not null
);

create table if not exists public.monsters (
  id text primary key,
  name text not null,
  respawn_minutes integer not null,
  order_value bigint not null,
  created_at timestamptz not null,
  created_by text not null references public.users(id),
  updated_at timestamptz,
  updated_by text references public.users(id),
  deleted_at timestamptz,
  deleted_by text references public.users(id)
);

create index if not exists monsters_deleted_order_idx
  on public.monsters (deleted_at, order_value);

create table if not exists public.kill_events (
  id text primary key,
  monster_id text not null references public.monsters(id) on delete cascade,
  killer_id text not null references public.users(id),
  killed_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz,
  updated_by text references public.users(id),
  note text
);

create index if not exists kill_events_monster_killed_idx
  on public.kill_events (monster_id, killed_at desc);

alter table public.users enable row level security;
alter table public.sessions enable row level security;
alter table public.monsters enable row level security;
alter table public.kill_events enable row level security;
