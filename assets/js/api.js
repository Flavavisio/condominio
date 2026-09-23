import { supabase } from './supabase.js';

const TABLES = [
  'companies',
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

  const members = collections[3].data || [];
  const managedUserIds = [...new Set(members.map(item => item.user_id).filter(Boolean))];
  let profiles = [];
  if (managedUserIds.length) {
    const profileResult = await supabase.from('profiles').select('user_id,full_name,phone,avatar_url').in('user_id', managedUserIds);
    if (!profileResult.error) profiles = profileResult.data || [];
  }

  return {
    profile: profile.data,
    companies: collections[0].data || [],
    condominiums: collections[1].data || [],
    fractions: collections[2].data || [],
    condominiumMembers: members,
    issues: collections[4].data || [],
    notices: collections[5].data || [],
    documents: collections[6].data || [],
    suppliers: collections[7].data || [],
    equipment: collections[8].data || [],
    maintenance: collections[9].data || [],
    obligations: collections[10].data || [],
    obligationChecklistItems: collections[11].data || [],
    obligationInspections: collections[12].data || [],
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

export async function createCompany(values) {
  return insert('companies', values);
}

export async function createCondominium(values) {
  return insert('condominiums', values);
}

export async function createFraction(values) {
  return insert('fractions', values);
}

export async function createIssue(values) {
  return insert('issues', values);
}

export async function createNotice(values) {
  return insert('notices', values);
}

export async function createSupplier(values) {
  return insert('suppliers', values);
}

export async function createEquipment(values) {
  return insert('equipment', values);
}

export async function createMaintenance(values) {
  return insert('maintenance', values);
}

export async function createObligation(values) {
  return insert('obligations', values);
}

export { supabase };
