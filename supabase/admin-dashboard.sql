-- Aqua Municipal dashboard setup.
-- Run this in the same Supabase project used by the water token purchasing app.

create extension if not exists pgcrypto;

do $$ begin
  create type public.aqua_admin_role as enum ('mua_super_admin', 'mua_admin', 'municipal_admin');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  role public.aqua_admin_role not null default 'municipal_admin',
  municipality text,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_by uuid references public.admin_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint municipal_admin_requires_municipality
    check (role <> 'municipal_admin' or municipality is not null)
);

create table if not exists public.distribution_account_balances (
  id uuid primary key default gen_random_uuid(),
  municipality text not null unique,
  funded_balance numeric(14, 2) not null default 0,
  currency text not null default 'NAD',
  warning_20k_sent_at timestamptz,
  warning_10k_sent_at timestamptz,
  warning_5k_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.distribution_account_ledger (
  id uuid primary key default gen_random_uuid(),
  balance_id uuid not null references public.distribution_account_balances(id) on delete cascade,
  voucher_id uuid references public.vouchers(id) on delete set null,
  entry_type text not null check (entry_type in ('funding_load', 'voucher_issued', 'voucher_redeemed', 'voucher_cancelled', 'manual_adjustment')),
  amount numeric(14, 2) not null,
  note text,
  created_by uuid references public.admin_users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.distribution_balance_alerts (
  id uuid primary key default gen_random_uuid(),
  balance_id uuid not null references public.distribution_account_balances(id) on delete cascade,
  threshold_amount numeric(14, 2) not null,
  headroom_amount numeric(14, 2) not null,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  acknowledged_by uuid references public.admin_users(id),
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function public.is_active_aqua_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where auth_user_id = auth.uid()
      and status = 'active'
  );
$$;

create or replace function public.current_aqua_admin_role()
returns public.aqua_admin_role
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.admin_users
  where auth_user_id = auth.uid()
    and status = 'active'
  limit 1;
$$;

create or replace view public.aqua_voucher_admin_view as
select
  v.id as voucher_id,
  v.voucher_code,
  lower(coalesce(v.status, 'pending')) as voucher_status,
  v.user_id,
  u.phone_number as buyer_phone_number,
  u.full_name as buyer_full_name,
  v.denomination,
  v.service_fee,
  v.total_amount,
  v.payment_method,
  v.paid_at,
  v.created_at as voucher_created_at,
  v.redeemed_at as voucher_redeemed_at,
  r.id as redemption_id,
  r.kiosk_id,
  r.municipality,
  r.customer_name,
  r.account_number,
  r.meter_number,
  r.erf_number,
  r.quantity,
  r.unit_price,
  r.receipt_number,
  r.card_number,
  p.transaction_reference,
  p.status as payment_status
from public.vouchers v
left join public.users u on u.id = v.user_id
left join public.redemptions r on r.voucher_id = v.id
left join public.payment_transactions p on p.voucher_id = v.id;

alter table public.admin_users enable row level security;
alter table public.distribution_account_balances enable row level security;
alter table public.distribution_account_ledger enable row level security;
alter table public.distribution_balance_alerts enable row level security;

do $$ begin
  create policy "Aqua admins can read own admin profile"
  on public.admin_users for select
  to authenticated
  using (auth_user_id = auth.uid());
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Aqua super admins can read admin users"
  on public.admin_users for select
  to authenticated
  using (
    exists (
      select 1 from public.admin_users au
      where au.auth_user_id = auth.uid()
        and au.role = 'mua_super_admin'
        and au.status = 'active'
    )
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Aqua admins can read distribution balances"
  on public.distribution_account_balances for select
  to authenticated
  using (
    exists (
      select 1 from public.admin_users au
      where au.auth_user_id = auth.uid()
        and au.status = 'active'
        and (au.role in ('mua_super_admin', 'mua_admin') or au.municipality = distribution_account_balances.municipality)
    )
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Aqua admins can read distribution ledger"
  on public.distribution_account_ledger for select
  to authenticated
  using (
    exists (
      select 1
      from public.admin_users au
      join public.distribution_account_balances dab on dab.id = distribution_account_ledger.balance_id
      where au.auth_user_id = auth.uid()
        and au.status = 'active'
        and (au.role in ('mua_super_admin', 'mua_admin') or au.municipality = dab.municipality)
    )
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Aqua admins can read balance alerts"
  on public.distribution_balance_alerts for select
  to authenticated
  using (
    exists (
      select 1
      from public.admin_users au
      join public.distribution_account_balances dab on dab.id = distribution_balance_alerts.balance_id
      where au.auth_user_id = auth.uid()
        and au.status = 'active'
        and (au.role in ('mua_super_admin', 'mua_admin') or au.municipality = dab.municipality)
    )
  );
exception when duplicate_object then null;
end $$;

-- Admin read policies for the existing app tables. If RLS is disabled on these
-- tables, these policies are harmless until you enable RLS.
do $$ begin
  create policy "Aqua admins can read users"
  on public.users for select
  to authenticated
  using (public.is_active_aqua_admin());
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Aqua admins can read vouchers"
  on public.vouchers for select
  to authenticated
  using (public.is_active_aqua_admin());
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Aqua admins can read redemptions"
  on public.redemptions for select
  to authenticated
  using (public.is_active_aqua_admin());
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Aqua admins can read payment transactions"
  on public.payment_transactions for select
  to authenticated
  using (public.is_active_aqua_admin());
exception when duplicate_object then null;
end $$;

insert into public.distribution_account_balances (municipality, funded_balance)
values ('Aqua Municipal', 100000)
on conflict (municipality) do nothing;

-- Create the first dashboard admin:
-- 1. Supabase Dashboard > Authentication > Users > Add user.
-- 2. Copy the new auth.users id.
-- 3. Replace AUTH_USER_UUID_HERE and run:
--
-- insert into public.admin_users (auth_user_id, email, full_name, role)
-- values ('AUTH_USER_UUID_HERE', 'admin@example.com', 'Main Admin', 'mua_super_admin');
