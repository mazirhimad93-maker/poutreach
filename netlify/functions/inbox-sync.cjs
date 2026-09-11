const {ImapFlow}=require('imapflow');
const {simpleParser}=require('mailparser');
const core=require('./lib/inbox-core.cjs');
function ids(parsed){return [...new Set([parsed.inReplyTo,...(Array.isArray(parsed.references)?parsed.references:[parsed.references])].filter(v=>typeof v==='string' && /^<[^<>\s]+@[^<>\s]+>$/.test(v)))].slice(-30);}
async function match(ctx,ch,parsed){
 const refs=ids(parsed);
 let matches=[];
 if(refs.length)matches=await core.checked(ctx.db.from('outreach_inbox_activity').select('lead_id,campaign_id,channel_id').eq('user_id',ctx.uid).eq('channel_id',ch.id).eq('direction','outbound').eq('status','sent').in('message_id',refs).limit(100));
 if(!matches.length){
  const from=core.address(parsed.from?.value?.[0]?.address);
  if(!core.email(from))return null;
  matches=await core.checked(ctx.db.from('outreach_inbox_activity').select('lead_id,campaign_id,channel_id').eq('user_id',ctx.uid).eq('channel_id',ch.id).eq('direction','outbound').eq('status','sent').ilike('to_email',from).limit(100));
 }
 const unique=new Map(matches.map(m=>[m.lead_id+':'+m.campaign_id,m]));
 return unique.size===1?[...unique.values()][0]:null;
}
exports.handler=async event=>{
 let client;
 try{
  if(event.httpMethod!=='POST')return core.result(405,{error:'Method not allowed'});
  const ctx=await core.context(event);
  let input;try{input=JSON.parse(event.body||'{}');}catch{throw core.problem(400,'Invalid request.');}
  const ch=await core.channel(ctx,input.channel_id);const c=ch.credentials||{};
  if(!c.imap_host||!c.imap_username||!c.imap_password)throw core.problem(409,'This inbox needs its IMAP connection settings.');
  if(Number(c.imap_port||993)!==993)throw core.problem(409,'This importer requires secure IMAP on port 993.');
  const resolved=await core.mailHost(c.imap_host);
  client=new ImapFlow({host:resolved.host,port:993,secure:true,tls:{servername:resolved.servername,rejectUnauthorized:true},auth:{user:c.imap_username,pass:c.imap_password},logger:false,connectionTimeout:7000,greetingTimeout:7000,socketTimeout:10000});
  await client.connect();const box=await client.mailboxOpen('INBOX',{readOnly:true});
  const state=await core.checked(ctx.db.from('outreach_inbox_sync').select('*').eq('user_id',ctx.uid).eq('channel_id',ch.id).maybeSingle());
  const validity=String(box.uidValidity);
  const last=state?.uid_validity===validity?Number(state.last_uid):0;
  const known=await core.checked(ctx.db.from('outreach_inbox_activity').select('to_email').eq('user_id',ctx.uid).eq('channel_id',ch.id).eq('direction','outbound').eq('status','sent').order('created_at',{ascending:false}).limit(1000));
  const prospects=[...new Set(known.map(r=>core.address(r.to_email)).filter(core.email))];
  if(!prospects.length)return core.result(200,{imported:0,skipped:0,historyFailures:0,more:false,scanned:0});
  const search=last?{uid:`${last+1}:*`}:{since:new Date(Date.now()-14*86400000)};
  if(prospects.length===1)search.from=prospects[0];else search.or=prospects.map(from=>({from}));
  const found=(await client.search(search,{uid:true})||[]).filter(v=>v>last).sort((a,b)=>a-b);
  const selected=found.slice(0,20);let imported=0,skipped=0,historyFailures=0,lastUid=last;
  const started=Date.now();
  for(const uid of selected){
   if(Date.now()-started>12000)break;
   const meta=await client.fetchOne(String(uid),{size:true},{uid:true});
   if(!meta){lastUid=uid;continue;}
   if(meta.size>1000000){skipped++;lastUid=uid;continue;}
   const message=await client.fetchOne(String(uid),{source:true},{uid:true});
   if(!message?.source){skipped++;lastUid=uid;continue;}
   const parsed=await simpleParser(message.source,{skipImageLinks:true});
   const matched=await match(ctx,ch,parsed);
   if(!matched){skipped++;lastUid=uid;continue;}
   const from=core.address(parsed.from?.value?.[0]?.address);
   if(!core.email(from)||from===core.sender(ch)){skipped++;lastUid=uid;continue;}
   const row={user_id:ctx.uid,channel_id:ch.id,lead_id:matched.lead_id,campaign_id:matched.campaign_id,direction:'inbound',status:'received',subject:String(parsed.subject||'').slice(0,500),body_text:String(parsed.text||'').slice(0,100000),body_html:typeof parsed.html==='string'?parsed.html.slice(0,200000):'',from_email:from,to_email:core.sender(ch),message_id:parsed.messageId||null,in_reply_to:parsed.inReplyTo||null,thread_refs:ids(parsed),source_key:'imap:'+ch.id+':'+(parsed.messageId||validity+':'+uid),created_at:parsed.date && Number.isFinite(parsed.date.getTime())?parsed.date.toISOString():new Date().toISOString()};
   const saved=await ctx.db.from('outreach_inbox_mail').upsert(row,{onConflict:'user_id,source_key',ignoreDuplicates:true}).select('*');
   if(saved.error)throw core.problem(503,'Could not save imported replies. Sync can be retried without duplicating saved messages.');
   if(saved.data?.[0]){imported++;if(!await core.legacyLog(ctx,saved.data[0]))historyFailures++;}
   lastUid=uid;
  }
  // Never overwrite a newer cursor from a concurrent sync with an older one.
  if(state && state.uid_validity===validity){
   await core.checked(ctx.db.from('outreach_inbox_sync').update({last_uid:lastUid,updated_at:new Date().toISOString()}).eq('user_id',ctx.uid).eq('channel_id',ch.id).eq('last_uid',state.last_uid).eq('uid_validity',validity));
  }else{
   await core.checked(ctx.db.from('outreach_inbox_sync').upsert({user_id:ctx.uid,channel_id:ch.id,uid_validity:validity,last_uid:lastUid,updated_at:new Date().toISOString()}));
  }
  return core.result(200,{imported,skipped,historyFailures,more:found.some(uid=>uid>lastUid),scanned:found.filter(uid=>uid<=lastUid).length});
 }catch(e){return core.result(e.status||502,{error:e.status?e.message:'Could not sync this inbox. Check its IMAP settings and try again.'});}
 finally{if(client)try{await client.logout();}catch{client.close();}}
};
exports.match=match;
