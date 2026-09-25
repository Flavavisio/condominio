import { supabase } from './supabase.js';

const TABLES = [
  'companies',
  'company_members',
  'condominiums',
  'fractions',
  'condominium_members',
  'issues',
  'notices',
  'notice_reads',
  'documents',
  'suppliers',
  'equipment',
  'maintenance',
  'obligations',
  'obligation_checklist_items',
  'obligation_inspections', 'assemblies', 'polls', 'poll_votes'
];

function throwIfError(result, context = 'Supabase') {
  if (result?.error) {
    const error = new Error(result.error.message || `${context}: erro desconhecido`);
    error.cause = result.error;
    throw error;
  }
  return result?.data;
}

export async function getSession() {
  const result = await supabase.auth.getSession();
  throwIfError(result, 'Sessão');
  return result.data.session;
}

export async function signIn(email, password) {
  return throwIfError(await supabase.auth.signInWithPassword({ email, password }), 'Login');
}

export async function signUp({ email, password, fullName, requestedPlan }) {
  return throwIfError(await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName, ...(requestedPlan ? {requested_plan:requestedPlan} : {}) } }
  }), 'Registo');
}

export async function signOut() {
  return throwIfError(await supabase.auth.signOut(), 'Logout');
}

export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange(callback);
}

export async function loadWorkspace(userId) {
  const queries = [
    supabase.rpc('get_my_access_context').maybeSingle(),
    supabase.from('companies').select('*').order('created_at', { ascending: false }),
    supabase.from('company_members').select('id,company_id,user_id,role,status,created_at'),
    supabase.from('condominiums').select('*').order('created_at', { ascending: false }),
    supabase.from('fractions').select('*').order('code'),
    supabase.from('condominium_members').select('id,condominium_id,fraction_id,user_id,member_role,status,permissions,is_condominium_admin,created_at'),
    supabase.from('issues').select('*').order('created_at', { ascending: false }),
    supabase.from('notices').select('*').order('published_at', { ascending: false }),
    supabase.from('notice_reads').select('*').order('read_at', { ascending: false }),
    supabase.from('documents').select('*').order('created_at', { ascending: false }),
    supabase.from('suppliers').select('*').order('name'),
    supabase.from('equipment').select('*').order('name'),
    supabase.from('maintenance').select('*').order('scheduled_for', { ascending: true, nullsFirst: false }),
    supabase.from('obligations').select('*').order('next_date', { ascending: true, nullsFirst: false }),
    supabase.from('obligation_checklist_items').select('*').order('sort_order'),
    supabase.from('obligation_inspections').select('*').order('performed_on', { ascending: false }),
    supabase.from('assemblies').select('*').order('scheduled_for'),
    supabase.from('polls').select('*').order('closes_at', { ascending: false }),
    supabase.from('poll_votes').select('*')
  ];

  const results = await Promise.all(queries);
  const [profile, ...collections] = results;
  throwIfError(profile, 'Contexto de acesso');
  collections.forEach((result, index) => throwIfError(result, TABLES[index]));

  const members = collections[4].data || [];
  const companyMembers = collections[1].data || [];
  const managedUserIds = [...new Set([
    ...members.map(item => item.user_id),
    ...companyMembers.map(item => item.user_id)
  ].filter(Boolean))];

  let profiles = [];
  if (managedUserIds.length) {
    const profileResult = await supabase.from('profiles').select('user_id,full_name,phone,avatar_url').in('user_id', managedUserIds);
    if (!profileResult.error) profiles = profileResult.data || [];
  }

  const companyStats = profile.data?.is_super_admin ? await Promise.all((collections[0].data || []).map(async company => {
    const counts = await Promise.all([
      supabase.from('condominiums').select('id', {count:'exact',head:true}).eq('company_id',company.id),
      supabase.from('fractions').select('id,condominiums!inner(company_id)', {count:'exact',head:true}).eq('condominiums.company_id',company.id),
      supabase.from('company_members').select('id', {count:'exact',head:true}).eq('company_id',company.id),
      ...['issues','assemblies','polls'].map(table=>supabase.from(table).select('id,condominiums!inner(company_id)', {count:'exact',head:true}).eq('condominiums.company_id',company.id))
    ]);
    counts.forEach(result=>throwIfError(result,'Quantidades da empresa gestora'));
    return Object.fromEntries([['company_id',company.id],...['condominiums','fractions','team','issues','assemblies','polls'].map((key,index)=>[key,counts[index].count || 0])]);
  })) : [];

  return {
    companyStats,
    profile: profile.data,
    companies: collections[0].data || [],
    companyMembers,
    condominiums: collections[2].data || [],
    fractions: collections[3].data || [],
    condominiumMembers: members,
    issues: collections[5].data || [],
    notices: collections[6].data || [],
    noticeReads: collections[7].data || [],
    documents: collections[8].data || [],
    suppliers: collections[9].data || [],
    equipment: collections[10].data || [],
    maintenance: collections[11].data || [],
    obligations: collections[12].data || [],
    obligationChecklistItems: collections[13].data || [],
    obligationInspections: collections[14].data || [],
    assemblies: collections[15].data || [],
    polls: collections[16].data || [],
    pollVotes: collections[17].data || [],
    profiles
  };
}

export async function insert(table, values) {
  const result = await supabase.from(table).insert(values).select().single();
  return throwIfError(result, `Criar ${table}`);
}

export async function update(table, id, values) {
  const result = await supabase.from(table).update(values).eq('id', id).select().single();
  return throwIfError(result, `Atualizar ${table}`);
}

export async function remove(table, id) {
  const result = await supabase.from(table).delete().eq('id', id);
  throwIfError(result, `Eliminar ${table}`);
  return true;
}

export async function acknowledgeNotice(noticeId, acknowledged = true) {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) throw new Error('Sessão inválida.');

  const payload = {
    notice_id: noticeId,
    user_id: userId,
    read_at: new Date().toISOString(),
    acknowledged_at: acknowledged ? new Date().toISOString() : null
  };

  const result = await supabase
    .from('notice_reads')
    .upsert(payload, { onConflict: 'notice_id,user_id' })
    .select()
    .single();

  return throwIfError(result, 'Confirmar aviso');
}

export async function updateIssueAssignment(issueId, { supplierId = null, equipmentId = null, maintenanceId = null, assignedTo = null, scheduledFor = null } = {}) {
  return update('issues', issueId, {
    supplier_id: supplierId,
    equipment_id: equipmentId,
    maintenance_id: maintenanceId,
    assigned_to: assignedTo,
    scheduled_for: scheduledFor
  });
}

export async function setChecklistItemDone(itemId, done) {
  return update('obligation_checklist_items', itemId, { done: Boolean(done) });
}

export async function inviteMember(payload) {
  const result = await supabase.functions.invoke('invite-member', { body: payload });
  if (result.error) {
    const error = new Error(result.error.message || 'Não foi possível enviar o convite.');
    error.cause = result.error;
    throw error;
  }
  if (result.data?.error) throw new Error(result.data.error);
  return result.data;
}

export const createCompany = values => insert('companies', values);
export const createCondominium = values => insert('condominiums', values);
export const createFraction = values => insert('fractions', values);
export const createIssue = values => insert('issues', values);
export const updateIssue = (id, values) => update('issues', id, values);
export const createNotice = values => insert('notices', values);
export const createDocument = values => insert('documents', values);
export const createSupplier = values => insert('suppliers', values);
export const createEquipment = values => insert('equipment', values);
export const createMaintenance = values => insert('maintenance', values);
export const createObligation = values => insert('obligations', values);
export const createChecklistItem = values => insert('obligation_checklist_items', values);
export const createObligationInspection = values => insert('obligation_inspections', values);

export { supabase };

export async function pollResults(id) { return throwIfError(await supabase.rpc('get_poll_results', {target:id})); }

export async function createFractionAccess(values) {
 const {data,error}=await supabase.functions.invoke('invite-member',{body:values});
 if(error||data?.error){let message=data?.error||error?.message;try{const body=await error?.context?.json();message=body?.error||body?.message||message;}catch{}throw new Error(message||'Não foi possível criar o acesso.');}
 return data;
}
export async function setResidentAdmin(condominiumId,userId,enabled) {
 return throwIfError(await supabase.rpc('set_condominium_resident_admin',{p_condominium_id:condominiumId,p_user_id:userId,p_is_admin:enabled}));
}
export async function reviewIssue(id,approve,note) {
 return throwIfError(await supabase.rpc('review_condominium_issue',{p_issue_id:id,p_approve:approve,p_note:note}));
}
