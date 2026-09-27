import nodemailer from 'npm:nodemailer@10.0.11';
import {createClient} from 'npm:@supabase/supabase-js@2.117.1';
const sender='geral.condomia@gmail.com';
const appUrl='https://flavavisio.github.io/condominio/app.html';
const json=(data:unknown,status=200)=>Response.json(data,{status});
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const safeError=(e:any)=>({code:String(e?.code||'ERROR').slice(0,50),smtp:Number(e?.responseCode)||null});
Deno.serve(async req=>{
 if(req.method!=='POST')return json({error:'Método inválido'},405);
 const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:config,error}=await client.from('email_dispatch_config').select('*').eq('id',1).single();
 if(error||!config)return json({error:'Configuração indisponível'},503);
 if(!req.headers.get('x-cron-secret')||req.headers.get('x-cron-secret')!==config.cron_secret)return json({error:'Não autorizado'},401);
 const password=Deno.env.get('GMAIL_APP_PASSWORD')?.replace(/\s/g,'');
 if(!password)return json({error:'GMAIL_APP_PASSWORD não configurado'},503);
 const transport=nodemailer.createTransport({host:'smtp.gmail.com',port:465,secure:true,auth:{user:sender,pass:password},connectionTimeout:12000,greetingTimeout:12000,socketTimeout:20000,disableFileAccess:true,disableUrlAccess:true,logger:false,debug:false});
 let body:any={};try{body=await req.json();}catch{ /* cron defaults to dispatch */ }
 if(body.mode==='verify'){
  try{await transport.verify();await client.from('email_dispatch_config').update({verified_at:new Date().toISOString(),last_error:null}).eq('id',1);return json({ok:true,smtpVerified:true,sender});}
  catch(e){const failure=safeError(e);await client.from('email_dispatch_config').update({last_error:JSON.stringify(failure)}).eq('id',1);return json({ok:false,...failure},502);}finally{transport.close();}
 }
 if(body.mode==='test'){
  try{const result=await transport.sendMail({from:{name:'Condomia',address:sender},to:sender,replyTo:sender,subject:'Condomia · Teste do envio de email',text:'A ligação de email da Condomia foi configurada com sucesso. Este é um teste técnico enviado para a própria conta oficial.\n\nCondomia — Condomínio fácil'});return json({ok:Boolean(result.accepted?.length),testAccepted:Boolean(result.accepted?.length),sender});}
  catch(e){return json({ok:false,...safeError(e)},502);}finally{transport.close();}
 }
 if(!config.enabled)return json({ok:true,paused:true});
 let sent=0,failed=0,skipped=0;
 const deadline=Date.now()+45000;
 try{
  for(let i=0;i<5&&Date.now()<deadline;i++){
   const {data:rows,error:claimError}=await client.rpc('claim_notification_email');if(claimError)throw claimError;
   const item=rows?.[0];if(!item)break;
   const update=async(values:Record<string,unknown>)=>{const {error}=await client.from('notification_emails').update(values).eq('notification_id',item.notification_id);if(error)throw error;};
   const {data:n}=await client.from('notifications').select('id,user_id,title,body,company_id,condominium_id,kind').eq('id',item.notification_id).maybeSingle();
   if(!n){await update({status:'skipped',last_error:'Aviso removido'});skipped++;continue;}
   const {data:recipient,error:userError}=await client.auth.admin.getUserById(n.user_id);
   if(userError||!recipient.user?.email){await update({status:'skipped',last_error:'Destinatário indisponível'});skipped++;continue;}
   // Verify that the recipient still has access before transmitting a queued notification.
   const {data:allowed}=await client.rpc('can_receive_notification_email',{p_notification_id:n.id});
   if(!allowed){await update({status:'skipped',last_error:'Acesso ao aviso removido'});skipped++;continue;}
   try{
    const title=String(n.title).replace(/[\r\n]/g,' ').slice(0,200);
    const result=await transport.sendMail({from:{name:'Condomia',address:sender},replyTo:sender,to:{address:recipient.user.email,name:''},subject:`Condomia · ${title}`,messageId:`<condomia-${n.id}@gmail.com>`,text:`${title}\n\n${n.body}\n\nAceder à Condomia: ${appUrl}\n\nCondomia — Condomínio fácil\n${sender}`,html:`<!doctype html><html lang="pt"><body style="margin:0;background:#f4f7fb;font-family:Arial,sans-serif;color:#18354d"><div style="max-width:600px;margin:24px auto;background:white;padding:32px;border-radius:16px"><p style="color:#137a8e;font-size:24px;font-weight:bold">Condomia</p><p>Condomínio fácil</p><h2>${esc(title)}</h2><p style="line-height:1.7;white-space:pre-line">${esc(n.body)}</p><p><a href="${appUrl}" style="display:inline-block;padding:14px 22px;background:#137a8e;color:white;text-decoration:none;border-radius:8px">Abrir aplicação</a></p><hr style="border:0;border-top:1px solid #e6ebf2"><p style="font-size:12px">Aviso automático da Condomia. Pode responder para ${sender}.</p></div></body></html>`});
    if(!result.accepted?.length)throw Object.assign(new Error('Rejected'),{code:'ERECIPIENT',responseCode:550});
    await update({status:'sent',sent_at:new Date().toISOString(),last_error:null});sent++;
   }catch(e){
    const failure=safeError(e);
    // A timeout after DATA can mean Gmail accepted the message: never replay automatically.
    const safeRetry=['ECONNECTION','EDNS','EAUTH'].includes(failure.code)||(failure.smtp!==null&&failure.smtp>=400&&failure.smtp<500);
    await update({status:safeRetry&&item.attempts<5?'retry':'review',next_attempt_at:new Date(Date.now()+Math.min(3600000,60000*2**item.attempts)).toISOString(),last_error:JSON.stringify(failure)});failed++;
   }
  }
  return json({ok:true,sent,failed,skipped});
 }catch(e){return json({ok:false,...safeError(e)},500);}finally{transport.close();}
});
