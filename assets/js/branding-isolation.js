import { supabase } from './supabase.js';

const DEFAULTS = {
  primary: '#3768f5',
  primaryDark: '#2856d9',
  title: 'Condomia'
};

let access = null;
let brandedCompany = null;
let userId = null;
let timer = null;

const esc = (value = '') => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

const initials = (value = '') => String(value)
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map(part => part[0])
  .join('')
  .toUpperCase() || 'CF';

function resetBranding() {
  document.documentElement.style.setProperty('--primary', DEFAULTS.primary);
  document.documentElement.style.setProperty('--primary-dark', DEFAULTS.primaryDark);
  document.title = DEFAULTS.title;

  const brand = document.querySelector('.sidebar .brand');
  if (!brand) return;

  const mark = brand.querySelector('.brand-mark');
  if (mark) {
    mark.classList.remove('white-label-logo');
    mark.innerHTML = 'C';
    mark.style.background = '';
  }

  const title = brand.querySelector('strong');
  const sub = brand.querySelector('small');
  if (title) title.textContent = 'Condomia';
  if (sub) sub.textContent = 'Condomínio fácil';
}

function applyLoadingBrand() {
  const screen=document.querySelector('.boot-screen');
  if(!screen)return;
  const company=access && !access.is_super_admin ? brandedCompany : null;
  const label=company?.label||company?.name||'Condomia';
  const fallback=new URL('./assets/icons/cf-icon.svg',document.baseURI).href;
  let logo=fallback;
  try{const url=new URL(company?.logo_url||fallback,document.baseURI);if(url.protocol==='https:'||url.origin===location.origin)logo=url.href;}catch{}
  const img=screen.querySelector('.boot-logo img'),title=screen.querySelector('strong');
  if(title && title.textContent!==label)title.textContent=label;
  if(img){
    // A failed company image falls back once, without an observer retry loop.
    if(img.dataset.requestedLogo!==logo){img.dataset.requestedLogo=logo;img.src=logo;}
    if(img.alt!==label)img.alt=label;
    img.onerror=()=>{if(img.src!==fallback)img.src=fallback;};
  }
}

function applyCompanyBranding() {
  applyLoadingBrand();
  if (document.querySelector('.mockup-shell')) {
    const title = brandedCompany && !access?.is_super_admin ? `${brandedCompany.label || brandedCompany.name} · Condomia` : DEFAULTS.title;
    if (document.title !== title) document.title = title;
    return;
  }
  resetBranding();
  if (!brandedCompany || access?.is_super_admin) return;

  const color = brandedCompany.brand_color || DEFAULTS.primary;
  const label = brandedCompany.label || brandedCompany.name || 'Condomínio';
  document.documentElement.style.setProperty('--primary', color);
  document.documentElement.style.setProperty('--primary-dark', color);
  document.title = `${label} · Condomia`;

  const brand = document.querySelector('.sidebar .brand');
  if (!brand) return;

  const mark = brand.querySelector('.brand-mark');
  if (mark) {
    if (brandedCompany.logo_url) {
      mark.classList.add('white-label-logo');
      mark.innerHTML = `<img src="${esc(brandedCompany.logo_url)}" alt="${esc(label)}">`;
      mark.style.background = '';
    } else {
      mark.classList.remove('white-label-logo');
      mark.textContent = initials(label);
      mark.style.background = color;
    }
  }

  const title = brand.querySelector('strong');
  const sub = brand.querySelector('small');
  if (title) title.textContent = label;
  if (sub) sub.textContent = 'GESTÃO DE CONDOMÍNIOS';
}

async function findCompanyForUser(currentUserId) {
  const { data: companyMemberships } = await supabase
    .from('company_members')
    .select('company_id')
    .eq('user_id', currentUserId)
    .eq('status', 'active')
    .limit(1);

  let companyId = companyMemberships?.[0]?.company_id || null;

  if (!companyId) {
    const { data: condoMemberships } = await supabase
      .from('condominium_members')
      .select('condominium_id')
      .eq('user_id', currentUserId)
      .eq('status', 'active')
      .limit(1);

    const condominiumId = condoMemberships?.[0]?.condominium_id;
    if (condominiumId) {
      const { data: condo } = await supabase
        .from('condominiums')
        .select('company_id')
        .eq('id', condominiumId)
        .maybeSingle();
      companyId = condo?.company_id || null;
    }
  }

  if (!companyId) return null;

  const { data: company } = await supabase
    .from('companies')
    .select('id,name,label,logo_url,brand_color,status')
    .eq('id', companyId)
    .maybeSingle();

  return company || null;
}

async function refreshBrandContext() {
  resetBranding();

  const { data: sessionData } = await supabase.auth.getSession();
  const user = sessionData?.session?.user || null;
  userId = user?.id || null;
  access = null;
  brandedCompany = null;
  applyLoadingBrand();

  if (!userId) return;

  const { data: accessData } = await supabase.rpc('get_my_access_context').maybeSingle();
  access = accessData || null;

  if (access?.is_super_admin) {
    applyCompanyBranding();
    return;
  }

  brandedCompany = await findCompanyForUser(userId);
  applyCompanyBranding();
}

function scheduleApply() {
  clearTimeout(timer);
  timer = setTimeout(applyCompanyBranding, 40);
}

const observer = new MutationObserver(scheduleApply);
observer.observe(document.documentElement, { childList: true, subtree: true });

supabase.auth.onAuthStateChange(() => {
  setTimeout(refreshBrandContext, 30);
});

refreshBrandContext();
