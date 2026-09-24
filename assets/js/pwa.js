import { supabase } from './supabase.js';

let registration = null;
let currentUser = null;
let unread = 0;
let refreshTimer = null;

const esc = (value = '') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = value => value ? new Intl.DateTimeFormat('pt-PT',{dateStyle:'short',timeStyle:'short'}).format(new Date(value)) : '';

function toast(message, error = false) {
  document.querySelector('.cf-pwa-toast')?.remove();
  const el = document.createElement('div');
  el.className = `cf-pwa-toast ${error ? 'error' : ''}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

function b64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g,'+').replace(/_/g,'/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(ch => ch.charCodeAt(0)));
}

async function getPublicKey() {
  const { data, error } = await supabase.from('push_public_config').select('vapid_public_key').eq('id',1).maybeSingle();
  if (error) throw error;
  if (!data?.vapid_public_key) throw new Error('O servidor de notificações ainda está a preparar as chaves. Tente novamente em instantes.');
  return data.vapid_public_key;
}

async function saveSubscription(subscription) {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!p256dh || !auth) throw new Error('Subscrição push inválida.');
  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: currentUser.id,
    endpoint: subscription.endpoint,
    p256dh,
    auth,
    user_agent: navigator.userAgent,
    enabled: true,
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }, { onConflict: 'endpoint' });
  if (error) throw error;
}

async function ensurePushSubscription({ requestPermission = false } = {}) {
  if (!currentUser) throw new Error('Entre na plataforma primeiro.');
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('Este navegador não suporta notificações PWA.');
  if (!registration) registration = await navigator.serviceWorker.ready;

  let permission = Notification.permission;
  if (permission === 'default' && requestPermission) permission = await Notification.requestPermission();
  if (permission === 'denied') throw new Error('As notificações estão bloqueadas no navegador. Ative-as nas permissões do site.');
  if (permission !== 'granted') return false;

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const publicKey = await getPublicKey();
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8Array(publicKey) });
  }
  await saveSubscription(subscription);
  return true;
}

async function loadNotifications() {
  if (!currentUser) return [];
  const { data, error } = await supabase.from('notifications').select('id,title,body,severity,url,read_at,created_at').eq('user_id',currentUser.id).order('created_at',{ascending:false}).limit(30);
  if (error) return [];
  unread = (data || []).filter(n => !n.read_at).length;
  updateBell();
  return data || [];
}

function updateBell() {
  const btn = document.querySelector('.cf-pwa-bell');
  if (!btn) return;
  btn.innerHTML = `<span>🔔</span>${unread ? `<b>${unread > 99 ? '99+' : unread}</b>` : ''}`;
  btn.title = Notification.permission === 'granted' ? 'Notificações' : 'Ativar notificações';
}

async function openNotifications() {
  document.querySelector('.cf-pwa-panel')?.remove();
  const notifications = await loadNotifications();
  const panel = document.createElement('div');
  panel.className = 'cf-pwa-panel';
  panel.innerHTML = `<header><div><strong>Notificações</strong><span>Alertas dos condomínios atribuídos</span></div><button data-pwa-close>✕</button></header>
    ${Notification.permission !== 'granted' ? '<div class="cf-pwa-permission"><div><strong>Receber alertas no telemóvel/PC</strong><span>Ative as notificações para receber ocorrências urgentes, obrigações e manutenções.</span></div><button data-pwa-enable>Ativar notificações</button></div>' : '<div class="cf-pwa-enabled">✓ Notificações PWA ativas neste dispositivo</div>'}
    <div class="cf-pwa-list">${notifications.length ? notifications.map(n => `<button class="cf-pwa-item ${n.read_at ? '' : 'unread'}" data-pwa-notification="${n.id}" data-pwa-url="${esc(n.url || '')}"><i class="${esc(n.severity)}"></i><div><strong>${esc(n.title)}</strong><span>${esc(n.body)}</span><small>${esc(fmt(n.created_at))}</small></div></button>`).join('') : '<div class="cf-pwa-empty">Ainda não existem notificações.</div>'}</div>`;
  document.body.appendChild(panel);
  panel.querySelector('[data-pwa-close]')?.addEventListener('click', () => panel.remove());
  panel.querySelector('[data-pwa-enable]')?.addEventListener('click', async () => {
    try {
      const active = await ensurePushSubscription({requestPermission:true});
      if (active) { toast('Notificações ativadas neste dispositivo.'); panel.remove(); await loadNotifications(); }
    } catch (error) { toast(error.message || 'Não foi possível ativar as notificações.',true); }
  });
  panel.querySelectorAll('[data-pwa-notification]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.pwaNotification;
    await supabase.from('notifications').update({read_at:new Date().toISOString()}).eq('id',id);
    const url = btn.dataset.pwaUrl;
    panel.remove();
    await loadNotifications();
    if (url) {
      let target = url;
      if (target.startsWith('/?')) target = `.${target}`;
      window.location.href = new URL(target, window.location.href).href;
    }
  }));
}

function injectBell() {
  const topbarActions = document.querySelector('.topbar-actions');
  if (!topbarActions || !currentUser) return;
  if (topbarActions.querySelector('.cf-pwa-bell')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'icon-btn cf-pwa-bell';
  btn.addEventListener('click', openNotifications);
  topbarActions.prepend(btn);
  updateBell();
}

async function resolveUser() {
  const { data } = await supabase.auth.getSession();
  currentUser = data?.session?.user || null;
  if (!currentUser) {
    document.querySelector('.cf-pwa-bell')?.remove();
    document.querySelector('.cf-pwa-panel')?.remove();
    return;
  }
  injectBell();
  await loadNotifications();
  if (Notification.permission === 'granted') ensurePushSubscription().catch(() => null);
}

async function initPwa() {
  if ('serviceWorker' in navigator) {
    try { registration = await navigator.serviceWorker.register('./sw.js',{scope:'./'}); }
    catch (error) { console.warn('Service worker:',error); }
  }
  await resolveUser();
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => { if (currentUser) loadNotifications(); }, 60000);
}

const observer = new MutationObserver(() => injectBell());
observer.observe(document.documentElement,{childList:true,subtree:true});
supabase.auth.onAuthStateChange(() => setTimeout(resolveUser,120));
initPwa();
