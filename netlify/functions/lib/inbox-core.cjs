const { createClient } = require('@supabase/supabase-js');
const crypto = require('node:crypto');
const net = require('node:net');
const dns = require('node:dns').promises;
const nodemailer = require('nodemailer');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function problem(status, message) { return Object.assign(new Error(message), {status}); }
function result(statusCode,body){return {statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body)};}
async function context(event){
 const url=process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url || !key)throw problem(503,'Inbox server configuration is incomplete.');
 const token=(event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\s+/i,'');
 if(!token)throw problem(401,'Please sign in again.');
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await db.auth.getUser(token);
 if(error||!data?.user)throw problem(401,'Please sign in again.');
 return {db,uid:data.user.id};
}
async function checked(query){const {data,error}=await query;if(error)throw problem(503,'Inbox data is unavailable. Check the database installation.');return data;}
async function channel(ctx,id){
 if(!uuid.test(id||''))throw problem(400,'A connected sender is required.');
 const row=await checked(ctx.db.from('channels').select('*').eq('id',id).eq('user_id',ctx.uid).eq('channel_type','email').maybeSingle());
 if(!row)throw problem(404,'Sender not found for this account.');return row;
}
const address = v => typeof v==='string' ? v.trim().toLowerCase() : '';
function sender(row){return address(row.sender_id || row.credentials?.email_address || row.credentials?.smtp_username);}
function headersafe(v){return typeof v==='string' && !/[\r\n]/.test(v);}
function email(v){return headersafe(v) && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(v);}
// Stored SMTP/IMAP settings must point to public mail infrastructure.
function publicIP(ip){
 if(net.isIP(ip)===4){const [a,b]=ip.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)||(a===198&&(b===18||b===19)));}
 // Reject IPv4-mapped IPv6 and non-global ranges. SiteGround supplies public IPv4 records.
 return net.isIP(ip)===6 && /^[23][0-9a-f]{3}:/i.test(ip);
}
async function mailHost(host){
 if(typeof host!=='string'||!host||/[\s/:]/.test(host))throw problem(400,'Invalid mail server hostname.');
 const ips=await dns.lookup(host,{all:true});if(!ips.length||ips.some(r=>!publicIP(r.address)))throw problem(400,'Mail server must resolve to a public address.');
 return {host:ips[0].address,servername:host};
}
function references(row){return [...new Set([...(Array.isArray(row.thread_refs)?row.thread_refs:[]),row.in_reply_to,row.message_id].filter(v=>typeof v==='string' && /^<[^<>\s]+@[^<>\s]+>$/.test(v)))].slice(-30);}
async function activity(ctx,id){
 if(!/^(history|mail):[0-9a-f-]{36}$/i.test(id||''))throw problem(400,'Choose an email first.');
 const row=await checked(ctx.db.from('outreach_inbox_activity').select('*').eq('user_id',ctx.uid).eq('activity_id',id).maybeSingle());
 if(!row)throw problem(404,'Email not found.');return row;
}
async function legacyLog(ctx,row){
 // Preserve the old workflow's ai/lead role vocabulary. The new view labels manual replies correctly.
 const {error}=await ctx.db.from('conversation_history').upsert({id:row.id,lead_id:row.lead_id,campaign_id:row.campaign_id,channel:'email',from_role:row.direction==='inbound'?'lead':'ai',message:row.body_text,timestamp:row.created_at},{onConflict:'id'});
 return !error;
}
async function sendReply(ctx,input){
 if(!uuid.test(input.request_id||''))throw problem(400,'Invalid reply request.');
 if(typeof input.text!=='string'||!input.text.trim()||input.text.length>20000)throw problem(400,'Write a reply of 1–20,000 characters.');
 const existing=await checked(ctx.db.from('outreach_inbox_mail').select('status,id').eq('user_id',ctx.uid).eq('source_key','manual:'+input.request_id).maybeSingle());
 if(existing)return {status:existing.status,duplicate:true};
 const target=await activity(ctx,input.activity_id);
 if(!['sent','received'].includes(target.status))throw problem(409,'This email has no confirmed send/receive result. Review it before replying.');
 const ch=await channel(ctx,target.channel_id);
 if(ch.is_active!==true)throw problem(409,'The original sender is inactive. Review that mailbox before replying.');
 const lead=await checked(ctx.db.from('uploaded_leads').select('id,email,campaign_id').eq('id',target.lead_id).eq('user_id',ctx.uid).maybeSingle());
 if(!lead || lead.campaign_id!==target.campaign_id)throw problem(409,'The lead no longer matches this conversation.');
 const from=sender(ch),to=address(target.direction==='inbound' ? target.from_email : lead.email);
 if(!email(from)||!email(to))throw problem(400,'Sender or prospect email is missing.');
 if(!/^<[^<>\s]+@[^<>\s]+>$/.test(target.message_id||''))throw problem(409,'This older record has no Message-ID. Sync its reply from the original inbox before replying in-thread.');
 const subject=/^re:/i.test(target.subject)?target.subject:'Re: '+target.subject;
 if(!headersafe(subject)||subject.length>500)throw problem(400,'Invalid subject.');
 const c=ch.credentials||{};const port=Number(c.smtp_port||465);
 if(![465,587].includes(port)||!(c.smtp_password||c.smtp_pass)||!(c.smtp_username||c.smtp_user))throw problem(400,'The original inbox SMTP settings are incomplete.');
 const resolved=await mailHost(c.smtp_host);
 const messageId='<'+crypto.randomUUID()+'@'+from.split('@')[1]+'>';
 const row={user_id:ctx.uid,lead_id:target.lead_id,campaign_id:target.campaign_id,channel_id:ch.id,direction:'outbound',status:'sending',subject,body_text:input.text.trim(),body_html:'',from_email:from,to_email:to,message_id:messageId,in_reply_to:target.message_id,thread_refs:references(target),source_key:'manual:'+input.request_id};
 const inserted=await ctx.db.from('outreach_inbox_mail').insert(row).select('*').single();
 if(inserted.error){if(inserted.error.code==='23505')return {status:'sending',duplicate:true};throw problem(503,'Could not reserve this reply. No email sent.');}
 const saved=inserted.data;
 const transport=nodemailer.createTransport({host:resolved.host,port,secure:port===465,requireTLS:port!==465,tls:{servername:resolved.servername,rejectUnauthorized:true},auth:{user:c.smtp_username||c.smtp_user,pass:c.smtp_password||c.smtp_pass},connectionTimeout:7000,greetingTimeout:7000,socketTimeout:10000,disableFileAccess:true,disableUrlAccess:true});
 let status='unknown';
 try{
  const info=await transport.sendMail({from,to,subject,text:row.body_text,messageId,inReplyTo:row.in_reply_to,references:row.thread_refs,disableFileAccess:true,disableUrlAccess:true});
  status=Array.isArray(info.accepted)&&info.accepted.length>0?'sent':'failed';
 }catch(e){status=['EAUTH','EENVELOPE','EDNS','ECONNECTION'].includes(e.code)?'failed':'unknown';}
 finally{transport.close();}
 const update=await ctx.db.from('outreach_inbox_mail').update({status,error_code:status==='sent'?null:status==='unknown'?'smtp_outcome_unknown':'smtp_rejected'}).eq('id',saved.id).eq('user_id',ctx.uid);
 if(update.error)return {status:'unknown',warning:'The send result could not be saved. Do not resend until you check the inbox.'};
 let historySaved=true;if(status==='sent')historySaved=await legacyLog(ctx,{...saved,status});
 return {status,historySaved};
}
module.exports={context,result,problem,checked,channel,sender,address,email,publicIP,mailHost,references,activity,legacyLog,sendReply};
