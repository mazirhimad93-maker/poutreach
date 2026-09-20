const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const core = require('./lib/inbox-core.cjs');

function ids(parsed){
  return [...new Set([
    parsed.inReplyTo,
    ...(Array.isArray(parsed.references)?parsed.references:[parsed.references])
  ].filter(v=>typeof v==='string' && /^<[^<>\\s]+@[^<>\\s]+>$/.test(v)))].slice(-30);
}

function isWarmup(parsed){
  const subject=String(parsed.subject||'');
  const text=String(parsed.text||'');
  const combined=subject+'\n'+text;

  // Known warm-up fingerprint visible in the master inbox.
  if(/\\bJWEFBSA\\b/i.test(combined)) return true;

  // Typical warm-up subjects carry a pipe plus a synthetic token pair.
  if(/\\|\\s*[A-Z0-9]{6,12}\\s+[A-Z]{5,12}\\s*$/i.test(subject)) return true;

  return false;
}

function isReply(parsed){
  return /^\\s*re\\s*:/i.test(String(parsed.subject||''));
}

function addresses(field){
  if(!field?.value || !Array.isArray(field.value)) return [];
  return field.value.map(v=>core.address(v.address)).filter(core.email);
}

async function match(ctx,parsed,allowedChannelIds){
  const refs=ids(parsed);

  // 1) Strongest match: thread Message-ID / References.
  if(refs.length){
    const rows=await core.checked(
      ctx.db.from('outreach_inbox_activity')
        .select('lead_id,campaign_id,channel_id,to_email,from_email')
        .eq('user_id',ctx.uid)
        .eq('direction','outbound')
        .eq('status','sent')
        .in('channel_id',allowedChannelIds)
        .in('message_id',refs)
        .limit(100)
    );
    const unique=new Map(rows.map(r=>[r.lead_id+':'+r.campaign_id,r]));
    if(unique.size===1) return [...unique.values()][0];
  }

  // 2) Match the person who replied to a known outbound recipient.
  const from=core.address(parsed.from?.value?.[0]?.address);
  if(!core.email(from)) return null;

  const outbound=await core.checked(
    ctx.db.from('outreach_inbox_activity')
      .select('lead_id,campaign_id,channel_id,to_email,from_email,created_at')
      .eq('user_id',ctx.uid)
      .eq('direction','outbound')
      .eq('status','sent')
      .in('channel_id',allowedChannelIds)
      .ilike('to_email',from)
      .order('created_at',{ascending:false})
      .limit(250)
  );
  if(!outbound.length) return null;

  // If forwarding preserved the original recipient, prefer that sender inbox.
  const originalRecipients=[...addresses(parsed.to),...addresses(parsed.cc)];
  if(originalRecipients.length){
    const channelIds=[...new Set(outbound.map(x=>x.channel_id).filter(Boolean))];
    if(channelIds.length){
      const channels=await core.checked(
        ctx.db.from('channels').select('id,sender_id')
          .eq('user_id',ctx.uid)
          .in('id',channelIds)
      );
      const senderMap=new Map(channels.map(ch=>[ch.id,core.address(ch.sender_id)]));
      const exact=outbound.filter(r=>originalRecipients.includes(senderMap.get(r.channel_id)));
      const exactUnique=new Map(exact.map(r=>[r.lead_id+':'+r.campaign_id,r]));
      if(exactUnique.size===1) return [...exactUnique.values()][0];
    }
  }

  // Otherwise only accept a unique lead+campaign match.
  const unique=new Map(outbound.map(r=>[r.lead_id+':'+r.campaign_id,r]));
  return unique.size===1?[...unique.values()][0]:null;
}

exports.handler=async event=>{
  let client;
  try{
    if(event.httpMethod!=='POST') return core.result(405,{error:'Method not allowed'});
    const ctx=await core.context(event);

    const host=process.env.MASTER_IMAP_HOST;
    const username=process.env.MASTER_IMAP_USERNAME;
    const password=process.env.MASTER_IMAP_PASSWORD;
    const port=Number(process.env.MASTER_IMAP_PORT||993);

    if(!host||!username||!password) throw core.problem(503,'Master inbox IMAP configuration is missing.');
    if(port!==993) throw core.problem(400,'Master inbox must use secure IMAP port 993.');

    const resolved=await core.mailHost(host);
    client=new ImapFlow({
      host:resolved.host,port:993,secure:true,
      tls:{servername:resolved.servername,rejectUnauthorized:true},
      auth:{user:username,pass:password},
      logger:false,connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000
    });

    await client.connect();
    await client.mailboxOpen('INBOX',{readOnly:true});

    // Only use active non-Gmail email channels for reply import/matching.
    const allowedChannels=await core.checked(
      ctx.db.from('channels')
        .select('id,provider,channel_type,is_active')
        .eq('user_id',ctx.uid)
        .eq('channel_type','email')
        .eq('is_active',true)
        .neq('provider','gmail')
        .limit(2000)
    );
    const allowedChannelIds=allowedChannels.map(ch=>ch.id).filter(Boolean);
    if(!allowedChannelIds.length){
      return core.result(200,{imported:0,warmups:0,unmatched:0,skipped:0,historyFailures:0,more:false,scanned:0});
    }

    // Build the known prospect set from actual outbound email history.
    const known=await core.checked(
      ctx.db.from('outreach_inbox_activity')
        .select('to_email')
        .eq('user_id',ctx.uid)
        .eq('direction','outbound')
        .eq('status','sent')
        .in('channel_id',allowedChannelIds)
        .order('created_at',{ascending:false})
        .limit(5000)
    );
    const prospects=[...new Set(known.map(r=>core.address(r.to_email)).filter(core.email))];
    if(!prospects.length) return core.result(200,{imported:0,warmups:0,unmatched:0,skipped:0,historyFailures:0,more:false,scanned:0});

    // Search only recent mail from people we actually contacted.
    // This avoids scanning tens of thousands of SiteGround warm-up messages.
    const sinceDays=Math.max(1,Math.min(Number(process.env.MASTER_IMAP_LOOKBACK_DAYS||30),90));
    const search={since:new Date(Date.now()-sinceDays*86400000)};
    if(prospects.length===1) search.from=prospects[0];
    else search.or=prospects.slice(0,1000).map(from=>({from}));

    const found=(await client.search(search,{uid:true})||[]).sort((a,b)=>b-a);
    const selected=found.slice(0,150);

    let imported=0,warmups=0,unmatched=0,skipped=0,historyFailures=0;
    const started=Date.now();

    for(const uid of selected){
      if(Date.now()-started>20000) break;

      const meta=await client.fetchOne(String(uid),{size:true},{uid:true});
      if(!meta){skipped++;continue;}
      if(meta.size>1500000){skipped++;continue;}

      const message=await client.fetchOne(String(uid),{source:true},{uid:true});
      if(!message?.source){skipped++;continue;}

      const parsed=await simpleParser(message.source,{skipImageLinks:true});

      if(!isReply(parsed)){skipped++;continue;}
      if(isWarmup(parsed)){warmups++;continue;}

      const matched=await match(ctx,parsed,allowedChannelIds);
      if(!matched){unmatched++;continue;}

      const from=core.address(parsed.from?.value?.[0]?.address);
      if(!core.email(from)){skipped++;continue;}

      const ch=matched.channel_id
        ? await core.checked(ctx.db.from('channels').select('id,sender_id').eq('id',matched.channel_id).eq('user_id',ctx.uid).maybeSingle())
        : null;

      const row={
        user_id:ctx.uid,
        channel_id:matched.channel_id,
        lead_id:matched.lead_id,
        campaign_id:matched.campaign_id,
        direction:'inbound',
        status:'received',
        subject:String(parsed.subject||'').slice(0,500),
        body_text:String(parsed.text||'').slice(0,100000),
        body_html:typeof parsed.html==='string'?parsed.html.slice(0,200000):'',
        from_email:from,
        to_email:core.address(ch?.sender_id)||addresses(parsed.to)[0]||core.address(username),
        message_id:parsed.messageId||null,
        in_reply_to:parsed.inReplyTo||null,
        thread_refs:ids(parsed),
        source_key:'master-imap:'+(parsed.messageId||String(uid)),
        created_at:parsed.date&&Number.isFinite(parsed.date.getTime())?parsed.date.toISOString():new Date().toISOString()
      };

      if(!row.channel_id){unmatched++;continue;}

      const saved=await ctx.db.from('outreach_inbox_mail')
        .upsert(row,{onConflict:'user_id,source_key',ignoreDuplicates:true})
        .select('*');

      if(saved.error) throw core.problem(503,'Could not save imported reply.');

      if(saved.data?.[0]){
        imported++;
        if(!await core.legacyLog(ctx,saved.data[0])) historyFailures++;
      }
    }

    return core.result(200,{
      imported,warmups,unmatched,skipped,historyFailures,
      more:found.length>selected.length,
      scanned:selected.length
    });
  }catch(e){
    return core.result(e.status||502,{error:e.status?e.message:'Could not sync the master inbox.'});
  }finally{
    if(client) try{await client.logout();}catch{client.close();}
  }
};

exports.match=match;
exports.isWarmup=isWarmup;
