import { createClient } from "npm:@supabase/supabase-js@2.117.1";

type InvitePayload = {
  email?: string;
  fullName?: string;
  password?: string;
  companyId?: string | null;
  companyRole?: "admin" | "manager" | "staff";
  condominiumId?: string | null;
  fractionId?: string | null;
  memberRole?: "owner" | "tenant" | "representative" | "porter";
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" }
});

async function findExistingUserByEmail(admin: any, email: string) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const user = data.users.find((item: any) => String(item.email || "").toLowerCase() === email);
    if (user) return user;
    if (data.users.length < 100) break;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Utilizador não autenticado." }, 401);

  const admin = createClient(supabaseUrl, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const caller = userData?.user;
  if (userError || !caller) return json({ error: "Sessão inválida ou expirada." }, 401);

  let body: InvitePayload;
  try { body = await req.json(); } catch { return json({ error: "Pedido inválido." }, 400); }

  const email = String(body.email || "").trim().toLowerCase();
  const fullName = String(body.fullName || "").trim();
  const password = String(body.password || "");
  const companyId = body.companyId || null;
  const condominiumId = body.condominiumId || null;
  const fractionId = body.fractionId || null;
  const companyRole = body.companyRole || "staff";
  const memberRole = body.memberRole || "owner";

  if (!email || !email.includes("@")) return json({ error: "Email inválido." }, 400);
  if (!companyId && !condominiumId) return json({ error: "Indique a empresa gestora ou o condomínio." }, 400);
  if (!["admin", "manager", "staff"].includes(companyRole)) return json({ error: "Papel da empresa inválido." }, 400);
  if (!["owner", "tenant", "representative", "porter"].includes(memberRole)) return json({ error: "Papel do condomínio inválido." }, 400);

  const { data: profile } = await admin.from("profiles").select("is_super_admin").eq("user_id", caller.id).maybeSingle();
  const isSuperAdmin = Boolean(profile?.is_super_admin);

  let targetCompanyId = companyId;
  if (condominiumId) {
    const { data: condo } = await admin.from("condominiums").select("id,company_id").eq("id", condominiumId).maybeSingle();
    if (!condo) return json({ error: "Condomínio não encontrado." }, 404);
    if (companyId && companyId !== condo.company_id) return json({ error: "O condomínio não pertence à empresa indicada." }, 400);
    targetCompanyId = condo.company_id;
  }
  if (!targetCompanyId) return json({ error: "Empresa gestora não encontrada." }, 400);

  if (fractionId) {
    if (!condominiumId) return json({ error: "Indique o condomínio da fração." }, 400);
    const { data: fraction, error: fractionError } = await admin.from("fractions").select("id,condominium_id,status").eq("id", fractionId).maybeSingle();
    if (fractionError || !fraction || fraction.condominium_id !== condominiumId || fraction.status !== "active") {
      return json({ error: "A fração não está ativa neste condomínio." }, 400);
    }
  }

  if (!isSuperAdmin) {
    const { data: membership } = await admin
      .from("company_members")
      .select("role,status")
      .eq("company_id", targetCompanyId)
      .eq("user_id", caller.id)
      .eq("status", "active")
      .maybeSingle();

    const residentOnly = Boolean(condominiumId && !companyId);
    if (!membership || (membership.role !== "admin" && !(residentOnly && membership.role === "manager"))) {
      return json({ error: "Sem permissões para criar este acesso." }, 403);
    }
    if (membership.role === "manager") {
      const { data: assignment } = await admin.from("condominium_staff_assignments").select("id").eq("condominium_id", condominiumId).eq("user_id", caller.id).eq("status", "active").maybeSingle();
      if (!assignment) return json({ error: "Este condomínio não está atribuído ao gestor." }, 403);
    }

    const today = new Date().toISOString().slice(0, 10);
    let licenseQuery = admin
      .from("company_admin_licenses")
      .select("id")
      .eq("company_id", targetCompanyId)
      .eq("status", "active")
      .lte("starts_on", today)
      .gte("expires_on", today);
    if (membership.role === "admin") licenseQuery = licenseQuery.eq("user_id", caller.id);
    const { data: license } = await licenseQuery.limit(1).maybeSingle();

    if (!license) return json({ error: "A licença desta conta de administrador não está ativa. Contacte o Super Admin." }, 403);
  }

  let targetUser: any = null;
  let created = false;
  try {
    targetUser = await findExistingUserByEmail(admin, email);
  } catch (error: any) {
    return json({ error: error?.message || "Não foi possível procurar o utilizador." }, 400);
  }

  if (!targetUser) {
    if (password.length < 8) return json({ error: "Defina uma password inicial com pelo menos 8 caracteres." }, 400);
    const { data: createData, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: fullName ? { full_name: fullName } : undefined
    });
    if (createError || !createData?.user) {
      return json({ error: createError?.message || "Não foi possível criar o utilizador." }, 400);
    }
    targetUser = createData.user;
    created = true;
  }
  // Existing accounts keep their identity and password when associated with a fraction.

  if (companyId) {
    const { error } = await admin.from("company_members").upsert({
      company_id: companyId,
      user_id: targetUser.id,
      role: companyRole,
      status: "active"
    }, { onConflict: "company_id,user_id" });
    if (error) return json({ error: error.message }, 400);
  }

  if (condominiumId) {
    let existingQuery = admin.from("condominium_members").select("id").eq("condominium_id", condominiumId).eq("user_id", targetUser.id);
    existingQuery = fractionId ? existingQuery.eq("fraction_id", fractionId) : existingQuery.is("fraction_id", null);
    const { data: existing, error: existingError } = await existingQuery.maybeSingle();
    if (existingError) return json({ error: existingError.message }, 400);

    if (existing?.id) {
      const { error } = await admin.from("condominium_members").update({ fraction_id: fractionId, member_role: memberRole, status: "active" }).eq("id", existing.id);
      if (error) return json({ error: error.message }, 400);
    } else {
      const { error } = await admin.from("condominium_members").insert({ condominium_id: condominiumId, fraction_id: fractionId, user_id: targetUser.id, member_role: memberRole, status: "active" });
      if (error) return json({ error: error.message }, 400);
    }
  }

  return json({
    ok: true,
    created,
    existing: !created,
    userId: targetUser.id,
    email,
    companyId: companyId || null,
    condominiumId: condominiumId || null
  });
});
