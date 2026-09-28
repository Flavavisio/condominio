import {createClient} from 'npm:@supabase/supabase-js@2.117.1';
import {validateConfig,companyTransport,safeError} from '../_shared/mail.ts';
import {emailLayout,appUrl} from '../email-dispatch/layout.js';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:cors});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(req.method!=='POST')return json({error:'Método inválido'},405);
 const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:{user},error}=await client.auth.getUser((req.headers.get('authorization')||'').replace(/^Bearer\s+/i,''));
 if(error||!user)return json({error:'Sessão inválida'},401);
 let b:any;try{b=await req.json();}catch{return json({error:'Pedido inválido'},400);}
 if(!b||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(b.companyId||''))return json({error:'Empresa inválida'},400);
 const {data:member}=await client.from('company_members').select('role').eq('company_id',b.companyId).eq('user_id',user.id).eq('status','active').maybeSingle();
 if(member?.role!=='admin')return json({error:'Apenas o administrador desta empresa pode configurar o SMTP.'},403);
 const {data:company}=await client.from('companies').select('name,label,logo_url,status').eq('id',b.companyId).single();
 if(company?.status!=='active')return json({error:'Empresa inativa'},403);
 if(b.action==='save'){
  let c;try{c=validateConfig(b.config);}catch(e){return json({error:e.message},400);}
  const {error}=await client.rpc('company_smtp_secret',{p_company_id:b.companyId,p_config:c});
  return error?json({error:'Não foi possível guardar. Na primeira configuração, indique a palavra-passe SMTP.'},400):json({ok:true});
 }
 const {data:state}=await client.from('company_smtp').select('verified_at,revision,last_error,last_test_at').eq('company_id',b.companyId).maybeSingle();
 const {data:c,error:ce}=await client.rpc('company_smtp_secret',{p_company_id:b.companyId});
 if(ce)return json({error:'Configuração indisponível'},503);
 if(b.action==='get'){
  // Explicit allowlist: credentials never leave this endpoint.
  const config=c?{host:c.host,port:c.port,user:c.user,name:c.name,from:c.from,replyTo:c.replyTo,hasPassword:Boolean(c.password)}:null;
  const counts=await Promise.all([['pending','retry'],['review']].map(statuses=>client.from('notification_emails').select('notification_id,notifications!inner(company_id)',{count:'exact',head:true}).eq('notifications.company_id',b.companyId).in('status',statuses)));
  if(counts.some(r=>r.error))return json({error:'Não foi possível consultar os envios.'},503);
  const pending=counts[0].count||0,review=counts[1].count||0;
  return json({config,state,pending,review});
 }
 if(b.action!=='test')return json({error:'Ação inválida'},400);
 if(!c||!state)return json({error:'Guarde primeiro a configuração SMTP.'},400);
 const {data:lock}=await client.from('company_smtp').update({last_test_at:new Date().toISOString()}).eq('company_id',b.companyId).eq('revision',state.revision).or(`last_test_at.is.null,last_test_at.lt.${new Date(Date.now()-60000).toISOString()}`).select('revision').maybeSingle();
 if(!lock)return json({error:'Aguarde um minuto antes de repetir o teste.'},429);
 let transport;
 try{
  transport=await companyTransport(c);
  const result=await transport.sendMail({from:{name:c.name,address:c.from},replyTo:c.replyTo,to:user.email,subject:'Teste de email da empresa',...emailLayout('Teste de envio','O servidor SMTP aceitou este email de teste. Os próximos emails aos funcionários e condóminos serão enviados por esta configuração.',appUrl,'Abrir aplicação',{name:company.label||company.name,email:c.replyTo,logo:company.logo_url})});
  if(!result.accepted?.length)throw Object.assign(new Error('Recusado'),{code:'ERECIPIENT'});
  const {data:updated,error:ue}=await client.from('company_smtp').update({verified_at:new Date().toISOString(),last_error:null}).eq('company_id',b.companyId).eq('revision',state.revision).select('revision').maybeSingle();
  if(ue||!updated)return json({error:'A configuração mudou durante o teste. Teste novamente a versão guardada.'},409);
  return json({ok:true,message:'Email aceite pelo servidor SMTP. Confirme a receção na sua caixa de correio.'});
 }catch(e){const failure=safeError(e);await client.from('company_smtp').update({verified_at:null,last_error:JSON.stringify(failure)}).eq('company_id',b.companyId).eq('revision',state.revision);return json({error:'O teste falhou. Verifique servidor, credenciais e permissões do remetente.',details:failure},502);}
 finally{transport?.close();}
});
