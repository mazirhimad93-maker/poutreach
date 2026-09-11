const core=require('./lib/inbox-core.cjs');
exports.handler=async event=>{
 try{
  if(!['GET','POST'].includes(event.httpMethod))return core.result(405,{error:'Method not allowed'});
  const ctx=await core.context(event);
  if(event.httpMethod==='POST'){
   if(Buffer.byteLength(event.body||'')>30000)throw core.problem(413,'Reply is too large.');
   let body;try{body=JSON.parse(event.body||'{}');}catch{throw core.problem(400,'Invalid request.');}
   return core.result(200,await core.sendReply(ctx,body));
  }
  const p=event.queryStringParameters||{};
  if(p.id)return core.result(200,{message:await core.activity(ctx,p.id)});
  if(p.channels==='1'){
   const rows=await core.checked(ctx.db.from('channels').select('id,name,sender_id,is_active').eq('user_id',ctx.uid).eq('channel_type','email').order('sender_id').limit(1000));
   return core.result(200,{channels:rows});
  }
  const offset=Math.max(0,Math.min(Number(p.offset)||0,1000000));
  const snapshot=p.snapshot && Number.isFinite(Date.parse(p.snapshot))?new Date(p.snapshot).toISOString():new Date().toISOString();
  let q=ctx.db.from('outreach_inbox_activity').select('*').eq('user_id',ctx.uid).lte('created_at',snapshot);
  if(p.direction==='inbound'||p.direction==='outbound')q=q.eq('direction',p.direction);
  if(p.channel)q=q.eq('channel_id',p.channel);
  if(p.campaign)q=q.eq('campaign_id',p.campaign);
  if(p.search){const term=p.search.replace(/[^\p{L}\p{N}@. +_-]/gu,'').slice(0,100);if(term)q=q.or(['subject','lead_name','from_email','to_email'].map(k=>`${k}.ilike.%${term.replace(/[%_]/g,'')}%`).join(','));}
  const rows=await core.checked(q.order('created_at',{ascending:false}).order('activity_id',{ascending:false}).range(offset,offset+50));
  return core.result(200,{messages:rows.slice(0,50).map(r=>({...r,body_text:r.body_text.slice(0,350),body_html:''})),more:rows.length>50,snapshot});
 }catch(e){return core.result(e.status||500,{error:e.status?e.message:'Inbox request failed. No automatic send retry was performed.'});}
};
