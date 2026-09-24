import { withSupabase } from "npm:@supabase/server@1.8.0";

type InvitePayload = {
  email?: string;
  fullName?: string;
  companyId?: string | null;
  companyRole?: "admin" | "manager" | "staff";
  condominiumId?: string | null;
  fractionId?: string | null;
  memberRole?: "owner" | "tenant" | "representative" | "porter";
};

const json = (body: unknown, status = 200) => Response.json(body, { status });

async function findExistingUserByEmail(admin: any, email: string) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const user = data.users.find((item: any) => String(item.email || "").toLowerCase() === email);
    if (user) return user;
    if (data.users.length < 100) break;
  }
  return null;
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

    let body: InvitePayload;
    try { body = await req.json(); } catch { return json({ error: "Pedido inválido." }, 400); }

    const email = String(body.email || "").trim().toLowerCase();
    const fullName = String(body.fullName || "").trim();
    const companyId = body.companyId || null;
    const condominiumId = body.condominiumId || null;
    const fractionId = body.fractionId || null;
    const companyRole = body.companyRole || "staff";
    const memberRole = body.memberRole || "owner";
    const callerId = ctx.userClaims?.sub;

    if (!callerId) return json({ error: "Utilizador não autenticado." }, 401);
    if (!email || !email.includes("@")) return json({ error: "Email inválido." }, 400);
    if (!companyId && !condominiumId) return json({ error: "Indique a empresa gestora ou o condomínio." }, 400);
    if (!["admin", "manager", "staff"].includes(companyRole)) return json({ error: "Papel da empresa inválido." }, 400);
    if (!["owner", "tenant", "representative", "porter"].includes(memberRole)) return json({ error: "Papel do condomínio inválido." }, 400);

    const { data: profile, error: profileError } = await ctx.supabase.from("profiles").select("is_super_admin").eq("user_id", callerId).maybeSingle();
    if (profileError) return json({ error: profileError.message }, 400);
    const isSuperAdmin = Boolean(profile?.is_super_admin);

    let targetCompanyId = companyId;
    if (condominiumId) {
      const { data: condo, error: condoError } = await ctx.supabase.from("condominiums").select("id,company_id").eq("id", condominiumId).maybeSingle();
      if (condoError || !condo) return json({ error: "Condomínio não encontrado ou sem acesso." }, 404);
      if (companyId && companyId !== condo.company_id) return json({ error: "O condomínio não pertence à empresa indicada." }, 400);
      targetCompanyId = condo.company_id;
    }
    if (!targetCompanyId) return json({ error: "Empresa gestora não encontrada." }, 400);

    if (!isSuperAdmin) {
      const { data: membership, error: membershipError } = await ctx.supabase.from("company_members").select("role,status").eq("company_id", targetCompanyId).eq("user_id", callerId).eq("status", "active").maybeSingle();
      if (membershipError) return json({ error: membershipError.message }, 400);
      if (!membership || membership.role !== "admin") return json({ error: "Apenas o administrador da empresa pode criar ou convidar colaboradores." }, 403);

      const today = new Date().toISOString().slice(0, 10);
      const { data: license, error: licenseError } = await ctx.supabase
        .from("company_admin_licenses")
        .select("id")
        .eq("company_id", targetCompanyId)
        .eq("user_id", callerId)
        .eq("status", "active")
        .lte("starts_on", today)
        .gte("expires_on", today)
        .limit(1)
        .maybeSingle();
      if (licenseError) return json({ error: licenseError.message }, 400);
      if (!license) return json({ error: "A licença desta conta de administrador não está ativa. Contacte o Super Admin." }, 403);
    }

    let targetUser: any = null;
    let invited = false;
    const { data: inviteData, error: inviteError } = await ctx.supabaseAdmin.auth.admin.inviteUserByEmail(email, { data: fullName ? { full_name: fullName } : undefined });
    if (!inviteError && inviteData?.user) { targetUser = inviteData.user; invited = true; }
    else {
      try { targetUser = await findExistingUserByEmail(ctx.supabaseAdmin, email); }
      catch (error: any) { return json({ error: error.message || "Não foi possível procurar o utilizador." }, 400); }
      if (!targetUser) return json({ error: inviteError?.message || "Não foi possível convidar o utilizador." }, 400);
    }

    if (companyId) {
      const { error } = await ctx.supabaseAdmin.from("company_members").upsert({ company_id: companyId, user_id: targetUser.id, role: companyRole, status: "active" }, { onConflict: "company_id,user_id" });
      if (error) return json({ error: error.message }, 400);
    }

    if (condominiumId) {
      let existingQuery = ctx.supabaseAdmin.from("condominium_members").select("id").eq("condominium_id", condominiumId).eq("user_id", targetUser.id);
      existingQuery = fractionId ? existingQuery.eq("fraction_id", fractionId) : existingQuery.is("fraction_id", null);
      const { data: existing, error: existingError } = await existingQuery.maybeSingle();
      if (existingError) return json({ error: existingError.message }, 400);
      if (existing?.id) {
        const { error } = await ctx.supabaseAdmin.from("condominium_members").update({ fraction_id: fractionId, member_role: memberRole, status: "active" }).eq("id", existing.id);
        if (error) return json({ error: error.message }, 400);
      } else {
        const { error } = await ctx.supabaseAdmin.from("condominium_members").insert({ condominium_id: condominiumId, fraction_id: fractionId, user_id: targetUser.id, member_role: memberRole, status: "active" });
        if (error) return json({ error: error.message }, 400);
      }
    }

    return json({ ok: true, invited, userId: targetUser.id, email, companyId: companyId || null, condominiumId: condominiumId || null });
  })
};
