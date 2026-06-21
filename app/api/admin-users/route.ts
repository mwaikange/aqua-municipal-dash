import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const adminRoles = new Set(["mua_super_admin", "mua_admin", "municipal_admin"])

export async function POST(request: Request) {
  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    return Response.json({ error: "Missing Supabase server environment variables." }, { status: 500 })
  }

  const authHeader = request.headers.get("authorization") ?? ""
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : ""

  if (!token) {
    return Response.json({ error: "Missing user session." }, { status: 401 })
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: sessionData, error: sessionError } = await userClient.auth.getUser(token)

  if (sessionError || !sessionData.user) {
    return Response.json({ error: "Invalid or expired user session." }, { status: 401 })
  }

  const { data: currentAdmin, error: currentAdminError } = await serviceClient
    .from("admin_users")
    .select("id, role, status")
    .eq("auth_user_id", sessionData.user.id)
    .eq("status", "active")
    .maybeSingle()

  if (currentAdminError) {
    return Response.json({ error: currentAdminError.message }, { status: 500 })
  }

  if (!currentAdmin || currentAdmin.role !== "mua_super_admin") {
    return Response.json({ error: "Only MUA Super Admin users can create admin accounts." }, { status: 403 })
  }

  const body = await request.json()
  const email = String(body.email ?? "").trim().toLowerCase()
  const password = String(body.password ?? "")
  const fullName = String(body.fullName ?? "").trim()
  const role = String(body.role ?? "")
  const municipality = body.municipality ? String(body.municipality).trim() : null

  if (!email || !password || !fullName) {
    return Response.json({ error: "Name, email, and password are required." }, { status: 400 })
  }

  if (password.length < 6) {
    return Response.json({ error: "Temporary password must be at least 6 characters." }, { status: 400 })
  }

  if (!adminRoles.has(role)) {
    return Response.json({ error: "Invalid admin role." }, { status: 400 })
  }

  if (role === "municipal_admin" && !municipality) {
    return Response.json({ error: "Municipal Admin users need a municipality." }, { status: 400 })
  }

  const { data: authData, error: createAuthError } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      role,
      municipality,
    },
  })

  if (createAuthError || !authData.user) {
    return Response.json({ error: createAuthError?.message ?? "Could not create Supabase Auth user." }, { status: 400 })
  }

  const { data: adminData, error: insertAdminError } = await serviceClient
    .from("admin_users")
    .insert({
      auth_user_id: authData.user.id,
      email,
      full_name: fullName,
      role,
      municipality: role === "municipal_admin" ? municipality : null,
      status: "active",
      created_by: currentAdmin.id,
    })
    .select("*")
    .single()

  if (insertAdminError) {
    await serviceClient.auth.admin.deleteUser(authData.user.id)
    return Response.json({ error: insertAdminError.message }, { status: 400 })
  }

  return Response.json({ admin: adminData }, { status: 201 })
}
