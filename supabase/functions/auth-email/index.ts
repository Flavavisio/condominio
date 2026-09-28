import {Webhook} from 'npm:standardwebhooks@1.0.0';
import {createClient} from 'npm:@supabase/supabase-js@2.117.1';
import {authMail} from '../_shared/mail.ts';
import {emailLayout} from '../email-dispatch/layout.js';
const callback='https://flavavisio.github.io/condominio/auth.html';
Deno.serve(async req=>{
 if(req.method!=='POST')return new Response('Método inválido',{status:405});
 const secret=Deno.env.get('SEND_EMAIL_HOOK_SECRET');
 if(!secret)return Response.json({error:{message:'Email de autenticação ainda não configurado',http_code:503}},{status:503});
 let payload:any;
 try{payload=new Webhook(secret.trim().replace(/^v1,/, '')).verify(await req.text(),Object.fromEntries(req.headers));}
 catch(error){
  const message=String((error as Error)?.message||'');
  const reason=/timestamp.*old/i.test(message)?'timestamp_old':/timestamp.*future/i.test(message)?'timestamp_future':/header/i.test(message)?'headers_missing':/base64|character|decode/i.test(message)?'secret_encoding':/signature/i.test(message)?'signature_mismatch':'verification_error';
  console.warn(JSON.stringify({event:'auth_email_signature_rejected',reason,errorType:(error as Error)?.name,hasVersionPrefix:secret.trim().startsWith('v1,'),hasSigningPrefix:secret.trim().includes('whsec_')}));
  return new Response('Assinatura inválida',{status:401});
 }
 const user=payload.user,data=payload.email_data,kind=data?.email_action_type;
 const labels:Record<string,[string,string,string]>={
 signup:['Confirme a sua conta','Confirme o seu endereço de email para concluir o registo na Condomia.','Confirmar email'],
 recovery:['Recuperar palavra-passe','Recebemos um pedido para alterar a sua palavra-passe. Abra o link para definir uma nova. Se não fez este pedido, pode ignorar este email.','Definir palavra-passe'],
 invite:['Convite para a Condomia','Foi convidado a aceder à Condomia. Aceite o convite e defina a sua palavra-passe.','Aceitar convite'],
 magiclink:['Acesso à Condomia','Utilize o botão para confirmar o seu acesso. Se não pediu este email, pode ignorá-lo.','Confirmar acesso'],
 email_change:['Confirmar alteração de email','Confirme a alteração do endereço de email da sua conta. Se não fez este pedido, contacte a equipa Condomia.','Confirmar alteração'],
 reauthentication:['Código de segurança','Utilize o código abaixo na aplicação para confirmar a operação. Nunca partilhe este código.','Abrir aplicação']
 };
 if(!user?.email||!labels[kind])return Response.json({error:{message:'Tipo de email inválido',http_code:400}},{status:400});
 const jobs=kind==='email_change'?
 [...(data.token_hash_new?[{email:user.email,hash:data.token_hash_new}]:[]),{email:user.new_email,hash:data.token_hash}]:[{email:user.email,hash:data.token_hash}];
 if(jobs.some(j=>!j.email||(!j.hash&&kind!=='reauthentication')))return new Response('Dados inválidos',{status:400});
 let mail;
 try{
  const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
  mail=await authMail(client,user,kind);
  for(const job of jobs){
   const [title,message,label]=labels[kind];
   const target=kind==='reauthentication'?'https://flavavisio.github.io/condominio/app.html':`${callback}?type=${encodeURIComponent(kind)}&token_hash=${encodeURIComponent(job.hash)}`;
   const result=await mail.transport.sendMail({from:mail.from,replyTo:mail.replyTo,to:{address:job.email,name:''},subject:`${mail.from.name} · ${title}`,...emailLayout(title,kind==='reauthentication'?`${message}\n\n${data.token}`:message,target,label,mail.brand)});
   if(!result.accepted?.length)throw new Error('SMTP rejected');
  }
  return Response.json({});
 }catch{return Response.json({error:{message:'Não foi possível enviar o email. Tente novamente mais tarde.',http_code:502}},{status:502});}
 finally{mail?.transport.close();}
});
