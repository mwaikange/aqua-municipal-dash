"use client"

import { useEffect, useMemo, useState } from "react"

import { hasSupabaseConfig, supabase } from "@/lib/supabase"
import type { AdminRole, AdminUser, DistributionAccountBalance, Metrics, PaymentTransaction, Redemption, Voucher } from "@/lib/types"

type ViewKey = "overview" | "vouchers" | "redemptions" | "kiosks" | "balances" | "admins"
type Tone = "ok" | "warn" | "danger" | "info"

type NavItem = {
  id: ViewKey
  label: string
  icon: string
  roles: AdminRole[]
}

const roleLabels: Record<AdminRole, string> = {
  mua_super_admin: "MUA Super Admin",
  mua_admin: "MUA Admin",
  municipal_admin: "Municipal Admin",
}

const navGroups: { label: string; color: string; items: NavItem[] }[] = [
  {
    label: "Platform",
    color: "#79d7d1",
    items: [
      { id: "overview", label: "Dashboard", icon: "▦", roles: ["mua_super_admin", "mua_admin", "municipal_admin"] },
      { id: "vouchers", label: "Vouchers", icon: "◫", roles: ["mua_super_admin", "mua_admin", "municipal_admin"] },
      { id: "redemptions", label: "Redemptions", icon: "✓", roles: ["mua_super_admin", "mua_admin", "municipal_admin"] },
      { id: "kiosks", label: "Kiosks", icon: "▣", roles: ["mua_super_admin", "mua_admin", "municipal_admin"] },
    ],
  },
  {
    label: "Finance",
    color: "#e2a11c",
    items: [{ id: "balances", label: "DAB Monitor", icon: "⌁", roles: ["mua_super_admin", "mua_admin", "municipal_admin"] }],
  },
  {
    label: "Administration",
    color: "#8fb8ff",
    items: [{ id: "admins", label: "Admin Users", icon: "◎", roles: ["mua_super_admin"] }],
  },
]

export default function AquaMunicipalApp() {
  const [booting, setBooting] = useState(true)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [profile, setProfile] = useState<AdminUser | null>(null)
  const [loginError, setLoginError] = useState("")
  const [dataError, setDataError] = useState("")
  const [loadingLogin, setLoadingLogin] = useState(false)
  const [loadingData, setLoadingData] = useState(false)
  const [activeView, setActiveView] = useState<ViewKey>("overview")
  const [search, setSearch] = useState("")
  const [vouchers, setVouchers] = useState<Voucher[]>([])
  const [redemptions, setRedemptions] = useState<Redemption[]>([])
  const [payments, setPayments] = useState<PaymentTransaction[]>([])
  const [admins, setAdmins] = useState<AdminUser[]>([])
  const [balance, setBalance] = useState<DistributionAccountBalance | null>(null)

  useEffect(() => {
    const boot = async () => {
      if (!supabase) {
        setBooting(false)
        return
      }

      const { data } = await supabase.auth.getSession()
      const user = data.session?.user
      if (user) {
        const adminProfile = await fetchAdminProfile(user.id)
        if (adminProfile) {
          setProfile(adminProfile)
          await loadDashboardData(adminProfile)
        }
      }
      setBooting(false)
    }

    boot()
  }, [])

  const fetchAdminProfile = async (authUserId: string) => {
    if (!supabase) return null
    const { data, error } = await supabase
      .from("admin_users")
      .select("*")
      .eq("auth_user_id", authUserId)
      .eq("status", "active")
      .maybeSingle()

    if (error) {
      setLoginError(`Admin profile query failed: ${error.message}`)
      return null
    }

    if (!data) {
      setLoginError("This Supabase Auth user is not active in public.admin_users.")
      return null
    }

    setLoginError("")
    return data as AdminUser
  }

  const loadDashboardData = async (adminProfile = profile) => {
    if (!supabase || !adminProfile) return
    setLoadingData(true)
    setDataError("")

    const municipality = adminProfile.role === "municipal_admin" ? adminProfile.municipality : null
    const voucherQuery = supabase
      .from("vouchers")
      .select("*, users(phone_number, full_name), redemptions(*), payment_transactions(*)")
      .order("created_at", { ascending: false })
      .limit(1000)

    const redemptionQuery = municipality
      ? supabase.from("redemptions").select("*").eq("municipality", municipality).order("redeemed_at", { ascending: false }).limit(1000)
      : supabase.from("redemptions").select("*").order("redeemed_at", { ascending: false }).limit(1000)

    const balanceQuery = municipality
      ? supabase.from("distribution_account_balances").select("*").eq("municipality", municipality).maybeSingle()
      : supabase.from("distribution_account_balances").select("*").order("updated_at", { ascending: false }).limit(1)

    const adminQuery =
      adminProfile.role === "mua_super_admin"
        ? supabase.from("admin_users").select("*").order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null })

    const [voucherResult, redemptionResult, paymentResult, balanceResult, adminResult] = await Promise.all([
      voucherQuery,
      redemptionQuery,
      supabase.from("payment_transactions").select("*").order("created_at", { ascending: false }).limit(1000),
      balanceQuery,
      adminQuery,
    ])

    const errors = [voucherResult.error, redemptionResult.error, paymentResult.error, balanceResult.error, adminResult.error].filter(Boolean)
    if (errors.length > 0) setDataError(errors.map((error) => error?.message).join(" | "))

    const voucherData = ((voucherResult.data ?? []) as Voucher[]).filter((voucher) => {
      if (!municipality) return true
      const redemption = first(voucher.redemptions)
      return !redemption?.municipality || redemption.municipality === municipality
    })

    setVouchers(voucherData)
    setRedemptions((redemptionResult.data ?? []) as Redemption[])
    setPayments((paymentResult.data ?? []) as PaymentTransaction[])
    setBalance(Array.isArray(balanceResult.data) ? ((balanceResult.data[0] ?? null) as DistributionAccountBalance | null) : ((balanceResult.data ?? null) as DistributionAccountBalance | null))
    setAdmins((adminResult.data ?? []) as AdminUser[])
    setLoadingData(false)
  }

  const handleLogin = async () => {
    if (!supabase) {
      setLoginError("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Add .env.local for local dev and Vercel env vars for production.")
      return
    }
    if (!email || !password) {
      setLoginError("Enter an admin email and password.")
      return
    }

    setLoadingLogin(true)
    setLoginError("")
    const normalizedEmail = email.trim().toLowerCase()
    const { data, error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password })
    if (error || !data.user) {
      const message =
        error && "status" in error && error.status === 500
          ? "Supabase Auth returned 500 unexpected_failure. Check Supabase Auth hooks/logs and confirm this user can sign in from the Supabase dashboard."
          : error?.message ?? "Login failed."
      setLoginError(message)
      setLoadingLogin(false)
      return
    }

    const adminProfile = await fetchAdminProfile(data.user.id)
    if (!adminProfile) {
      await supabase.auth.signOut()
      setLoadingLogin(false)
      return
    }

    setProfile(adminProfile)
    await loadDashboardData(adminProfile)
    setLoadingLogin(false)
  }

  const handleLogout = async () => {
    if (supabase) await supabase.auth.signOut()
    setProfile(null)
    setPassword("")
    setActiveView("overview")
  }

  const metrics = useMemo(() => computeMetrics(vouchers, redemptions, balance), [vouchers, redemptions, balance])
  const filteredVouchers = useMemo(() => filterVouchers(vouchers, search), [search, vouchers])
  const monthly = useMemo(() => buildMonthlyData(vouchers), [vouchers])
  const statuses = useMemo(() => buildStatusData(vouchers), [vouchers])
  const kiosks = useMemo(() => buildKioskData(redemptions), [redemptions])

  if (booting) {
    return (
      <div className="preloader">
        <div className="brand-mark">
          <img src="/utility-logo.png" alt="" />
        </div>
        <div>
          <strong>Aqua Municipal</strong>
          <span>Preparing dashboard</span>
        </div>
      </div>
    )
  }

  if (!profile) {
    return (
      <main className="login-page">
        <section className="login-art">
          <div className="orb orb-one" />
          <div className="orb orb-two" />
          <div className="orb orb-three" />
          <div className="orb orb-four" />
          <div className="art-copy">
            <Brand size="large" />
            <p>Voucher intelligence, redemption visibility, and distribution balance control</p>
          </div>
        </section>
        <section className="credential-panel">
          <div className="credential-card">
            <Brand centered />
            {!hasSupabaseConfig ? (
              <div className="notice">
                Missing Supabase environment variables. Create <code>.env.local</code> from <code>.env.example</code>.
              </div>
            ) : null}
            <label>
              Admin email
              <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="admin@municipality.na" />
            </label>
            <label>
              Password
              <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="Password" />
            </label>
            <button className="primary-button" onClick={handleLogin} disabled={loadingLogin}>
              {loadingLogin ? <span className="spinner" /> : null}
              Login
            </button>
            {loginError ? <p className="form-error">{loginError}</p> : null}
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="dashboard-layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Brand />
        </div>
        <nav>
          {navGroups.map((group) => {
            const visibleItems = group.items.filter((item) => item.roles.includes(profile.role))
            if (visibleItems.length === 0) return null
            return (
              <div className="nav-group" key={group.label}>
                <div className="nav-title">
                  <span style={{ background: group.color }} />
                  {group.label}
                </div>
                {visibleItems.map((item) => (
                  <button className={`nav-item ${activeView === item.id ? "active" : ""}`} key={item.id} onClick={() => setActiveView(item.id)}>
                    <span className="nav-symbol">{item.icon}</span>
                    {item.label}
                  </button>
                ))}
              </div>
            )
          })}
        </nav>
        <div className="sidebar-user">
          <strong>{profile.full_name ?? profile.email}</strong>
          <span>{roleLabels[profile.role]}</span>
          <button onClick={handleLogout}>
            <span>↩</span>
            Logout
          </button>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <h1>Aqua Municipal Performance</h1>
            <p>Voucher sales, redemption exposure, DAB capacity, and kiosk activity</p>
          </div>
          <div className="toolbar">
            <div className="search-box">
              <span>⌕</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search voucher, account, receipt, kiosk" />
            </div>
            <button className="outline-button" onClick={() => loadDashboardData()} disabled={loadingData}>
              {loadingData ? <span className="spinner dark" /> : <span>↻</span>}
              Refresh
            </button>
          </div>
        </header>

        {dataError ? (
          <div className="notice danger">
            <strong>Supabase query issue:</strong> {dataError}
          </div>
        ) : null}

        <MetricGrid metrics={metrics} />

        {activeView === "overview" ? <Overview monthly={monthly} statuses={statuses} kiosks={kiosks} metrics={metrics} /> : null}
        {activeView === "vouchers" ? <VoucherTable vouchers={filteredVouchers} /> : null}
        {activeView === "redemptions" ? <RedemptionTable redemptions={redemptions} /> : null}
        {activeView === "kiosks" ? <KioskPanel kiosks={kiosks} /> : null}
        {activeView === "balances" ? <BalancePanel metrics={metrics} balance={balance} /> : null}
        {activeView === "admins" && profile.role === "mua_super_admin" ? <AdminPanel admins={admins} onCreated={() => loadDashboardData()} /> : null}
      </section>
    </main>
  )
}

function Brand({ centered = false, size = "normal" }: { centered?: boolean; size?: "normal" | "large" }) {
  return (
    <div className={`brand ${centered ? "centered" : ""} ${size}`}>
      <div className="brand-mark">
        <img src="/utility-logo.png" alt="" />
      </div>
      <div>
        <h2>Aqua Municipal</h2>
        <p>Water token administration</p>
      </div>
    </div>
  )
}

function MetricGrid({ metrics }: { metrics: Metrics }) {
  const cards = [
    { title: "Total Sales", value: money(metrics.totalSales), detail: `${metrics.voucherCount} vouchers recorded`, icon: "N$" },
    { title: "Service Fees", value: money(metrics.serviceFees), detail: "Revenue from token fees", icon: "%" },
    { title: "Issued Exposure", value: money(metrics.issuedExposure), detail: "Available + redeemed vouchers", icon: "◫" },
    { title: "Redeemed Value", value: money(metrics.redeemedValue), detail: `${metrics.redemptionCount} redemptions`, icon: "✓" },
    { title: "Issue Headroom", value: money(metrics.issueHeadroom), detail: "DAB minus issued exposure", icon: "⌁", danger: metrics.issueHeadroom <= 10000 },
  ]

  return (
    <section className="metric-grid">
      {cards.map((card) => (
        <article className={`metric-card ${card.danger ? "danger" : ""}`} key={card.title}>
          <div>
            <span>{card.title}</span>
            <div className="metric-icon">{card.icon}</div>
          </div>
          <strong>{card.value}</strong>
          <p>{card.detail}</p>
        </article>
      ))}
    </section>
  )
}

function Overview({
  monthly,
  statuses,
  kiosks,
  metrics,
}: {
  monthly: { month: string; issued: number; redeemed: number; fees: number }[]
  statuses: { name: string; value: number }[]
  kiosks: { kiosk: string; count: number; value: number; latest: string | null }[]
  metrics: Metrics
}) {
  return (
    <section className="overview-grid">
      <div className="stack">
        <Panel title="Six Month Platform Volume" subtitle="Issued vs redeemed vs fees">
          <VolumeChart data={monthly} />
        </Panel>
        <div className="split-grid">
          <Panel title="Voucher Status">
            <StatusDonut statuses={statuses} />
          </Panel>
          <Panel title="Kiosk Throughput">
            <KioskBars kiosks={kiosks.slice(0, 6)} />
          </Panel>
        </div>
      </div>
      <div className="stack">
        <Panel title="Operational Signals">
          <Signal icon="!" label="DAB warning threshold" value={String([20000, 10000, 5000].filter((x) => metrics.issueHeadroom <= x).length)} tone={metrics.issueHeadroom <= 20000 ? "danger" : "ok"} />
          <Signal icon="◫" label="Available unredeemed value" value={money(metrics.availableValue)} tone="info" />
          <Signal icon="⌁" label="Actual municipal balance" value={money(metrics.actualMunicipalBalance)} tone="ok" />
          <Signal icon="□" label="Pending unpaid value" value={money(metrics.pendingValue)} tone="warn" />
          <Signal icon="×" label="Cancelled vouchers" value={String(metrics.cancelledCount)} tone="danger" />
        </Panel>
        <Panel title="DAB Guardrails">
          {[20000, 10000, 5000].map((threshold) => (
            <div className={`guardrail ${metrics.issueHeadroom <= threshold ? "active" : ""}`} key={threshold}>
              <div>
                <strong>{money(threshold)} guardrail</strong>
                <span>Issue headroom {money(metrics.issueHeadroom)}</span>
              </div>
              <Badge label={metrics.issueHeadroom <= threshold ? "Active" : "Clear"} tone={metrics.issueHeadroom <= threshold ? "danger" : "ok"} />
            </div>
          ))}
        </Panel>
      </div>
    </section>
  )
}

function VolumeChart({ data }: { data: { month: string; issued: number; redeemed: number; fees: number }[] }) {
  const max = Math.max(1, ...data.flatMap((item) => [item.issued, item.redeemed, item.fees]))
  return (
    <div className="css-chart">
      {data.length === 0 ? <EmptyState label="No voucher volume yet" /> : null}
      {data.map((item) => (
        <div className="css-chart-column" key={item.month}>
          <div className="css-bars">
            <span className="issued" style={{ height: `${Math.max(2, (item.issued / max) * 100)}%` }} title={`Issued ${money(item.issued)}`} />
            <span className="redeemed" style={{ height: `${Math.max(2, (item.redeemed / max) * 100)}%` }} title={`Redeemed ${money(item.redeemed)}`} />
            <span className="fees" style={{ height: `${Math.max(2, (item.fees / max) * 100)}%` }} title={`Fees ${money(item.fees)}`} />
          </div>
          <strong>{item.month}</strong>
        </div>
      ))}
    </div>
  )
}

function StatusDonut({ statuses }: { statuses: { name: string; value: number }[] }) {
  const total = Math.max(1, statuses.reduce((sum, item) => sum + item.value, 0))
  let start = 0
  const gradient = statuses
    .map((item) => {
      const end = start + (item.value / total) * 100
      const segment = `${statusColor(item.name)} ${start}% ${end}%`
      start = end
      return segment
    })
    .join(", ")

  return (
    <div className="donut-panel">
      <div className="donut" style={{ background: `conic-gradient(${gradient || "#e5e7eb 0 100%"})` }} />
      <div className="legend">
        {statuses.length === 0 ? <EmptyState label="No voucher statuses yet" /> : null}
        {statuses.map((item) => (
          <span key={item.name}>
            <i style={{ background: statusColor(item.name) }} />
            {item.name}: {item.value}
          </span>
        ))}
      </div>
    </div>
  )
}

function KioskBars({ kiosks }: { kiosks: { kiosk: string; count: number; value: number; latest: string | null }[] }) {
  const max = Math.max(1, ...kiosks.map((item) => item.count))
  return (
    <div className="kiosk-bars">
      {kiosks.length === 0 ? <EmptyState label="No kiosk redemptions yet" /> : null}
      {kiosks.map((item) => (
        <div className="kiosk-bar" key={item.kiosk}>
          <strong>{item.kiosk}</strong>
          <span>{item.count} redemptions</span>
          <div><i style={{ width: `${(item.count / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  )
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <article className="panel">
      <div className="panel-head">
        <h3>{title}</h3>
        {subtitle ? <span>{subtitle}</span> : null}
      </div>
      {children}
    </article>
  )
}

function Signal({ icon, label, value, tone }: { icon: string; label: string; value: string; tone: Tone }) {
  return (
    <div className="signal">
      <div className={`signal-icon ${tone}`}>{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function VoucherTable({ vouchers }: { vouchers: Voucher[] }) {
  return (
    <Panel title="Voucher Register" subtitle="Who bought, value, payment, redemption, kiosk">
      <Table columns={["Voucher", "Status", "Buyer", "Value", "Fee", "Payment", "Redeemed", "Kiosk"]}>
        {vouchers.map((voucher) => {
          const redemption = first(voucher.redemptions)
          const payment = first(voucher.payment_transactions)
          const status = normalizeStatus(voucher.status)
          return (
            <tr key={voucher.id}>
              <td className="mono">{voucher.voucher_code ?? voucher.id.slice(0, 8)}</td>
              <td><Badge label={status} tone={statusTone(status)} /></td>
              <td>{voucher.users?.full_name ?? "Resident"}<small>{voucher.users?.phone_number ?? "No phone"}</small></td>
              <td>{money(num(voucher.denomination))}</td>
              <td>{money(num(voucher.service_fee))}</td>
              <td>{voucher.payment_method ?? payment?.payment_method ?? "Unknown"}<small>{payment?.transaction_reference ?? "No reference"}</small></td>
              <td>{formatDate(voucher.redeemed_at ?? redemption?.redeemed_at)}</td>
              <td>{voucher.redeemed_by_kiosk_id ?? redemption?.kiosk_id ?? "Not redeemed"}</td>
            </tr>
          )
        })}
      </Table>
    </Panel>
  )
}

function RedemptionTable({ redemptions }: { redemptions: Redemption[] }) {
  return (
    <Panel title="Redemption Details" subtitle="Municipal resident account and receipt data">
      <Table columns={["Receipt", "Resident", "Account", "Meter", "Kiosk", "Quantity", "Redeemed"]}>
        {redemptions.map((redemption) => (
          <tr key={redemption.id}>
            <td className="mono">{redemption.receipt_number ?? redemption.id.slice(0, 8)}</td>
            <td>{redemption.customer_name ?? "Unknown"}</td>
            <td>{redemption.account_number ?? "No account"}</td>
            <td>{redemption.meter_number ?? "No meter"}</td>
            <td>{redemption.kiosk_id ?? "Unknown"}</td>
            <td>{num(redemption.quantity).toLocaleString("en-NA")}</td>
            <td>{formatDate(redemption.redeemed_at)}</td>
          </tr>
        ))}
      </Table>
    </Panel>
  )
}

function KioskPanel({ kiosks }: { kiosks: { kiosk: string; count: number; value: number; latest: string | null }[] }) {
  return (
    <Panel title="Kiosk Monitor" subtitle="Health and redemption activity by KIOSK_ID">
      <Table columns={["Kiosk ID", "Redemptions", "Estimated Value", "Last Activity", "Health"]}>
        {kiosks.map((kiosk) => (
          <tr key={kiosk.kiosk}>
            <td className="mono">{kiosk.kiosk}</td>
            <td>{kiosk.count}</td>
            <td>{money(kiosk.value)}</td>
            <td>{formatDate(kiosk.latest)}</td>
            <td><Badge label="Active" tone="ok" /></td>
          </tr>
        ))}
      </Table>
    </Panel>
  )
}

function BalancePanel({ metrics, balance }: { metrics: Metrics; balance: DistributionAccountBalance | null }) {
  const rows = [
    ["Municipality", balance?.municipality ?? "Not configured"],
    ["Funded DAB", money(metrics.fundedBalance)],
    ["Issued Exposure", money(metrics.issuedExposure)],
    ["Available Liability", money(metrics.availableValue)],
    ["Redeemed Actual", money(metrics.redeemedValue)],
    ["Issue Headroom", money(metrics.issueHeadroom)],
  ]

  return (
    <Panel title="Distribution Account Balance" subtitle="DAB - pending/available/redeemed monitoring">
      <div className="balance-grid">
        {rows.map(([label, value]) => (
          <div className="balance-card" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </Panel>
  )
}

function AdminPanel({ admins, onCreated }: { admins: AdminUser[]; onCreated: () => void }) {
  const [fullName, setFullName] = useState("")
  const [adminEmail, setAdminEmail] = useState("")
  const [adminPassword, setAdminPassword] = useState("")
  const [role, setRole] = useState<AdminRole>("municipal_admin")
  const [municipality, setMunicipality] = useState("")
  const [isCreating, setIsCreating] = useState(false)
  const [message, setMessage] = useState("")

  const createAdmin = async () => {
    if (!supabase) return
    setMessage("")

    if (!fullName.trim() || !adminEmail.trim() || !adminPassword.trim()) {
      setMessage("Enter name, email, and temporary password.")
      return
    }

    if (role === "municipal_admin" && !municipality.trim()) {
      setMessage("Municipal Admin users need a municipality.")
      return
    }

    setIsCreating(true)
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    if (!token) {
      setMessage("Your session expired. Log out and sign in again.")
      setIsCreating(false)
      return
    }

    const response = await fetch("/api/admin-users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        fullName: fullName.trim(),
        email: adminEmail.trim().toLowerCase(),
        password: adminPassword,
        role,
        municipality: role === "municipal_admin" ? municipality.trim() : null,
      }),
    })

    const result = await response.json()

    if (!response.ok) {
      setMessage(result.error ?? "Could not create admin user.")
      setIsCreating(false)
      return
    }

    setFullName("")
    setAdminEmail("")
    setAdminPassword("")
    setRole("municipal_admin")
    setMunicipality("")
    setMessage("Admin user created.")
    setIsCreating(false)
    onCreated()
  }

  return (
    <div className="admin-grid">
      <Panel title="Create Admin User" subtitle="Creates Supabase Auth and dashboard access">
        <div className="admin-form">
          <label>
            Full name
            <input value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Jane Admin" />
          </label>
          <label>
            Email
            <input value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} type="email" placeholder="admin@municipality.na" />
          </label>
          <label>
            Temporary password
            <input value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} type="password" placeholder="Minimum 6 characters" />
          </label>
          <label>
            Role
            <select value={role} onChange={(event) => setRole(event.target.value as AdminRole)}>
              <option value="municipal_admin">Municipal Admin</option>
              <option value="mua_admin">MUA Admin</option>
              <option value="mua_super_admin">MUA Super Admin</option>
            </select>
          </label>
          <label>
            Municipality
            <input
              value={municipality}
              onChange={(event) => setMunicipality(event.target.value)}
              placeholder={role === "municipal_admin" ? "Required" : "Optional"}
              disabled={role !== "municipal_admin"}
            />
          </label>
          <button className="primary-button admin-create-button" onClick={createAdmin} disabled={isCreating}>
            {isCreating ? "Creating..." : "Create User"}
          </button>
          {message ? <p className="admin-form-message">{message}</p> : null}
        </div>
      </Panel>

      <Panel title="Admin Users" subtitle="Supabase Auth users registered for dashboard access">
        <Table columns={["Name", "Email", "Role", "Municipality", "Status"]}>
          {admins.map((admin) => (
            <tr key={admin.id}>
              <td>{admin.full_name ?? "Admin"}</td>
              <td>{admin.email}</td>
              <td>{roleLabels[admin.role]}</td>
              <td>{admin.municipality ?? "All municipalities"}</td>
              <td><Badge label={admin.status} tone={admin.status === "active" ? "ok" : "danger"} /></td>
            </tr>
          ))}
        </Table>
      </Panel>
    </div>
  )
}

function Table({ columns, children }: { columns: string[]; children: React.ReactNode }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function Badge({ label, tone }: { label: string; tone: Tone }) {
  return <span className={`badge ${tone}`}>{label}</span>
}

function EmptyState({ label }: { label: string }) {
  return <p className="empty-state">{label}</p>
}

function computeMetrics(vouchers: Voucher[], redemptions: Redemption[], balance: DistributionAccountBalance | null): Metrics {
  const totals = vouchers.reduce(
    (acc, voucher) => {
      const status = normalizeStatus(voucher.status)
      const denomination = num(voucher.denomination)
      acc.totalSales += num(voucher.total_amount)
      acc.serviceFees += num(voucher.service_fee)
      if (status === "pending") {
        acc.pendingValue += denomination
        acc.pendingCount += 1
      }
      if (status === "available") {
        acc.availableValue += denomination
        acc.availableCount += 1
      }
      if (status === "redeemed") {
        acc.redeemedValue += denomination
        acc.redeemedCount += 1
      }
      if (status === "cancelled") acc.cancelledCount += 1
      return acc
    },
    {
      totalSales: 0,
      serviceFees: 0,
      pendingValue: 0,
      availableValue: 0,
      redeemedValue: 0,
      pendingCount: 0,
      availableCount: 0,
      redeemedCount: 0,
      cancelledCount: 0,
    },
  )

  const fundedBalance = num(balance?.funded_balance)
  const issuedExposure = totals.availableValue + totals.redeemedValue
  return {
    ...totals,
    voucherCount: vouchers.length,
    redemptionCount: redemptions.length,
    fundedBalance,
    issuedExposure,
    issueHeadroom: fundedBalance - issuedExposure,
    actualMunicipalBalance: fundedBalance - totals.redeemedValue,
  }
}

function buildMonthlyData(vouchers: Voucher[]) {
  const map = new Map<string, { month: string; issued: number; redeemed: number; fees: number }>()
  vouchers.forEach((voucher) => {
    const month = new Date(voucher.paid_at ?? voucher.created_at ?? Date.now()).toLocaleString("en-US", { month: "short" })
    const item = map.get(month) ?? { month, issued: 0, redeemed: 0, fees: 0 }
    const status = normalizeStatus(voucher.status)
    if (status === "available" || status === "redeemed") item.issued += num(voucher.denomination)
    if (status === "redeemed") item.redeemed += num(voucher.denomination)
    item.fees += num(voucher.service_fee)
    map.set(month, item)
  })
  return Array.from(map.values()).slice(-6)
}

function buildStatusData(vouchers: Voucher[]) {
  const map = new Map<string, number>()
  vouchers.forEach((voucher) => {
    const status = normalizeStatus(voucher.status)
    map.set(status, (map.get(status) ?? 0) + 1)
  })
  return Array.from(map.entries()).map(([name, value]) => ({ name, value }))
}

function buildKioskData(redemptions: Redemption[]) {
  const map = new Map<string, { kiosk: string; count: number; value: number; latest: string | null }>()
  redemptions.forEach((redemption) => {
    const kiosk = redemption.kiosk_id ?? "Unassigned"
    const item = map.get(kiosk) ?? { kiosk, count: 0, value: 0, latest: null }
    item.count += 1
    item.value += num(redemption.quantity) * (num(redemption.unit_price) || 1)
    item.latest = redemption.redeemed_at ?? item.latest
    map.set(kiosk, item)
  })
  return Array.from(map.values()).sort((a, b) => b.count - a.count)
}

function filterVouchers(vouchers: Voucher[], search: string) {
  const query = search.trim().toLowerCase()
  if (!query) return vouchers
  return vouchers.filter((voucher) => {
    const redemption = first(voucher.redemptions)
    const payment = first(voucher.payment_transactions)
    return [
      voucher.voucher_code,
      voucher.status,
      voucher.users?.full_name,
      voucher.users?.phone_number,
      redemption?.account_number,
      redemption?.meter_number,
      redemption?.receipt_number,
      redemption?.kiosk_id,
      payment?.transaction_reference,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query))
  })
}

function first<T>(value: T[] | T | null | undefined): T | undefined {
  if (!value) return undefined
  return Array.isArray(value) ? value[0] : value
}

function normalizeStatus(status: string | null | undefined) {
  return String(status ?? "pending").toLowerCase()
}

function statusTone(status: string): Tone {
  if (status === "redeemed") return "ok"
  if (status === "pending") return "warn"
  if (status === "cancelled" || status === "expired") return "danger"
  return "info"
}

function statusColor(status: string) {
  if (status === "redeemed") return "#16a36a"
  if (status === "available") return "#0795a3"
  if (status === "pending") return "#e2a11c"
  if (status === "cancelled") return "#d84343"
  return "#6b7280"
}

function num(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function money(value: number) {
  return `N$ ${value.toLocaleString("en-NA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not recorded"
  return new Intl.DateTimeFormat("en-NA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}
