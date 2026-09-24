import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' }
});

Deno.serve(async (req: Request) => {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json({ error: 'Configuração Supabase em falta.' }, 500);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: config, error: configError } = await admin
    .from('push_server_config')
    .select('id,vapid_public_key,vapid_private_key,vapid_subject,cron_secret')
    .eq('id', 1)
    .maybeSingle();
  if (configError || !config) return json({ error: configError?.message || 'Configuração push não encontrada.' }, 500);

  const suppliedSecret = req.headers.get('x-cron-secret') || '';
  if (!config.cron_secret || suppliedSecret !== config.cron_secret) return json({ error: 'Não autorizado.' }, 401);

  let publicKey = config.vapid_public_key;
  let privateKey = config.vapid_private_key;
  if (!publicKey || !privateKey) {
    const generated = webpush.generateVAPIDKeys();
    publicKey = generated.publicKey;
    privateKey = generated.privateKey;
    const { error: updateError } = await admin.from('push_server_config').update({
      vapid_public_key: publicKey,
      vapid_private_key: privateKey,
      updated_at: new Date().toISOString()
    }).eq('id', 1);
    if (updateError) return json({ error: updateError.message }, 500);
  }

  await admin.from('push_public_config').upsert({ id: 1, vapid_public_key: publicKey, updated_at: new Date().toISOString() });
  webpush.setVapidDetails(config.vapid_subject || 'https://flavavisio.github.io/condominio/', publicKey, privateKey);

  const { data: notifications, error: queueError } = await admin
    .from('notifications')
    .select('id,user_id,title,body,url,severity,payload,push_status,push_attempts')
    .in('push_status', ['pending', 'failed'])
    .lte('next_push_at', new Date().toISOString())
    .lt('push_attempts', 5)
    .order('created_at', { ascending: true })
    .limit(100);
  if (queueError) return json({ error: queueError.message }, 500);

  let sent = 0;
  let failed = 0;
  let noSubscription = 0;

  for (const item of notifications || []) {
    const { data: subscriptions, error: subError } = await admin
      .from('push_subscriptions')
      .select('id,endpoint,p256dh,auth')
      .eq('user_id', item.user_id)
      .eq('enabled', true);

    if (subError) {
      failed += 1;
      await admin.from('notifications').update({
        push_status: 'failed',
        push_attempts: Number(item.push_attempts || 0) + 1,
        last_push_error: subError.message,
        next_push_at: new Date(Date.now() + 5 * 60_000).toISOString()
      }).eq('id', item.id);
      continue;
    }

    if (!subscriptions?.length) {
      noSubscription += 1;
      await admin.from('notifications').update({ push_status: 'no_subscription', last_push_error: 'Sem dispositivo PWA subscrito.' }).eq('id', item.id);
      continue;
    }

    const payload = JSON.stringify({ id: item.id, title: item.title, body: item.body, url: item.url || './', severity: item.severity || 'info', data: item.payload || {} });
    let successCount = 0;
    const errors: string[] = [];

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
          TTL: 600,
          urgency: item.severity === 'urgent' ? 'high' : 'normal'
        });
        successCount += 1;
      } catch (error: any) {
        const statusCode = Number(error?.statusCode || error?.status || 0);
        if (statusCode === 404 || statusCode === 410) await admin.from('push_subscriptions').delete().eq('id', sub.id);
        errors.push(error?.message || `Erro push ${statusCode || ''}`.trim());
      }
    }

    if (successCount > 0) {
      sent += 1;
      await admin.from('notifications').update({ push_status: 'sent', sent_at: new Date().toISOString(), push_attempts: Number(item.push_attempts || 0) + 1, last_push_error: errors.length ? errors.join(' | ').slice(0, 1000) : null }).eq('id', item.id);
    } else {
      failed += 1;
      const attempts = Number(item.push_attempts || 0) + 1;
      const delayMinutes = Math.min(30, Math.max(2, 2 ** Math.min(attempts, 5)));
      await admin.from('notifications').update({ push_status: 'failed', push_attempts: attempts, last_push_error: errors.join(' | ').slice(0, 1000) || 'Falha de entrega.', next_push_at: new Date(Date.now() + delayMinutes * 60_000).toISOString() }).eq('id', item.id);
    }
  }

  return json({ ok: true, processed: notifications?.length || 0, sent, failed, noSubscription, vapidReady: Boolean(publicKey) });
});
