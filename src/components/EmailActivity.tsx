import DOMPurify from 'dompurify';
import React, { useEffect, useRef, useState } from 'react';
import { Mail, RefreshCw, Send, Search, X, ChevronDown, Paperclip } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { RichEmailComposer } from './RichEmailComposer';

type Message = { activity_id:string; history_id?:string; channel_id:string|null; campaign_id:string; lead_id?:string; lead_name:string; campaign_name:string; direction:'inbound'|'outbound'; status:string; subject:string; body_text:string; body_html:string; from_email:string; to_email:string; message_id:string|null; in_reply_to?:string|null; references?:string; attachments?:Array<{filename:string;contentType?:string;size?:number}>; created_at:string; source:string; error_code?:string };
type Mailbox = {id:string; name:string; sender_id:string; is_active:boolean};
const plain = (text:string) => {
  if (!/<\/?(?:p|div|br|html|body|table|img|a|span)\b/i.test(text)) return text;
  // Detached parsing only: no remote images or tracking pixels are attached to the page.
  const document = new DOMParser().parseFromString(DOMPurify.sanitize(text, {ALLOWED_TAGS:['p','br','div','span','b','strong','em','i','ul','ol','li','blockquote'],ALLOWED_ATTR:[]}), 'text/html');
  document.querySelectorAll('script,style,img,iframe,object').forEach(n => n.remove());
  document.querySelectorAll('br').forEach(n => n.replaceWith('\n'));
  document.querySelectorAll('p,div').forEach(n => n.append('\n\n'));
  return document.body.textContent?.trim() || '';
};
const date = (value:string) => new Date(value).toLocaleString();
const filePayload = (file:File) => new Promise<{filename:string;contentType:string;contentBase64:string}>((resolve,reject)=>{
  const reader=new FileReader();
  reader.onerror=()=>reject(new Error('Could not read attachment '+file.name));
  reader.onload=()=>{
    const value=String(reader.result||'');
    const comma=value.indexOf(',');
    if(comma<0)return reject(new Error('Could not encode attachment '+file.name));
    resolve({filename:file.name,contentType:file.type||'application/octet-stream',contentBase64:value.slice(comma+1)});
  };
  reader.readAsDataURL(file);
});
export function EmailActivity({theme,initialDirection='',replyableOnly=false}:{theme:string;initialDirection?:'inbound'|'outbound'|'';replyableOnly?:boolean}) {
  const [rows,setRows]=useState<Message[]>([]),[boxes,setBoxes]=useState<Mailbox[]>([]);
  const [direction,setDirection]=useState(initialDirection),[box,setBox]=useState(''),[campaign,setCampaign]=useState(''),[search,setSearch]=useState(''),[query,setQuery]=useState('');
  const [campaigns,setCampaigns]=useState<{id:string;offer:string;name:string}[]>([]);
  const [loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [more,setMore]=useState(false),[snapshot,setSnapshot]=useState(''),[total,setTotal]=useState(0);
  const [backendError,setBackendError]=useState('');
  const [selected,setSelected]=useState<Message|null>(null),[thread,setThread]=useState<Message[]>([]),[detailLoading,setDetailLoading]=useState(false);
  const [draftHtml,setDraftHtml]=useState(''),[attachments,setAttachments]=useState<File[]>([]),[sending,setSending]=useState(false),[sendLocked,setSendLocked]=useState(false);
  const [syncing,setSyncing]=useState(false),[syncProgress,setSyncProgress]=useState('');
  const [preview,setPreview]=useState(false);
  const [backendReady,setBackendReady]=useState(false);
  const directHistory=useRef<Message[]>([]);
  const threadRef=useRef<HTMLDivElement>(null);
  const generation=useRef(0),detailGeneration=useRef(0),stopSync=useRef(false),sendGuard=useRef(false),autoSync=useRef(false);
  const gold=theme==='gold';
  const border=gold?'border-yellow-400/20':'border-gray-200';
  const muted=gold?'text-gray-400':'text-gray-500';
  const field=`rounded-lg border px-3 py-2 text-sm ${gold?'border-yellow-400/30 bg-black/30 text-gray-100':'border-gray-300 bg-white text-gray-900'}`;
  const button=`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50 ${gold?'bg-yellow-400 text-black':'bg-blue-600 text-white'}`;
  async function api(path:string,body?:unknown){
    const {data}=await supabase.auth.getSession();
    if(!data.session)throw new Error('Please sign in again.');
    const response=await fetch('/.netlify/functions/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+data.session.access_token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    let result;try{result=await response.json();}catch{throw new Error('The email service is not available. Check the deployment.');}
    if(!response.ok)throw new Error(result.error||'Email request failed.');return result;
  }
  useEffect(()=>{const t=setTimeout(()=>setQuery(search),350);return()=>clearTimeout(t);},[search]);
  async function readHistory(){
    const {data:{user},error:authError}=await supabase.auth.getUser();
    if(authError||!user)throw new Error('Please sign in again.');
    async function collect(makeQuery:()=>any){
      const all:any[]=[];
      for(let start=0;;start+=500){
        const {data,error}=await makeQuery().range(start,start+499);
        if(error)throw new Error(error.message);
        all.push(...(data||[]));if(!data||data.length<500)break;
      }
      return all;
    }
    const [owned,mailboxes]=await Promise.all([
      collect(()=>supabase.from('campaigns').select('id,offer,name').eq('user_id',user.id).order('id')),
      collect(()=>supabase.from('channels').select('id,name,sender_id,is_active,provider,credentials').eq('user_id',user.id).eq('channel_type','email').order('id'))
    ]);
    const usableMailboxes=mailboxes.filter((m:any)=>{
      const provider=String(m.provider||'').toLowerCase();
      const sender=String(m.sender_id||'').toLowerCase();
      const name=String(m.name||'').toLowerCase();
      const emailProvider=String(m.credentials?.email_provider||'').toLowerCase();
      return !(provider==='gmail'||emailProvider==='gmail'||sender.endsWith('@gmail.com')||name.includes('gmail'));
    });
    const messages:Message[]=[];
    for(const c of owned){
      const history=await collect(()=>supabase.from('conversation_history').select('*').eq('campaign_id',c.id).eq('channel','email').order('timestamp',{ascending:false}).order('id'));
      const leadIds=[...new Set(history.map(h=>h.lead_id).filter(Boolean))];
      const leads:any[]=[];
      for(let n=0;n<leadIds.length;n+=100){
        const ids=leadIds.slice(n,n+100);
        leads.push(...await collect(()=>supabase.from('uploaded_leads').select('id,name,email').eq('user_id',user.id).in('id',ids).order('id')));
      }
      const leadMap=new Map(leads.map(l=>[l.id,l]));
      for(const h of history){
        if(!['ai','lead'].includes(h.from_role))continue;
        const lead=leadMap.get(h.lead_id);
        const mailbox=usableMailboxes.find((m:any)=>m.id===h.channel_id);
        if(replyableOnly && (!mailbox || !h.email_message_id)) continue;
        const inbound=h.from_role==='lead';
        const body=String(h.message||h.email_body||'');
        messages.push({activity_id:'history:'+h.id,channel_id:mailbox?.id||null,campaign_id:c.id,
          lead_name:lead?.name||lead?.email||'Unknown prospect',campaign_name:c.offer||c.name||'',
          direction:inbound?'inbound':'outbound',status:inbound?'received':'sent',subject:h.email_subject||h.subject||'',
          body_text:body,body_html:String(h.email_body_html||(/<[a-z][\s\S]*>/i.test(body)?body:'')),
          from_email:h.email_from||(inbound?(lead?.email||''):(mailbox?.sender_id||'')),
          to_email:h.email_to||(inbound?(mailbox?.sender_id||''):(lead?.email||'')),message_id:h.email_message_id||null,
          in_reply_to:h.email_in_reply_to||null,references:h.email_references||'',attachments:Array.isArray(h.email_attachments)?h.email_attachments:[],
          lead_id:h.lead_id,created_at:h.timestamp,source:h.message_type==='manual_reply'?'manual':'history'});
      }
    }
    messages.sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)||a.activity_id.localeCompare(b.activity_id));
    setBoxes(usableMailboxes);setCampaigns(owned);directHistory.current=messages;
  }
  useEffect(()=>{let current=true;
    api('inbox-api?channels=1')
      .then(result=>{if(current){setBackendReady(true);setBackendError('');setBoxes(result.channels);}})
      .catch(e=>{if(current){setBackendReady(false);setBackendError((e as Error).message);}});
    return()=>{current=false;stopSync.current=true;};
  },[]);
  async function load(append=false){
    const ticket=++generation.current;setLoading(true);setError('');
    try{
      const params=new URLSearchParams({direction,channel:box,campaign,search:query,offset:String(append?rows.length:0)});
      if(append&&snapshot)params.set('snapshot',snapshot);
      if(replyableOnly)params.set('replyable','1');
      let result;
      if(backendReady){
        result=await api('inbox-api?'+params);
      }else{
        if(!append)await readHistory();
        const needle=query.trim().toLowerCase();
        const filtered=directHistory.current.filter(m=>(!direction||m.direction===direction)&&(!box||m.channel_id===box)&&(!campaign||m.campaign_id===campaign)&&(!needle||[m.lead_name,m.subject,m.from_email,m.to_email,m.body_text].join(' ').toLowerCase().includes(needle)));
        const offset=append?rows.length:0;
        result={messages:filtered.slice(offset,offset+50),more:filtered.length>offset+50,snapshot:'',total:filtered.length};
      }
      if(ticket!==generation.current)return;
      setRows(old=>append?[...old,...result.messages]:result.messages);setMore(result.more);setSnapshot(result.snapshot);setTotal(Number(result.total||0));
    }catch(e){if(ticket===generation.current)setError((e as Error).message);}
    finally{if(ticket===generation.current)setLoading(false);}
  }
  useEffect(()=>{load();},[direction,box,campaign,query,backendReady,replyableOnly]);
  useEffect(()=>{
    if(replyableOnly&&!autoSync.current){
      autoSync.current=true;
      sync();
    }
  },[replyableOnly]);
  // Refresh only the list; never overwrite an open draft or automatically send anything.
  useEffect(()=>{const timer=setInterval(()=>{if(!selected&&!loading&&!syncing&&document.visibilityState==='visible')load();},30000);return()=>clearInterval(timer);},[selected,loading,syncing,direction,box,campaign,query]);
  useEffect(()=>{
    const node=threadRef.current;
    if(node)node.scrollTop=node.scrollHeight;
  },[thread.length,selected?.activity_id]);
  async function open(row:Message){
    if(sending)return;
    if((hasDraftContent()||attachments.length) && selected?.activity_id!==row.activity_id && !window.confirm('Discard this unsent draft?'))return;
    const ticket=++detailGeneration.current;setSelected(row);setThread([row]);setDraftHtml('');setAttachments([]);setPreview(false);setDetailLoading(true);setSendLocked(false);setNotice('');
    if(!backendReady){setDetailLoading(false);return;}
    try{
      const result=await api('inbox-api?id='+encodeURIComponent(row.activity_id));
      if(ticket===detailGeneration.current){
        setSelected(result.message);
        setThread(Array.isArray(result.thread)&&result.thread.length?result.thread:[result.message]);
      }
    }
    catch(e){if(ticket===detailGeneration.current){setError((e as Error).message);}}
    finally{if(ticket===detailGeneration.current)setDetailLoading(false);}
  }
  const hasDraftContent=()=>Boolean(plain(draftHtml).trim()||/<img\b/i.test(draftHtml));

  async function sync(){
    stopSync.current=false;setSyncing(true);setError('');setNotice('');setSyncProgress('Master inbox');
    try{
      const result=await api('master-inbox-sync',{});
      const folders=(result.folders||[]).map((f:any)=>`${f.folder}: ${f.imported||0}`).join(' · ');
      setNotice(
        `Imported ${result.imported||0} real replies. Ignored ${result.warmups||0} warm-up emails. ${result.unmatched||0} replies could not be matched.`+
        (folders?` Folders: ${folders}.`:'')+
        (result.more?' More mail remains; click Sync replies again.':'')
      );
      if(result.historyFailures){
        setError(`${result.historyFailures} replies were imported but could not be copied to conversation history.`);
      }
      await load();
      if(selected){
        const detail=await api('inbox-api?id='+encodeURIComponent(selected.activity_id));
        setSelected(detail.message);
        setThread(Array.isArray(detail.thread)&&detail.thread.length?detail.thread:[detail.message]);
      }
    }catch(e){
      setError((e as Error).message);
    }finally{
      setSyncing(false);setSyncProgress('');
    }
  }
  async function send(){
    const draftText=plain(draftHtml).trim();
    if(!selected||(!hasDraftContent()&&!attachments.length)||sendGuard.current)return;
    sendGuard.current=true;setSending(true);setError('');setNotice('');
    const key='outreach-reply:'+selected.activity_id;
    try{
      const totalAttachmentBytes=attachments.reduce((sum,file)=>sum+file.size,0);
      if(attachments.length>5)throw new Error('Attach up to 5 files per reply.');
      if(totalAttachmentBytes>3000000)throw new Error('Attachments must be 3 MB total or less.');
      const attachmentPayloads=await Promise.all(attachments.map(filePayload));
      const cleanHtml=DOMPurify.sanitize(draftHtml,{
        ALLOWED_TAGS:['p','br','div','span','b','strong','em','i','u','font','ul','ol','li','blockquote','a','img'],
        ALLOWED_ATTR:['style','href','target','rel','src','alt','face','size'],
        ALLOW_DATA_ATTR:false,
      });

      let id=localStorage.getItem(key);if(!id){id=crypto.randomUUID();localStorage.setItem(key,id);}
      const result=await api('inbox-api',{activity_id:selected.activity_id,text:draftText,html:cleanHtml,attachments:attachmentPayloads,request_id:id});
      if(result.status==='sent'){
        setNotice('Reply sent from '+(result.from||senderAddress)+'.');
        setDraftHtml('');setAttachments([]);localStorage.removeItem(key);setSendLocked(false);
        const detailId=result.activityId||selected.activity_id;
        const detail=await api('inbox-api?id='+encodeURIComponent(detailId));
        setSelected(detail.message);
        setThread(Array.isArray(detail.thread)&&detail.thread.length?detail.thread:[detail.message]);
        await load();
      }else{
        setSendLocked(true);
        setNotice(result.status==='failed'?'The mail server rejected this reply. Check Email Activity before trying again.':'The send result is not confirmed. Check the inbox before resending; no automatic retry was made.');
      }
    }catch(e){setError((e as Error).message+' Your draft is preserved.');}
    finally{sendGuard.current=false;setSending(false);}
  }
  const senderBox=selected?boxes.find(b=>b.id===selected.channel_id):undefined;
  const senderAddress=senderBox?.sender_id || (selected?.direction==='inbound'?selected.to_email:selected?.from_email)||'';
  const recipient=selected?.direction==='inbound'?selected.from_email:selected?.to_email;
  const canReply=Boolean(selected && ['sent','received'].includes(selected.status) && selected.channel_id && selected.message_id && senderBox?.is_active);
  const conversation=thread.length?thread:(selected?[selected]:[]);
  const safeMessageHtml=(value:string)=>DOMPurify.sanitize(value||'',{
    ALLOWED_TAGS:['p','br','div','span','b','strong','em','i','u','font','ul','ol','li','blockquote','a','img','table','tbody','tr','td','th','h1','h2','h3'],
    ALLOWED_ATTR:['style','href','target','rel','src','alt','face','size','colspan','rowspan'],
    ALLOW_DATA_ATTR:false,
  }).replace(/<img\b[^>]*\bsrc=(["'])https?:\/\/[^"']*\1[^>]*>/gi,'');
  return <div className={`w-full min-w-0 max-w-full overflow-x-hidden space-y-4 ${gold?'text-gray-100':'text-gray-900'}`}>
    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0"><h2 className="text-lg font-semibold">{replyableOnly?'Lead replies':'Email activity'}{backendReady&&<span className={`ml-2 text-sm font-normal ${muted}`}>({total.toLocaleString()})</span>}</h2><p className={`text-sm ${muted}`}>{replyableOnly?'Real replies imported from your connected inboxes. Reply from the original sender address.':'Sent messages, prospect replies, and your conversations.'}</p></div>
      <div className="flex shrink-0 gap-2"><button className={field} onClick={()=>load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading?'animate-spin':''}`} /><span className="sr-only">Refresh activity</span></button><button className={button} onClick={sync} disabled={syncing} title="Import real replies from the master Inbox, Replies, Junk and Spam folders"><RefreshCw className="h-4 w-4"/>Sync replies</button></div>
    </div>
    <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,180px)_minmax(0,260px)_minmax(0,220px)_minmax(240px,1fr)]">
      <select aria-label="Message direction" className={`${field} w-full min-w-0`} value={direction} onChange={e=>setDirection(e.target.value)}><option value="">All email activity</option><option value="outbound">Sent emails</option><option value="inbound">Lead replies</option></select>
      <select aria-label="Sender inbox" className={`${field} w-full min-w-0 max-w-full`} value={box} onChange={e=>setBox(e.target.value)}><option value="">All sender inboxes</option>{boxes.map(b=><option key={b.id} value={b.id}>{b.sender_id}{b.is_active?'':' (inactive)'}</option>)}</select>
      <select aria-label="Campaign" className={`${field} w-full min-w-0`} value={campaign} onChange={e=>setCampaign(e.target.value)}><option value="">All campaigns</option>{campaigns.map(c=><option key={c.id} value={c.id}>{c.offer||c.name}</option>)}</select>
      <div className="relative min-w-0 w-full"><Search className={`absolute top-3 left-3 h-4 w-4 ${muted}`}/><input className={`${field} pl-9 w-full`} aria-label="Search email activity" placeholder="Search prospect, subject, or address" value={search} onChange={e=>setSearch(e.target.value)}/></div>
    </div>
    {syncing&&<div role="status" className={`text-sm ${muted}`}>Syncing {syncProgress} <button className="underline ml-2" onClick={()=>{stopSync.current=true;}}>Stop after this inbox</button></div>}
    {!backendReady&&backendError&&<div role="alert" className="p-3 rounded-lg bg-amber-50 text-amber-800 text-sm whitespace-pre-wrap">{backendError}</div>}
    {error&&<div role="alert" className="p-3 rounded-lg bg-red-50 text-red-800 text-sm whitespace-pre-wrap">{error}</div>}
    {notice&&<div role="status" className="p-3 rounded-lg bg-blue-50 text-blue-800 text-sm">{notice}</div>}
    <div className={`grid w-full min-w-0 max-w-full grid-cols-1 ${selected?'2xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]':''} rounded-lg border ${border} overflow-hidden`}>
      <div className={`min-w-0 max-w-full overflow-hidden ${selected?'2xl:border-r '+border:''}`}>
        {rows.length===0?<div className={`p-10 text-center ${muted}`}><Mail className="h-9 w-9 mx-auto mb-3"/>{loading?'Loading email activity…':'No emails match this view.'}<p className="text-sm mt-2">Emails appear here when your workflow records them in conversation history.</p></div>:
        <div className="max-h-[min(680px,calc(100vh-320px))] min-h-[360px] overflow-y-auto overflow-x-hidden">{rows.map(row=><button key={row.activity_id} className={`w-full text-left p-4 border-b ${border} ${selected?.activity_id===row.activity_id?(gold?'bg-yellow-400/10':'bg-blue-50'):(gold?'hover:bg-white/5':'hover:bg-gray-50')}`} onClick={()=>open(row)} disabled={sending}>
          <div className="flex min-w-0 items-start justify-between gap-3"><span className="min-w-0 font-medium truncate">{row.lead_name}</span><span className={`text-xs shrink-0 ${muted}`}>{date(row.created_at)}</span></div>
          <div className="flex min-w-0 items-center gap-2 my-1"><span className={`text-xs px-2 py-0.5 rounded-full ${row.direction==='inbound'?'bg-green-100 text-green-800':row.status==='sent'?'bg-blue-100 text-blue-800':'bg-amber-100 text-amber-800'}`}>{row.direction==='inbound'?'Reply received':row.status==='sent'?(row.source==='manual'?'Your reply sent':'Sent · logged'):row.status==='sending'?'Send pending':row.status==='unknown'?'Needs review':'Send failed'}</span><span className={`text-xs truncate ${muted}`}>{row.direction==='inbound'?row.to_email:row.from_email || 'Sender not recorded'}</span></div>
          <p className="text-sm font-medium truncate">{row.subject||'(No subject)'}</p><p className={`text-sm truncate ${muted}`}>{plain(row.body_text)}</p><p className={`text-xs mt-1 ${muted}`}>{row.campaign_name}</p>
        </button>)}</div>}
        {more&&<button onClick={()=>load(true)} disabled={loading} className={`p-3 w-full text-sm flex items-center justify-center gap-2 ${muted}`}><ChevronDown className="h-4 w-4"/>{loading?'Loading…':'Load older emails'}</button>}
      </div>
      {selected&&<section aria-label="Email conversation" className="min-w-0 max-w-full overflow-hidden p-3 sm:p-4 space-y-4">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="min-w-0 font-semibold break-words [overflow-wrap:anywhere]">{selected.subject||'(No subject)'}</h3>
            <p className={`mt-1 text-xs ${muted}`}>{selected.lead_name} · {selected.campaign_name}</p>
          </div>
          <button aria-label="Close email" disabled={sending} onClick={()=>{
            if((!hasDraftContent()&&!attachments.length)||window.confirm('Discard this unsent draft?')){
              detailGeneration.current++;setSelected(null);setThread([]);setDraftHtml('');setAttachments([]);
            }
          }}><X className="h-5 w-5"/></button>
        </div>

        {detailLoading?<p className={muted}>Loading conversation…</p>:<>
          <div ref={threadRef} className={`max-h-[440px] space-y-3 overflow-y-auto rounded-xl border p-3 ${border} ${gold?'bg-black/10':'bg-gray-50/60'}`}>
            {conversation.map((message,index)=>(
              <article key={message.activity_id||index} className={`rounded-xl border p-3 sm:p-4 ${message.direction==='outbound'?(gold?'border-yellow-400/20 bg-yellow-400/5':'border-blue-200 bg-blue-50'):(gold?'border-white/10 bg-white/5':'border-gray-200 bg-white')}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-medium">{message.direction==='outbound'?'You':'Prospect'}</div>
                    <div className={`text-xs break-all ${muted}`}>{message.from_email} → {message.to_email}</div>
                  </div>
                  <div className={`shrink-0 text-xs ${muted}`}>{date(message.created_at)}</div>
                </div>
                {message.body_html&&/<[a-z]/i.test(message.body_html)
                  ? <div className="mt-3 text-sm leading-6 break-words [overflow-wrap:anywhere]" dangerouslySetInnerHTML={{__html:safeMessageHtml(message.body_html)}}/>
                  : <div className="mt-3 whitespace-pre-wrap text-sm leading-6 break-words [overflow-wrap:anywhere]">{plain(message.body_text)||'No body was recorded for this email.'}</div>}
                {!!message.attachments?.length&&<div className="mt-3 flex flex-wrap gap-2">
                  {message.attachments.map((file,index)=><span key={file.filename+index} className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs ${gold?'bg-white/10':'bg-gray-100'}`}><Paperclip className="h-3 w-3"/>{file.filename}</span>)}
                </div>}
              </article>
            ))}
          </div>

          <div className={`border-t ${border} pt-4 space-y-3`}>
            <h4 className="font-medium text-sm">Reply to this conversation</h4>
            <p className={`text-xs break-all ${muted}`}>From: <strong>{senderAddress||'Original sender unavailable'}</strong><br/>To: {recipient}</p>
            {!canReply&&<p className="text-sm text-amber-600">{!backendReady?((backendError||'Email server configuration is incomplete.')+' You can draft here now; sending activates when the server configuration is connected.'):!selected.channel_id?'This conversation has no sender link yet. Sync replies to identify the original inbox.':!selected.message_id?'This conversation is missing its email thread ID.':!senderBox?.is_active?'The original sender is inactive. Review that inbox before replying.':'Review this send result before replying.'}</p>}
            <RichEmailComposer
              theme={theme}
              html={draftHtml}
              onHtmlChange={setDraftHtml}
              attachments={attachments}
              onAttachmentsChange={setAttachments}
              disabled={sending||sendLocked}
              onError={setError}
            />
            <div className="flex items-center justify-between gap-3">
              <span className={`text-xs ${muted}`}>Formatting, inline images, links and attachments are preserved in the sent reply.</span>
              <button className={button} onClick={send} disabled={!canReply||(!hasDraftContent()&&!attachments.length)||sending||sendLocked}><Send className="h-4 w-4"/>{sending?'Sending…':'Send reply'}</button>
            </div>
          </div>
        </>}
      </section>}
    </div>
    <p className={`text-xs ${muted}`}>Reply sync checks the master Replies, Inbox, Junk and Spam folders. Replies are sent from the original sender inbox, never from the master inbox.</p>
  </div>;
}
