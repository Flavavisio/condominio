import {Webhook} from 'npm:standardwebhooks@1.0.0';
import nodemailer from 'npm:nodemailer@10.0.11';
import {emailLayout,sender} from '../email-dispatch/layout.js';
const callback='https://flavavisio.github.io/condominio/auth.html';
Deno.serve(async req=>{
 if(req.method!=='POST')return new Response('Método inválido',{status:405});
 const secret=Deno.env.get('SEND_EMAIL_HOOK_SECRET');
 if(!secret)return Response.json({error:{message:'Email de autenticação ainda não configurado',http_code:503}},{status:503});
 let payload:any;
 try{payload=new Webhook(secret.replace(/^v1,whsec_/, '')).verify(await req.text(),Object.fromEntries(req.headers));}
 catch{return new Response('Assinatura inválida',{status:401});}
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
 const password=Deno.env.get('GMAIL_APP_PASSWORD')?.replace(/\s/g,'');
 if(!password)return new Response('Configuração indisponível',{status:503});
 const jobs=kind==='email_change'?
 [...(data.token_hash_new?[{email:user.email,hash:data.token_hash_new}]:[]),{email:user.new_email,hash:data.token_hash}]:[{email:user.email,hash:data.token_hash}];
 if(jobs.some(j=>!j.email||(!j.hash&&kind!=='reauthentication')))return new Response('Dados inválidos',{status:400});
 const transport=nodemailer.createTransport({host:'smtp.gmail.com',port:465,secure:true,auth:{user:sender,pass:password},connectionTimeout:4000,greetingTimeout:4000,socketTimeout:4000,disableFileAccess:true,disableUrlAccess:true,logger:false,debug:false});
 try{
  for(const job of jobs){
   const [title,message,label]=labels[kind];
   const target=kind==='reauthentication'?'https://flavavisio.github.io/condominio/app.html':`${callback}?type=${encodeURIComponent(kind)}&token_hash=${encodeURIComponent(job.hash)}`;
   const result=await transport.sendMail({from:{name:'Condomia',address:sender},replyTo:sender,to:{address:job.email,name:''},subject:`Condomia · ${title}`,...emailLayout(title,kind==='reauthentication'?`${message}\n\n${data.token}`:message,target,label)});
   if(!result.accepted?.length)throw new Error('SMTP rejected');
  }
  return Response.json({});
 }catch{return Response.json({error:{message:'Não foi possível enviar o email. Tente novamente mais tarde.',http_code:502}},{status:502});}
 finally{transport.close();}
});
