-- MONEXA support: tickets, live chat and their conversation. Users read their own
-- tickets through the gateway; support staff use the admin inbox. Internal notes are
-- never shown to users. A deleted account takes its tickets with it.
-- A live chat is a ticket with channel = 'live'.

create table if not exists public.support_tickets (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text,
  category text not null check (category in ('trade', 'wallet', 'account', 'bug', 'other')),
  subject text not null check (char_length(subject) between 3 and 140),
  status text not null default 'open' check (status in ('open', 'in_progress', 'waiting', 'resolved')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  -- A transaction the ticket is about, when there is one.
  signature text,
  -- Page, browser, account mode and wallet when the ticket was opened.
  context jsonb not null default '{}'::jsonb,
  -- 'ticket' from the Support page form, 'live' from the chat.
  channel text not null default 'ticket' check (channel in ('ticket', 'live')),
  -- The agent handling it (first name), so two people never answer the same chat.
  agent text check (agent is null or char_length(agent) between 1 and 24),
  user_unread boolean not null default false,
  admin_unread boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists support_tickets_user on public.support_tickets (user_id, updated_at desc);
create index if not exists support_tickets_inbox on public.support_tickets (status, updated_at desc);
create index if not exists support_tickets_live on public.support_tickets (user_id, channel, status);

create table if not exists public.support_messages (
  id bigint generated always as identity primary key,
  ticket_id bigint not null references public.support_tickets (id) on delete cascade,
  author text not null check (author in ('user', 'support')),
  -- The agent who wrote a support message (first name), shown to the user.
  agent text check (agent is null or char_length(agent) between 1 and 24),
  body text not null check (char_length(body) between 1 and 5000),
  internal boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists support_messages_ticket on public.support_messages (ticket_id, created_at);

alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
-- No browser policies: everything goes through the gateway, which hides internal notes.
revoke all on public.support_tickets, public.support_messages from anon, authenticated;
