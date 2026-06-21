# Aqua Municipal Dashboard

Vercel-ready Next.js dashboard for the water purchasing app.

## Local Setup

1. Copy `.env.example` to `.env.local`.
2. Add the Supabase URL and anon key from the same database used by the utility app.
3. Run the SQL in `supabase/admin-dashboard.sql` in the Supabase SQL editor.
4. Create an admin user in Supabase Authentication.
5. Insert that auth user into `public.admin_users` using the SQL comment at the bottom of `admin-dashboard.sql`.
6. Run:

```bash
npm install
npm run dev
```

## Admin Roles

- `mua_super_admin`: full platform visibility and admin user tab
- `mua_admin`: reports and operational visibility
- `municipal_admin`: read-only municipal view for voucher status, redemption, kiosk, and DAB monitoring

## Existing Tables Used

- `users`
- `vouchers`
- `payment_transactions`
- `redemptions`

## New Tables

- `admin_users`
- `distribution_account_balances`
- `distribution_account_ledger`
- `distribution_balance_alerts`

## Balance Logic

- Issued exposure = redeemed voucher value + available voucher value
- Actual municipal balance = DAB funded balance - redeemed voucher value
- Issue headroom = DAB funded balance - issued exposure
- Alerts show at N$ 20,000, N$ 10,000, and N$ 5,000 issue headroom

## Prompt For PaySME Dev

Please describe the PaySME admin dashboard preload/loading behavior, page transitions, empty/loading/error states, toast/notification patterns, login UX details, sidebar active/hover states, and any micro-interactions or animation timings we should match in Aqua Municipal.
