create table if not exists public.conversation_events (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  session_id text not null,
  role text not null check (role in ('user', 'assistant', 'meta')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists conversation_events_email_created_at_idx
  on public.conversation_events (email, created_at desc);

create index if not exists conversation_events_session_id_created_at_idx
  on public.conversation_events (session_id, created_at);

create table if not exists public.conversation_memory (
  email text primary key,
  summary text not null default '',
  summary_segments jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  last_session_id text
);

alter table public.conversation_memory
  add constraint conversation_memory_email_unique unique (email);
