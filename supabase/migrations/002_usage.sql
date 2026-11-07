-- Roledone: monthly metering counters and the AI usage ledger. Server-only (service role).
-- Paste into Supabase → SQL Editor → Run. Safe to re-run.

create table if not exists public.usage_counters (
  subject text not null,          -- user:<uuid> | dev:<device id> | ip:<hash>
  month text not null,            -- 'YYYY-MM' (UTC)
  feature text not null,          -- match | suggestions | …
  count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (subject, month, feature)
);
alter table public.usage_counters enable row level security; -- no policies: service role only

create or replace function public.increment_usage(p_subject text, p_month text, p_feature text)
returns integer language sql security definer set search_path = public as $$
  insert into public.usage_counters (subject, month, feature, count)
  values (p_subject, p_month, p_feature, 1)
  on conflict (subject, month, feature) do update set count = usage_counters.count + 1, updated_at = now()
  returning count;
$$;
revoke all on function public.increment_usage(text, text, text) from public, anon, authenticated;

create table if not exists public.usage_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  model text not null,
  tool text not null,
  subject text,
  plan text,
  input integer not null default 0,
  output integer not null default 0,
  cache_read integer not null default 0,
  cache_write integer not null default 0,
  usd numeric(10,6) not null default 0,
  ms integer not null default 0,
  error boolean not null default false
);
create index if not exists usage_events_at_idx on public.usage_events (at);
alter table public.usage_events enable row level security; -- service role only

create or replace function public.usage_summary(p_month text)
returns table (tool text, model text, calls bigint, input bigint, output bigint, cache_read bigint, cache_write bigint, usd numeric, errors bigint)
language sql security definer set search_path = public as $$
  select tool, model, count(*), sum(input), sum(output), sum(cache_read), sum(cache_write), sum(usd), count(*) filter (where error)
  from public.usage_events
  where to_char(at at time zone 'UTC', 'YYYY-MM') = p_month
  group by tool, model order by sum(usd) desc;
$$;
revoke all on function public.usage_summary(text) from public, anon, authenticated;
