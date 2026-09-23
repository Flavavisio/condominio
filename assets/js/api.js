import { supabase } from './supabase.js';

const TABLES = [
  'companies',
  'company_members',
  'condominiums',
  'fractions',
  'condominium_members',
  'issues',
  'notices',
  'documents',
  'suppliers',
  'equipment',
  'maintenance',
  'obligations',
  'obligation_checklist_items',
  'obligation_inspections'
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

export async function signUp({ email, password, fullName }) {
  return throwIfError(await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } }
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
    supabase.from('profiles').select('user_id,full_name,phone,avatar_url,is_super_admin').eq('user_id', userId).maybeSingle(),
    supabase.from('companies').select('*').order('created_at', { ascending: false }),
    supabase.from('company_members').select('id,company_id,user_id,role,status,created_at'),
    supabase.from('condominiums').select('*').order('created_at', { ascending: false }),
    supabase.from('fractions').select('*').order('code'),
    supabase.from('condominium_members').select('id,condominium_id,fraction_id,user_id,member_role,status,permissions,created_at'),
    supabase.from('issues').select('*').order('created_at', { ascending: false }),
    supabase.from('notices').select('*').order('published_at', { ascending: false }),
    supabase.from('documents').select('*').order('created_at', { ascending: false }),
    supabase.from('suppliers').select('*').order('name'),
    supabase.from('equipment').select('*').order('name'),
    supabase.from('maintenance').select('*').order('scheduled_for', { ascending: true, nullsFirst: false }),
    supabase.from('obligations').select('*').order('next_date', { ascending: true, nullsFirst: false }),
    supabase.from('obligation_checklist_items').select('*').order('sort_order'),
    supabase.from('obligation_inspections').select('*').order('performed_on', { ascending: false })
  ];

  const results = await Promise.all(queries);
  const [profile, ...collections] = results;
  throwIfError(profile, 'Perfil');
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

  return {
    profile: profile.data,
    companies: collections[0].data || [],
    companyMembers,
    condominiums: collections[2].data || [],
    fractions: collections[3].data || [],
    condominiumMembers: members,
    issues: collections[5].data || [],
    notices: collections[6].data || [],
    documents: collections[7].data || [],
    suppliers: collections[8].data || [],
    equipment: collections[9].data || [],
    maintenance: collections[10].data || [],
    obligations: collections[11].data || [],
    obligationChecklistItems: collections[12].data || [],
    obligationInspections: collections[13].data || [],
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

export const createCompany = values => insert('companies', values);
export const createCondominium = values => insert('condominiums', values);
export const createFraction = values => insert('fractions', values);
export const createIssue = values => insert('issues', values);
export const createNotice = values => insert('notices', values);
export const createSupplier = values => insert('suppliers', values);
export const createEquipment = values => insert('equipment', values);
export const createMaintenance = values => insert('maintenance', values);
export const createObligation = values => insert('obligations', values);

export { supabase };
