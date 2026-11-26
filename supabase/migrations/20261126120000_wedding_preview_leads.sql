create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  couple_names text not null,
  phone text not null,
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'paid')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz
);

create table if not exists public.preview_drafts (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  lead_id uuid not null references public.leads(id) on delete cascade,
  template_id text not null,
  draft_data jsonb,
  status text not null default 'unpaid'
    check (status in ('unpaid', 'paid', 'published')),
  expires_at timestamptz not null,
  payment_pending_until timestamptz,
  payment_order_id text,
  payment_id text,
  couple_slug text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  check ((status = 'published' and couple_slug is not null and draft_data is null)
      or (status <> 'published' and draft_data is not null))
);

create table if not exists public.preview_payment_orders (
  order_id text primary key,
  draft_id uuid not null references public.preview_drafts(id) on delete cascade,
  payment_id text unique,
  signature text,
  created_at timestamptz not null default now(),
  verified_at timestamptz
);

create index if not exists preview_drafts_expiry_idx
  on public.preview_drafts (expires_at)
  where status = 'unpaid';
create index if not exists preview_drafts_lead_idx
  on public.preview_drafts (lead_id);
create index if not exists preview_payment_orders_draft_idx
  on public.preview_payment_orders (draft_id);

alter table public.leads enable row level security;
alter table public.preview_drafts enable row level security;
alter table public.preview_payment_orders enable row level security;

grant usage on schema public to service_role;
grant all privileges on table public.leads, public.preview_drafts, public.preview_payment_orders to service_role;

create extension if not exists pg_cron;

select cron.unschedule(jobid)
from cron.job
where jobname = 'purge-expired-wedding-preview-drafts';

select cron.schedule(
  'purge-expired-wedding-preview-drafts',
  '*/10 * * * *',
  $job$
    delete from public.preview_drafts
    where status = 'unpaid'
      and expires_at <= now()
      and (payment_pending_until is null or payment_pending_until <= now());
  $job$
);
