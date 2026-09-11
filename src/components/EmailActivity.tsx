import DOMPurify from 'dompurify';
import React, { useEffect, useRef, useState } from 'react';
import { Mail, RefreshCw, Send, Search, X, ChevronDown } from 'lucide-react';
import { supabase } from '../lib/supabase';

type Message = { activity_id:string; channel_id:string|null; campaign_id:string; lead_name:string; campaign_name:string; direction:'inbound'|'outbound'; status:string; subject:string; body_text:string; body_html:string; from_email:string; to_email:string; message_id:string|null; created_at:string; source:string; error_code?:string };
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
export function EmailActivity({theme}:{theme:string}) {
  const [rows,setRows]=useState<Message[]>([]),[boxes,setBoxes]=useState<Mailbox[]>([]);
  const [direction,setDirection]=useState(''),[box,setBox]=useState(''),[campaign,setCampaign]=useState(''),[search,setSearch]=useState(''),[query,setQuery]=useState('');
  const [campaigns,setCampaigns]=useState<{id:string;offer:string;name:string}[]>([]);
  const [loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [more,setMore]=useState(false),[snapshot,setSnapshot]=useState('');
  const [selected,setSelected]=useState<Message|null>(null),[detailLoading,setDetailLoading]=useState(false);
  const [draft,setDraft]=useState(''),[sending,setSending]=useState(false),[sendLocked,setSendLocked]=useState(false);
  const [syncing,setSyncing]=useState(false),[syncProgress,setSyncProgress]=useState('');
  const [preview,setPreview]=useState(false);
  const [backendReady,setBackendReady]=useState(false);
  const directHistory=useRef<Message[]>([]);
  const generation=useRef(0),detailGeneration=useRef(0),stopSync=useRef(false),sendGuard=useRef(false);
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
      collect(()=>supabase.from('channels').select('id,name,sender_id,is_active').eq('user_id',user.id).eq('channel_type','email').order('id'))
    ]);
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
        const mailbox=mailboxes.find(m=>m.id===h.channel_id);
        const inbound=h.from_role==='lead';
        const body=String(h.message||h.email_body||'');
        messages.push({activity_id:'history:'+h.id,channel_id:mailbox?.id||null,campaign_id:c.id,
          lead_name:lead?.name||lead?.email||'Unknown prospect',campaign_name:c.offer||c.name||'',
          direction:inbound?'inbound':'outbound',status:inbound?'received':'sent',subject:h.email_subject||h.subject||'',
          body_text:body,body_html:/<[a-z][\s\S]*>/i.test(body)?body:'',
          from_email:inbound?(lead?.email||''):(mailbox?.sender_id||''),
          to_email:inbound?(mailbox?.sender_id||''):(lead?.email||''),message_id:h.email_message_id||null,
          created_at:h.timestamp,source:'history'});
      }
    }
    messages.sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)||a.activity_id.localeCompare(b.activity_id));
    setBoxes(mailboxes);setCampaigns(owned);directHistory.current=messages;
  }
  useEffect(()=>{let current=true;
    api('inbox-api?channels=1').then(result=>{if(current){setBackendReady(true);setBoxes(result.channels);}}).catch(()=>{if(current)setBackendReady(false);});
    return()=>{current=false;stopSync.current=true;};
  },[]);
  async function load(append=false){
    const ticket=++generation.current;setLoading(true);setError('');
    try{
      const params=new URLSearchParams({direction,channel:box,campaign,search:query,offset:String(append?rows.length:0)});
      if(append&&snapshot)params.set('snapshot',snapshot);
      let result;
      if(backendReady){
        result=await api('inbox-api?'+params);
      }else{
        if(!append)await readHistory();
        const needle=query.trim().toLowerCase();
        const filtered=directHistory.current.filter(m=>(!direction||m.direction===direction)&&(!box||m.channel_id===box)&&(!campaign||m.campaign_id===campaign)&&(!needle||[m.lead_name,m.subject,m.from_email,m.to_email,m.body_text].join(' ').toLowerCase().includes(needle)));
        const offset=append?rows.length:0;
        result={messages:filtered.slice(offset,offset+50),more:filtered.length>offset+50,snapshot:''};
      }
      if(ticket!==generation.current)return;
      setRows(old=>append?[...old,...result.messages]:result.messages);setMore(result.more);setSnapshot(result.snapshot);
    }catch(e){if(ticket===generation.current)setError((e as Error).message);}
    finally{if(ticket===generation.current)setLoading(false);}
  }
  useEffect(()=>{load();},[direction,box,campaign,query,backendReady]);
  // Refresh only the list; never overwrite an open draft or automatically send anything.
  useEffect(()=>{const timer=setInterval(()=>{if(!selected&&!loading&&!syncing&&document.visibilityState==='visible')load();},30000);return()=>clearInterval(timer);},[selected,loading,syncing,direction,box,campaign,query]);
  async function open(row:Message){
    if(sending)return;
    if(draft.trim() && selected?.activity_id!==row.activity_id && !window.confirm('Discard this unsent draft?'))return;
    const ticket=++detailGeneration.current;setSelected(row);setDraft('');setPreview(false);setDetailLoading(true);setSendLocked(false);setNotice('');
    if(!backendReady){setDetailLoading(false);return;}
    try{const result=await api('inbox-api?id='+encodeURIComponent(row.activity_id));if(ticket===detailGeneration.current)setSelected(result.message);}
    catch(e){if(ticket===detailGeneration.current){setError((e as Error).message);setSendLocked(true);}}
    finally{if(ticket===detailGeneration.current)setDetailLoading(false);}
  }
  async function sync(){
    stopSync.current=false;setSyncing(true);setError('');setNotice('');let imported=0,remaining=0;const failures:string[]=[];
    const selectedBoxes=box?boxes.filter(b=>b.id===box):boxes;
    for(let i=0;i<selectedBoxes.length&&!stopSync.current;i++){
      const mailbox=selectedBoxes[i];setSyncProgress(`${i+1}/${selectedBoxes.length}: ${mailbox.sender_id}`);
      try{const result=await api('inbox-sync',{channel_id:mailbox.id});imported+=result.imported;if(result.more)remaining++;if(result.historyFailures)failures.push(mailbox.sender_id+': workflow history could not be updated');}
      catch(e){failures.push(mailbox.sender_id+': '+(e as Error).message);}
    }
    setSyncing(false);setSyncProgress('');setNotice(`Imported ${imported} replies.${remaining?` ${remaining} inboxes have more mail to scan. Click Sync replies again to continue.`:''}`);
    if(failures.length)setError(failures.join('\n'));await load();
  }
  async function send(){
    if(!selected||!draft.trim()||sendGuard.current)return;
    sendGuard.current=true;setSending(true);setError('');setNotice('');
    const key='outreach-reply:'+selected.activity_id;
    try{
      // Keep the same key after a lost response so a second click cannot send a duplicate.
      let id=localStorage.getItem(key);if(!id){id=crypto.randomUUID();localStorage.setItem(key,id);}
      const result=await api('inbox-api',{activity_id:selected.activity_id,text:draft,request_id:id});
      if(result.status==='sent'){
        setNotice('Reply accepted by the mail server.'+(result.historySaved===false?' Workflow history could not be updated; the reply is saved in Email Activity.':''));
        setDraft('');localStorage.removeItem(key);setSendLocked(true);await load();
      }else{setSendLocked(true);setNotice(result.status==='failed'?'The mail server rejected this reply. Check Email Activity before trying again.':'The send result is not confirmed. Check the inbox before resending; no automatic retry was made.');}
    }catch(e){setError((e as Error).message+' Your draft is preserved.');}
    finally{sendGuard.current=false;setSending(false);}
  }
  const senderBox=selected?boxes.find(b=>b.id===selected.channel_id):undefined;
  const senderAddress=senderBox?.sender_id || (selected?.direction==='inbound'?selected.to_email:selected?.from_email)||'';
  const recipient=selected?.direction==='inbound'?selected.from_email:selected?.to_email;
  const canReply=backendReady && selected && ['sent','received'].includes(selected.status) && selected.channel_id && selected.message_id && senderBox?.is_active;
  const previewDoc=selected?`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; form-action 'none'; base-uri 'none'"><style>body{font:15px/1.6 Arial,sans-serif;color:#111;background:white;padding:18px;overflow-wrap:anywhere}img{display:none}</style></head><body>${DOMPurify.sanitize(selected.body_html||'', {ALLOWED_TAGS:['p','br','div','span','b','strong','em','i','ul','ol','li','blockquote','table','tbody','tr','td','th','h1','h2','h3'],ALLOWED_ATTR:['style','colspan','rowspan'],ALLOW_DATA_ATTR:false})}</body></html>`:'';
  return <div className={`space-y-4 ${gold?'text-gray-100':'text-gray-900'}`}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-semibold">Email activity</h2><p className={`text-sm ${muted}`}>Sent messages, prospect replies, and your conversations.</p></div>
      <div className="flex gap-2"><button className={field} onClick={()=>load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading?'animate-spin':''}`} /><span className="sr-only">Refresh activity</span></button><button className={button} onClick={sync} disabled={!backendReady||syncing||!boxes.length} title={backendReady?'Import replies from webmail':'Webmail sync needs server configuration'}><RefreshCw className="h-4 w-4"/>Sync replies</button></div>
    </div>
    <div className="flex flex-wrap gap-2">
      <select aria-label="Message direction" className={field} value={direction} onChange={e=>setDirection(e.target.value)}><option value="">All email activity</option><option value="outbound">Sent emails</option><option value="inbound">Lead replies</option></select>
      <select aria-label="Sender inbox" className={`${field} max-w-full`} value={box} onChange={e=>setBox(e.target.value)}><option value="">All sender inboxes</option>{boxes.map(b=><option key={b.id} value={b.id}>{b.sender_id}{b.is_active?'':' (inactive)'}</option>)}</select>
      <select aria-label="Campaign" className={field} value={campaign} onChange={e=>setCampaign(e.target.value)}><option value="">All campaigns</option>{campaigns.map(c=><option key={c.id} value={c.id}>{c.offer||c.name}</option>)}</select>
      <div className="relative flex-1 min-w-48"><Search className={`absolute top-3 left-3 h-4 w-4 ${muted}`}/><input className={`${field} pl-9 w-full`} aria-label="Search email activity" placeholder="Search prospect, subject, or address" value={search} onChange={e=>setSearch(e.target.value)}/></div>
    </div>
    {syncing&&<div role="status" className={`text-sm ${muted}`}>Syncing {syncProgress} <button className="underline ml-2" onClick={()=>{stopSync.current=true;}}>Stop after this inbox</button></div>}
    {error&&<div role="alert" className="p-3 rounded-lg bg-red-50 text-red-800 text-sm whitespace-pre-wrap">{error}</div>}
    {notice&&<div role="status" className="p-3 rounded-lg bg-blue-50 text-blue-800 text-sm">{notice}</div>}
    <div className={`grid ${selected?'lg:grid-cols-2':''} rounded-lg border ${border} overflow-hidden`}>
      <div className={`min-w-0 ${selected?'lg:border-r '+border:''}`}>
        {rows.length===0?<div className={`p-10 text-center ${muted}`}><Mail className="h-9 w-9 mx-auto mb-3"/>{loading?'Loading email activity…':'No emails match this view.'}<p className="text-sm mt-2">Emails appear here when your workflow records them in conversation history.</p></div>:
        <div className="max-h-[680px] overflow-y-auto">{rows.map(row=><button key={row.activity_id} className={`w-full text-left p-4 border-b ${border} ${selected?.activity_id===row.activity_id?(gold?'bg-yellow-400/10':'bg-blue-50'):(gold?'hover:bg-white/5':'hover:bg-gray-50')}`} onClick={()=>open(row)} disabled={sending}>
          <div className="flex justify-between gap-3"><span className="font-medium truncate">{row.lead_name}</span><span className={`text-xs shrink-0 ${muted}`}>{date(row.created_at)}</span></div>
          <div className="flex items-center gap-2 my-1"><span className={`text-xs px-2 py-0.5 rounded-full ${row.direction==='inbound'?'bg-green-100 text-green-800':row.status==='sent'?'bg-blue-100 text-blue-800':'bg-amber-100 text-amber-800'}`}>{row.direction==='inbound'?'Reply received':row.status==='sent'?(row.source==='manual'?'Your reply sent':'Sent · logged'):row.status==='sending'?'Send pending':row.status==='unknown'?'Needs review':'Send failed'}</span><span className={`text-xs truncate ${muted}`}>{row.direction==='inbound'?row.to_email:row.from_email || 'Sender not recorded'}</span></div>
          <p className="text-sm font-medium truncate">{row.subject||'(No subject)'}</p><p className={`text-sm truncate ${muted}`}>{plain(row.body_text)}</p><p className={`text-xs mt-1 ${muted}`}>{row.campaign_name}</p>
        </button>)}</div>}
        {more&&<button onClick={()=>load(true)} disabled={loading} className={`p-3 w-full text-sm flex items-center justify-center gap-2 ${muted}`}><ChevronDown className="h-4 w-4"/>{loading?'Loading…':'Load older emails'}</button>}
      </div>
      {selected&&<section aria-label="Email conversation" className="min-w-0 p-4 space-y-4">
        <div className="flex items-start justify-between gap-3"><h3 className="font-semibold break-words">{selected.subject||'(No subject)'}</h3><button aria-label="Close email" disabled={sending} onClick={()=>{if(!draft.trim()||window.confirm('Discard this unsent draft?')){detailGeneration.current++;setSelected(null);setDraft('');}}}><X className="h-5 w-5"/></button></div>
        <dl className={`text-xs space-y-1 break-all ${muted}`}><div>From: {selected.from_email||'Not recorded'}</div><div>To: {selected.to_email||'Not recorded'}</div><div>{date(selected.created_at)} · {selected.campaign_name}</div></dl>
        {detailLoading?<p className={muted}>Loading message…</p>:<>
          {selected.body_html&&/<[a-z]/i.test(selected.body_html)&&<button className={`text-xs underline ${muted}`} onClick={()=>setPreview(!preview)}>{preview?'Show plain text':'Show email layout (remote images blocked)'}</button>}
          {preview?<iframe title="Email layout preview" sandbox="" referrerPolicy="no-referrer" srcDoc={previewDoc} className="w-full h-80 rounded border bg-white"/>:<div className={`text-sm whitespace-pre-wrap break-words max-h-80 overflow-y-auto p-3 rounded-lg ${gold?'bg-white/5':'bg-gray-50'}`}>{plain(selected.body_text)||plain(selected.body_html)||'No body was recorded for this email.'}</div>}
          <div className={`border-t ${border} pt-4 space-y-3`}>
            <h4 className="font-medium text-sm">Reply to this conversation</h4>
            <p className={`text-xs break-all ${muted}`}>From: <strong>{senderAddress||'Original sender unavailable'}</strong><br/>To: {recipient}</p>
            {!canReply&&<p className="text-sm text-amber-600">{!backendReady?'Viewing history is connected. Sending replies and importing webmail require the email server configuration.':!selected.channel_id?'This older record has no sender link. Sync replies from the original inbox to identify the sender.':!selected.message_id?'Sync this conversation first; its email thread ID is missing.':!senderBox?.is_active?'The original sender is inactive. Review that inbox before replying.':'Review this send result before replying.'}</p>}
            <textarea aria-label="Your reply" placeholder="Write your reply…" className={`${field} w-full min-h-36 resize-y`} maxLength={20000} value={draft} onChange={e=>setDraft(e.target.value)} disabled={!canReply||sending||sendLocked}/>
            <button className={button} onClick={send} disabled={!canReply||!draft.trim()||sending||sendLocked}><Send className="h-4 w-4"/>{sending?'Sending…':'Send reply'}</button>
          </div>
        </>}
      </section>}
    </div>
    <p className={`text-xs ${muted}`}>{backendReady?'Reply sync reads the original connected inboxes and matches campaign conversations. Initial sync covers the last 14 days.':'Showing email history recorded by your workflow, using your existing login. Webmail-only replies are not imported yet. Sending and Sync replies need server configuration.'}</p>
  </div>;
}
