export type AdminRole = "mua_super_admin" | "mua_admin" | "municipal_admin"

export type AdminUser = {
  id: string
  auth_user_id: string
  email: string
  full_name: string | null
  role: AdminRole
  municipality: string | null
  status: "active" | "disabled" | string
  created_at?: string
}

export type ResidentUser = {
  id?: string
  phone_number: string | null
  full_name: string | null
}

export type PaymentTransaction = {
  id: string
  user_id: string
  voucher_id: string
  amount: number | string | null
  payment_method: string | null
  status: string | null
  transaction_reference: string | null
  created_at: string | null
}

export type Redemption = {
  id: string
  voucher_id: string
  kiosk_id: string | null
  municipality: string | null
  customer_name: string | null
  account_number: string | null
  meter_number: string | null
  erf_number: string | null
  quantity: number | string | null
  unit_price: number | string | null
  receipt_number: string | null
  redeemed_at: string | null
  card_number: string | null
}

export type Voucher = {
  id: string
  user_id: string
  denomination: number | string | null
  status: string | null
  voucher_code: string | null
  service_fee: number | string | null
  total_amount: number | string | null
  redeemed_at: string | null
  redeemed_by_kiosk_id: string | null
  cancelled_at: string | null
  expires_at: string | null
  created_at: string | null
  updated_at: string | null
  payment_method: string | null
  paid_at: string | null
  users?: ResidentUser | null
  redemptions?: Redemption[] | Redemption | null
  payment_transactions?: PaymentTransaction[] | PaymentTransaction | null
}

export type DistributionAccountBalance = {
  id: string
  municipality: string
  funded_balance: number | string
  currency: string | null
  warning_20k_sent_at: string | null
  warning_10k_sent_at: string | null
  warning_5k_sent_at: string | null
  updated_at: string | null
}

export type Metrics = {
  totalSales: number
  serviceFees: number
  pendingValue: number
  availableValue: number
  redeemedValue: number
  pendingCount: number
  availableCount: number
  redeemedCount: number
  cancelledCount: number
  voucherCount: number
  redemptionCount: number
  fundedBalance: number
  issuedExposure: number
  issueHeadroom: number
  actualMunicipalBalance: number
}
