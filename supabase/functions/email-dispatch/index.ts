import {platformTransport,notificationMail,safeError} from '../_shared/mail.ts';
import {createClient} from 'npm:@supabase/supabase-js@2.117.1';
import {emailLayout,sender} from './layout.js';
const json=(data:unknown,status=200)=>Response.json(data,{status});
Deno.serve(async req=>{
 if(req.method!=='POST')return json({error:'Método inválido'},405);
 const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:config,error}=await client.from('email_dispatch_config').select('*').eq('id',1).single();
 if(error||!config)return json({error:'Configuração indisponível'},503);
 if(!req.headers.get('x-cron-secret')||req.headers.get('x-cron-secret')!==config.cron_secret)return json({error:'Não autorizado'},401);
 let body:any={};try{body=await req.json();}catch{ /* cron defaults to dispatch */ }
 if(body.mode==='verify'){
  const transport=platformTransport();
  try{await transport.verify();await client.from('email_dispatch_config').update({verified_at:new Date().toISOString(),last_error:null}).eq('id',1);return json({ok:true,smtpVerified:true,sender});}
  catch(e){const failure=safeError(e);await client.from('email_dispatch_config').update({last_error:JSON.stringify(failure)}).eq('id',1);return json({ok:false,...failure},502);}finally{transport.close();}
 }
 if(body.mode==='test'){
  const transport=platformTransport();
  try{const result=await transport.sendMail({from:{name:'Condomia',address:sender},to:sender,replyTo:sender,subject:'Condomia · Teste do envio de email',...emailLayout('Teste do envio de email','A ligação de email da Condomia foi configurada com sucesso. Este teste apresenta o layout comum a todos os avisos, com o logótipo e o nome da Condomia.')});return json({ok:Boolean(result.accepted?.length),testAccepted:Boolean(result.accepted?.length),sender});}
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
   const {data:n}=await client.from('notifications').select('id,user_id,title,body,company_id,condominium_id,kind,payload').eq('id',item.notification_id).maybeSingle();
   if(!n){await update({status:'skipped',last_error:'Aviso removido'});skipped++;continue;}
   const {data:recipient,error:userError}=await client.auth.admin.getUserById(n.user_id);
   if(userError||!recipient.user?.email){await update({status:'skipped',last_error:'Destinatário indisponível'});skipped++;continue;}
   // Verify that the recipient still has access before transmitting a queued notification.
   const {data:allowed}=await client.rpc('can_receive_notification_email',{p_notification_id:n.id});
   if(!allowed){await update({status:'skipped',last_error:'Acesso ao aviso removido'});skipped++;continue;}
   if(['charge_issued','charge_reminder'].includes(n.kind)){
    const {data:charge,error:chargeError}=await client.from('fraction_charges').select('status,fraction_id').eq('id',n.payload?.charge_id).maybeSingle();
    if(chargeError)throw chargeError;
    const {data:proof,error:proofError}=await client.from('payment_proofs').select('id').eq('charge_id',n.payload?.charge_id).eq('status','pending').limit(1).maybeSingle();
    if(proofError)throw proofError;
    const {data:membership,error:membershipError}=charge?await client.from('condominium_members').select('user_id').eq('fraction_id',charge.fraction_id).eq('user_id',n.user_id).eq('status','active').limit(1).maybeSingle():{data:null,error:null};
    if(membershipError)throw membershipError;
    if(!membership||!charge||['paid','cancelled'].includes(charge.status)||(n.kind==='charge_reminder'&&proof)){
     await update({status:'skipped',last_error:'Quota liquidada, anulada ou comprovativo em validação.'});skipped++;continue;
    }
   }
   let mail;
   try{
    mail=await notificationMail(client,n);
    const title=String(n.title).replace(/[\r\n]/g,' ').slice(0,200);
    const result=await mail.transport.sendMail({from:mail.from,replyTo:mail.replyTo,to:{address:recipient.user.email,name:''},subject:`${mail.from.name} · ${title}`,messageId:`<condomia-${n.id}@${mail.from.address.split('@')[1]}>`,...emailLayout(title,n.body,undefined,undefined,mail.brand)});
    if(!result.accepted?.length)throw Object.assign(new Error('Rejected'),{code:'ERECIPIENT',responseCode:550});
    await update({status:'sent',sent_at:new Date().toISOString(),last_error:null});sent++;
   }catch(e){
    const failure=safeError(e);
    if(failure.code==='ECONFIG'){
     await update({status:'retry',attempts:Math.max(0,item.attempts-1),next_attempt_at:new Date(Date.now()+900000).toISOString(),last_error:'SMTP da empresa por configurar ou validar.'});failed++;continue;
    }
    if(mail?.companyId)await client.from('company_smtp').update({last_error:JSON.stringify(failure)}).eq('company_id',mail.companyId).eq('revision',mail.revision);
    // A timeout after DATA can mean Gmail accepted the message: never replay automatically.
    const safeRetry=['ECONNECTION','EDNS','EAUTH'].includes(failure.code)||(failure.smtp!==null&&failure.smtp>=400&&failure.smtp<500);
    await update({status:safeRetry&&item.attempts<5?'retry':'review',next_attempt_at:new Date(Date.now()+Math.min(3600000,60000*2**item.attempts)).toISOString(),last_error:JSON.stringify(failure)});failed++;
   }finally{mail?.transport.close();}
  }
  return json({ok:true,sent,failed,skipped});
 }catch(e){return json({ok:false,...safeError(e)},500);}
});
