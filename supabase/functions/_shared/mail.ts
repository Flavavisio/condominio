import nodemailer from 'npm:nodemailer@10.0.11';
import ipaddr from 'npm:ipaddr.js@2.2.0';
import {sender} from '../email-dispatch/layout.js';
export const safeError=(e:any)=>({code:String(e?.code||'ERROR').slice(0,50),smtp:Number(e?.responseCode)||null});
export function validateConfig(c:any){
 const email=/^[^\s<>@\r\n]+@[^\s<>@\r\n]+\.[^\s<>@\r\n]+$/;
 if(!c||['host','from','replyTo','name','user','password'].some(k=>typeof c[k]!=='string'))throw new Error('Configuração SMTP inválida.');
 if(!email.test(c.from)||!email.test(c.replyTo)||!c.name||c.name.length>120||/[\r\n]/.test(c.name))throw new Error('Indique remetente e endereço de resposta válidos.');
 if(!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/i.test(c.host)||!c.host.includes('.')||ipaddr.isValid(c.host))throw new Error('Indique o nome público do servidor SMTP.');
 if(![465,587,2525].includes(c.port))throw new Error('Utilize a porta 465 (TLS) ou 587 / 2525 (STARTTLS).');
 if(!c.user||c.user.length>254||/[\r\n]/.test(c.user)||typeof c.password!=='string'||c.password.length>1024)throw new Error('Credenciais SMTP inválidas.');
 return {host:c.host.toLowerCase(),port:c.port,user:c.user,name:c.name,from:c.from,replyTo:c.replyTo,password:c.password};
}
export function publicIPv4(address:string){return ipaddr.isValid(address)&&ipaddr.parse(address).kind()==='ipv4'&&ipaddr.parse(address).range()==='unicast';}
export async function companyTransport(c:any,timeout=10000){
 validateConfig(c);
 // Resolve and pin a public IPv4; prevents local targets and DNS rebinding.
 const ips=await Deno.resolveDns(c.host,'A');
 if(!ips.length||ips.some(ip=>!publicIPv4(ip)))throw Object.assign(new Error('Servidor não público'),{code:'EHOST'});
 return nodemailer.createTransport({host:ips[0],port:c.port,secure:c.port===465,requireTLS:c.port!==465,tls:{servername:c.host,rejectUnauthorized:true,minVersion:'TLSv1.2'},auth:{user:c.user,pass:c.password},connectionTimeout:timeout,greetingTimeout:timeout,socketTimeout:timeout,disableFileAccess:true,disableUrlAccess:true,logger:false,debug:false});
}
export function platformTransport(timeout=10000){
 const pass=Deno.env.get('GMAIL_APP_PASSWORD')?.replace(/\s/g,'');
 if(!pass)throw Object.assign(new Error('Gmail não configurado'),{code:'ECONFIG'});
 return nodemailer.createTransport({host:'smtp.gmail.com',port:465,secure:true,auth:{user:sender,pass},connectionTimeout:timeout,greetingTimeout:timeout,socketTimeout:timeout,disableFileAccess:true,disableUrlAccess:true,logger:false,debug:false});
}
export async function companyMail(client:any,companyId:string,timeout=10000){
 const {data:state,error}=await client.from('company_smtp').select('verified_at,revision').eq('company_id',companyId).maybeSingle();
 if(error||!state?.verified_at)throw Object.assign(new Error('Configure e teste o SMTP da empresa em Configurações → Email.'),{code:'ECONFIG'});
 const {data:c,error:secretError}=await client.rpc('company_smtp_secret',{p_company_id:companyId});
 if(secretError||!c)throw Object.assign(new Error('Configuração SMTP indisponível.'),{code:'ECONFIG'});
 const {data:current}=await client.from('company_smtp').select('verified_at,revision').eq('company_id',companyId).eq('revision',state.revision).maybeSingle();
 if(!current?.verified_at)throw Object.assign(new Error('Configuração SMTP alterada; repita o teste.'),{code:'ECONFIG'});
 const {data:company}=await client.from('companies').select('name,label,logo_url,status').eq('id',companyId).single();
 if(company?.status!=='active')throw Object.assign(new Error('Empresa inativa.'),{code:'ECONFIG'});
 return {transport:await companyTransport(c,timeout),from:{name:c.name,address:c.from},replyTo:c.replyTo,brand:{name:company.label||company.name,email:c.replyTo,logo:company.logo_url},companyId,revision:state.revision};
}
export function platformMail(timeout=10000){return {transport:platformTransport(timeout),from:{name:'Condomia',address:sender},replyTo:sender,brand:undefined,companyId:null,revision:null};}
export async function authMail(client:any,user:any,kind:string,timeout=4000){
 const {data:r,error}=await client.rpc('resolve_auth_email_company',{p_user_id:user.id,p_email:user.email});
 if(error||!r||r.ambiguous||(r.unassigned&&kind!=='signup'))throw Object.assign(new Error('Não foi possível determinar a empresa da conta.'),{code:'EROUTE'});
 return (r.platform||r.unassigned&&kind==='signup')?platformMail(timeout):companyMail(client,r.company_id,timeout);
}
export async function notificationMail(client:any,n:any){
 const {data:p,error:pe}=await client.from('profiles').select('is_super_admin').eq('user_id',n.user_id).maybeSingle();
 if(pe)throw pe;
 const {data:m,error:me}=await client.from('company_members').select('role').eq('company_id',n.company_id).eq('user_id',n.user_id).eq('status','active').maybeSingle();
 if(me)throw me;
 return p?.is_super_admin||m?.role==='admin'?platformMail():companyMail(client,n.company_id);
}
