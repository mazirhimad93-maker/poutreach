-- Separate physical inbox allocation from the account-visible channel counters.
create schema if not exists outreach_private;
revoke all on schema outreach_private from public, anon, authenticated;
grant usage on schema outreach_private to service_role;

create table outreach_private.shared_email_mailboxes (
  mailbox_key text primary key,
  daily_limit integer not null default 10 check (daily_limit = 10),
  last_reserved_at timestamptz,
  created_at timestamptz not null default now()
);
create table outreach_private.shared_email_channel_links (
  channel_id uuid primary key references public.channels(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  mailbox_key text not null references outreach_private.shared_email_mailboxes(mailbox_key),
  daily_limit integer not null default 5 check (daily_limit = 5),
  unique (mailbox_key,user_id)
);
create table outreach_private.shared_email_daily_usage (
  mailbox_key text not null references outreach_private.shared_email_mailboxes(mailbox_key),
  user_id uuid not null references public.users(id) on delete cascade,
  usage_date date not null,
  sends integer not null default 0 check (sends between 0 and 5),
  primary key (mailbox_key,user_id,usage_date)
);
alter table outreach_private.shared_email_mailboxes enable row level security;
alter table outreach_private.shared_email_channel_links enable row level security;
alter table outreach_private.shared_email_daily_usage enable row level security;
revoke all on all tables in schema outreach_private from public, anon, authenticated;
grant select,insert,update,delete on all tables in schema outreach_private to service_role;

create function outreach_private.can_reserve_shared_email(p_channel_id uuid,p_cooldown_seconds integer)
returns boolean language sql stable security invoker set search_path = ''
as $$
  select not exists (
    select 1
    from outreach_private.shared_email_channel_links l
    join outreach_private.shared_email_mailboxes m using (mailbox_key)
    where l.channel_id = p_channel_id
      and (
        coalesce((select d.sends from outreach_private.shared_email_daily_usage d
                  where d.mailbox_key=l.mailbox_key and d.user_id=l.user_id
                    and d.usage_date=(now() at time zone 'UTC')::date),0) >= l.daily_limit
        or coalesce((select sum(d.sends) from outreach_private.shared_email_daily_usage d
                     where d.mailbox_key=l.mailbox_key
                       and d.usage_date=(now() at time zone 'UTC')::date),0) >= m.daily_limit
        or m.last_reserved_at > now() - make_interval(secs=>greatest(0,coalesce(p_cooldown_seconds,900)))
      )
  );
$$;

create function outreach_private.reserve_shared_email(
  p_channel_id uuid,p_cooldown_seconds integer,p_manual_reply boolean default false)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_link outreach_private.shared_email_channel_links%rowtype;
  v_mailbox outreach_private.shared_email_mailboxes%rowtype;
  v_date date := (now() at time zone 'UTC')::date;
  v_used integer;
  v_total integer;
  v_next_midnight timestamptz :=
    ((date_trunc('day',now() at time zone 'UTC') + interval '1 day') at time zone 'UTC');
  v_cooldown integer := greatest(0,coalesce(p_cooldown_seconds,900));
begin
  select * into v_link from outreach_private.shared_email_channel_links
    where channel_id=p_channel_id;
  if not found then return jsonb_build_object('available',true); end if;

  -- Serialize both accounts without locking the other account's channel.
  select * into v_mailbox from outreach_private.shared_email_mailboxes
    where mailbox_key=v_link.mailbox_key for update;
  if not found then
    return jsonb_build_object('available',false,'skip_reason','shared_email_mailbox_missing',
                             'retry_at',now()+interval '1 hour');
  end if;
  if not coalesce(p_manual_reply,false) then
    select coalesce(sum(sends) filter (where user_id=v_link.user_id),0),coalesce(sum(sends),0)
      into v_used,v_total from outreach_private.shared_email_daily_usage
      where mailbox_key=v_link.mailbox_key and usage_date=v_date;
    if v_used >= v_link.daily_limit then
      return jsonb_build_object('available',false,'skip_reason','shared_email_account_daily_cap',
                               'retry_at',v_next_midnight);
    end if;
    if v_total >= v_mailbox.daily_limit then
      return jsonb_build_object('available',false,'skip_reason','shared_email_total_daily_cap',
                               'retry_at',v_next_midnight);
    end if;
    if v_mailbox.last_reserved_at > now()-make_interval(secs=>v_cooldown) then
      return jsonb_build_object('available',false,'skip_reason','shared_email_mailbox_cooling_down',
                               'retry_at',v_mailbox.last_reserved_at+make_interval(secs=>v_cooldown));
    end if;
    insert into outreach_private.shared_email_daily_usage(mailbox_key,user_id,usage_date,sends)
      values(v_link.mailbox_key,v_link.user_id,v_date,1)
      on conflict (mailbox_key,user_id,usage_date)
      do update set sends=outreach_private.shared_email_daily_usage.sends+1;
  end if;
  update outreach_private.shared_email_mailboxes set last_reserved_at=now()
    where mailbox_key=v_link.mailbox_key;
  return jsonb_build_object('available',true);
end;
$$;
revoke all on function outreach_private.can_reserve_shared_email(uuid,integer) from public, anon, authenticated;
revoke all on function outreach_private.reserve_shared_email(uuid,integer,boolean) from public, anon, authenticated;
grant execute on function outreach_private.can_reserve_shared_email(uuid,integer) to service_role;
grant execute on function outreach_private.reserve_shared_email(uuid,integer,boolean) to service_role;

CREATE OR REPLACE FUNCTION public.enforce_level5_daily_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if lower(coalesce(new.provider,'')) = 'smtp'
     and lower(coalesce(new.channel_type,'')) = 'email'
     and lower(split_part(coalesce(new.sender_id,''),'@',2)) like '%level5%.shop'
  then
    new.max_usage := 5;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.outreach_email_reservation_before_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_progress public.lead_sequence_progress%rowtype;
  v_channel public.channels%rowtype;
  v_locked_id uuid;
  v_history_locked_id uuid;
  v_shared_result jsonb;
  v_manual_reply boolean := false;
  v_cooldown integer := greatest(30, least(coalesce(new.cooldown_seconds, 900), 86400));
  v_next_midnight timestamptz :=
    ((date_trunc('day', now() at time zone 'UTC') + interval '1 day') at time zone 'UTC');
  v_warm_campaign constant uuid := '1317e852-9bc7-4447-9c7a-802f1789be75'::uuid;
begin
  if new.id is null then new.id := gen_random_uuid(); end if;

  select * into v_progress
  from public.lead_sequence_progress p
  where p.id = new.progress_id
  for update;

  if not found then
    new.available := false; new.skip_reason := 'progress_not_found';
    new.retry_at := now() + interval '15 minutes'; return new;
  end if;

  if v_progress.status <> 'running' then
    new.available := false; new.skip_reason := 'progress_not_running';
    new.retry_at := now() + interval '15 minutes'; return new;
  end if;

  if new.claim_token is null
     or coalesce(v_progress.decision->>'claim_token','') <> new.claim_token::text then
    new.available := false; new.skip_reason := 'claim_token_mismatch';
    new.retry_at := now() + interval '15 minutes'; return new;
  end if;

  if v_progress.next_at is null or v_progress.next_at <= now() then
    new.available := false; new.skip_reason := 'claim_lease_expired';
    new.retry_at := now() + interval '1 minute'; return new;
  end if;

  v_manual_reply := lower(coalesce(v_progress.decision->>'manual_direct_reply','false')) = 'true';

  select h.channel_id into v_history_locked_id
  from public.conversation_history h
  where h.lead_id = v_progress.lead_id
    and h.channel = 'email'
    and h.from_role = 'ai'
    and h.channel_id is not null
    and (
      v_progress.campaign_id = v_warm_campaign
      or h.campaign_id = v_progress.campaign_id
    )
  order by coalesce(h.created_at,h."timestamp") desc nulls last,h.id desc
  limit 1;

  -- Manual replies are different from cold follow-ups:
  -- the explicitly locked inbox on the reply request is authoritative.
  if v_manual_reply then
    v_locked_id := v_progress.channel_id;
  else
    v_locked_id := coalesce(v_history_locked_id, v_progress.channel_id);
  end if;

  if v_locked_id is not null then
    select * into v_channel
    from public.channels c
    where c.id = v_locked_id
      and c.user_id = v_progress.user_id
      and c.channel_type = 'email'
    for update;

    if not found then
      new.available := false;
      new.channel_id := v_locked_id;
      new.skip_reason := 'historical_email_channel_missing_no_sender_swap';
      new.retry_at := now() + interval '1 hour';
      return new;
    end if;

    if not v_manual_reply and v_progress.channel_id is distinct from v_channel.id then
      update public.lead_sequence_progress p
      set channel_id = v_channel.id
      where p.id = v_progress.id;
      v_progress.channel_id := v_channel.id;
    end if;

    if coalesce(v_channel.is_active,false) is false then
      new.available := false; new.channel_id := v_channel.id;
      new.skip_reason := 'locked_email_channel_inactive_no_sender_swap';
      new.retry_at := now() + interval '1 hour'; return new;
    end if;

    if not v_manual_reply
       and coalesce(v_channel.usage_count,0) >= greatest(coalesce(v_channel.max_usage,0),0) then
      new.available := false; new.channel_id := v_channel.id;
      new.skip_reason := 'locked_email_channel_daily_cap_no_sender_swap';
      new.retry_at := v_next_midnight; return new;
    end if;

    if not v_manual_reply
       and v_channel.last_used_at is not null
       and v_channel.last_used_at > now() - make_interval(secs => v_cooldown) then
      new.available := false; new.channel_id := v_channel.id;
      new.skip_reason := 'locked_email_channel_cooling_down';
      new.retry_at := v_channel.last_used_at + make_interval(secs => v_cooldown);
      return new;
    end if;
  else
    if v_manual_reply then
      new.available := false;
      new.skip_reason := 'manual_reply_missing_locked_channel';
      new.retry_at := now() + interval '15 minutes';
      return new;
    end if;

    select * into v_channel
    from public.channels c
    where c.user_id = v_progress.user_id
      and c.channel_type = 'email'
      and coalesce(c.is_active,false) = true
      and coalesce(c.usage_count,0) < greatest(coalesce(c.max_usage,0),0)
      and (c.last_used_at is null or c.last_used_at <= now() - make_interval(secs => v_cooldown))
      and outreach_private.can_reserve_shared_email(c.id, v_cooldown)
      and coalesce(
        nullif(c.credentials->>'smtp_username',''),
        nullif(c.credentials->>'smtp_user',''),
        nullif(c.email_address,'')
      ) is not null
      and coalesce(
        nullif(c.credentials->>'smtp_password',''),
        nullif(c.credentials->>'smtp_pass','')
      ) is not null
      and (
        (v_progress.campaign_id = 'd585c61d-2387-44c2-9adb-fe5d932b40dd'::uuid
          and lower(coalesce(nullif(c.email_address,''),nullif(c.credentials->>'email_address',''),nullif(c.credentials->>'smtp_username',''),c.credentials->>'smtp_user','')) like 'francisco@%')
        or
        (v_progress.campaign_id <> 'd585c61d-2387-44c2-9adb-fe5d932b40dd'::uuid
          and (v_progress.user_id <> 'cdc6a64a-50e8-4519-9a55-3f16c13ab759'::uuid
            or lower(coalesce(nullif(c.email_address,''),nullif(c.credentials->>'email_address',''),nullif(c.credentials->>'smtp_username',''),c.credentials->>'smtp_user','')) not like 'francisco@%'))
      )
    order by
      (coalesce(c.usage_count,0)::numeric / greatest(coalesce(c.max_usage,1),1)) asc,
      c.last_used_at asc nulls first,
      c.id
    for update skip locked
    limit 1;

    if not found then
      new.available := false;
      new.skip_reason := case
        when v_progress.campaign_id = 'd585c61d-2387-44c2-9adb-fe5d932b40dd'::uuid
          then 'no_working_francisco_email_channel_for_youtube_campaign'
        when v_progress.user_id = 'cdc6a64a-50e8-4519-9a55-3f16c13ab759'::uuid
          then 'no_non_francisco_email_channel_available_for_campaign'
        else 'no_email_channel_currently_available'
      end;
      new.retry_at := now() + interval '15 minutes';
      return new;
    end if;
  end if;

  if coalesce(nullif(v_channel.credentials->>'smtp_username',''),nullif(v_channel.credentials->>'smtp_user',''),nullif(v_channel.email_address,'')) is null
     or coalesce(nullif(v_channel.credentials->>'smtp_password',''),nullif(v_channel.credentials->>'smtp_pass','')) is null then
    new.available := false; new.channel_id := v_channel.id;
    new.skip_reason := 'locked_email_channel_missing_smtp_no_sender_swap';
    new.retry_at := now() + interval '1 hour'; return new;
  end if;

  v_shared_result := outreach_private.reserve_shared_email(v_channel.id, v_cooldown, v_manual_reply);
  if not coalesce((v_shared_result->>'available')::boolean,false) then
    new.available := false;
    new.channel_id := v_channel.id;
    new.skip_reason := v_shared_result->>'skip_reason';
    new.retry_at := (v_shared_result->>'retry_at')::timestamptz;
    return new;
  end if;

  update public.channels c
  set usage_count = case when v_manual_reply then coalesce(c.usage_count,0)
                         else coalesce(c.usage_count,0) + 1 end,
      last_used_at = now(),
      updated_at = now()
  where c.id = v_channel.id
  returning * into v_channel;

  new.available := true;
  new.channel_id := v_channel.id;
  new.skip_reason := null;
  new.retry_at := null;
  new.reserved_at := v_channel.last_used_at;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.outreach_reserve_email_channel(p_progress_id uuid, p_claim_token uuid, p_cooldown_seconds integer DEFAULT 900)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_progress public.lead_sequence_progress%rowtype;
  v_channel public.channels%rowtype;
  v_locked_id uuid;
  v_shared_result jsonb;
  v_cooldown integer := greatest(30, least(coalesce(p_cooldown_seconds, 900), 86400));
  v_retry_at timestamptz;
  v_claim_text text;
  v_lease_text text;
  v_creds jsonb;
  v_from text;
  v_smtp_user text;
  v_smtp_pass text;
  v_sender_name text;
  v_next_midnight timestamptz :=
    ((date_trunc('day', now() at time zone 'UTC') + interval '1 day') at time zone 'UTC');
begin
  select * into v_progress
  from public.lead_sequence_progress p
  where p.id = p_progress_id
  for update;

  if not found then
    return jsonb_build_object('email_channel_available', false,'shouldEmail', false,'email_skip_reason', 'progress_not_found','email_retry_at', now() + interval '15 minutes');
  end if;

  if v_progress.status <> 'running' then
    return jsonb_build_object('email_channel_available', false,'shouldEmail', false,'email_skip_reason', 'progress_not_running','email_retry_at', now() + interval '15 minutes');
  end if;

  v_claim_text := coalesce(v_progress.decision->>'claim_token', '');
  if v_claim_text = '' or v_claim_text <> p_claim_token::text then
    return jsonb_build_object('email_channel_available', false,'shouldEmail', false,'email_skip_reason', 'claim_token_mismatch','email_retry_at', now() + interval '15 minutes');
  end if;

  v_lease_text := nullif(v_progress.decision->>'lease_until', '');
  if v_lease_text is not null and v_lease_text::timestamptz < now() then
    return jsonb_build_object('email_channel_available', false,'shouldEmail', false,'email_skip_reason', 'claim_lease_expired','email_retry_at', now() + interval '1 minute');
  end if;

  v_locked_id := v_progress.channel_id;

  if v_locked_id is null then
    select h.channel_id into v_locked_id
    from public.conversation_history h
    where h.lead_id = v_progress.lead_id
      and h.campaign_id = v_progress.campaign_id
      and h.channel = 'email'
      and h.from_role = 'ai'
      and h.channel_id is not null
    order by coalesce(h.created_at, h."timestamp") desc nulls last
    limit 1;
  end if;

  if v_locked_id is not null then
    select * into v_channel
    from public.channels c
    where c.id = v_locked_id
      and c.user_id = v_progress.user_id
      and c.channel_type = 'email'
    for update;

    if not found then
      return jsonb_build_object('email_channel_available', false,'shouldEmail', false,'email_skip_reason', 'locked_email_channel_not_available_no_sender_swap','email_channel_id', v_locked_id,'locked_email_channel_id', v_locked_id,'email_retry_at', now() + interval '30 minutes');
    end if;

    if coalesce(v_channel.is_active, false) is false then
      return jsonb_build_object('email_channel_available', false,'shouldEmail', false,'email_skip_reason', 'locked_email_channel_inactive_no_sender_swap','email_channel_id', v_locked_id,'locked_email_channel_id', v_locked_id,'email_retry_at', now() + interval '1 hour');
    end if;

    if coalesce(v_channel.usage_count, 0) >= greatest(coalesce(v_channel.max_usage, 0), 0) then
      return jsonb_build_object('email_channel_available', false,'shouldEmail', false,'email_skip_reason', 'locked_email_channel_daily_cap_no_sender_swap','email_channel_id', v_locked_id,'locked_email_channel_id', v_locked_id,'email_retry_at', v_next_midnight);
    end if;

    if v_channel.last_used_at is not null
       and v_channel.last_used_at > now() - make_interval(secs => v_cooldown) then
      v_retry_at := v_channel.last_used_at + make_interval(secs => v_cooldown);
      return jsonb_build_object('email_channel_available', false,'shouldEmail', false,'email_skip_reason', 'locked_email_channel_cooling_down','email_channel_id', v_locked_id,'locked_email_channel_id', v_locked_id,'email_retry_at', v_retry_at);
    end if;
  else
    select * into v_channel
    from public.channels c
    where c.user_id = v_progress.user_id
      and c.channel_type = 'email'
      and coalesce(c.is_active, false) = true
      and coalesce(c.usage_count, 0) < greatest(coalesce(c.max_usage, 0), 0)
      and (c.last_used_at is null or c.last_used_at <= now() - make_interval(secs => v_cooldown))
      and outreach_private.can_reserve_shared_email(c.id, v_cooldown)
      and coalesce(nullif(c.credentials->>'smtp_username', ''), nullif(c.credentials->>'smtp_user', ''), nullif(c.email_address, '')) is not null
      and coalesce(nullif(c.credentials->>'smtp_password', ''), nullif(c.credentials->>'smtp_pass', '')) is not null
    order by
      (coalesce(c.usage_count, 0)::numeric / greatest(coalesce(c.max_usage, 1), 1)) asc,
      c.last_used_at asc nulls first,
      c.id
    for update skip locked
    limit 1;

    if not found then
      select min(
        case
          when coalesce(c.usage_count, 0) >= greatest(coalesce(c.max_usage, 0), 0) then v_next_midnight
          when c.last_used_at is null then now()
          else c.last_used_at + make_interval(secs => v_cooldown)
        end
      )
      into v_retry_at
      from public.channels c
      where c.user_id = v_progress.user_id
        and c.channel_type = 'email'
        and coalesce(c.is_active, false) = true;

      return jsonb_build_object('email_channel_available', false,'shouldEmail', false,'email_skip_reason', 'no_email_channel_currently_available','email_retry_at', coalesce(v_retry_at, now() + interval '15 minutes'));
    end if;
  end if;

  v_creds := coalesce(v_channel.credentials, '{}'::jsonb);
  v_smtp_user := coalesce(nullif(v_creds->>'smtp_username', ''), nullif(v_creds->>'smtp_user', ''), nullif(v_channel.email_address, ''));
  v_smtp_pass := regexp_replace(coalesce(v_creds->>'smtp_password', v_creds->>'smtp_pass', ''), '\s+', '', 'g');
  v_from := coalesce(nullif(v_channel.email_address, ''), nullif(v_creds->>'email_address', ''), v_smtp_user);

  if v_from is null or v_smtp_user is null or v_smtp_pass = '' then
    return jsonb_build_object(
      'email_channel_available', false,'shouldEmail', false,
      'email_skip_reason', case when v_locked_id is not null then 'locked_email_channel_missing_smtp_no_sender_swap' else 'selected_email_channel_missing_smtp' end,
      'email_channel_id', v_channel.id,'locked_email_channel_id', v_channel.id,'email_retry_at', now() + interval '1 hour'
    );
  end if;

  v_shared_result := outreach_private.reserve_shared_email(v_channel.id, v_cooldown, false);
  if not coalesce((v_shared_result->>'available')::boolean,false) then
    return jsonb_build_object(
      'email_channel_available',false,'shouldEmail',false,
      'email_skip_reason',v_shared_result->>'skip_reason',
      'email_channel_id',v_channel.id,'locked_email_channel_id',v_channel.id,
      'email_retry_at',(v_shared_result->>'retry_at')::timestamptz
    );
  end if;

  update public.channels c
  set usage_count = coalesce(c.usage_count, 0) + 1,
      last_used_at = now(),
      updated_at = now()
  where c.id = v_channel.id
  returning * into v_channel;

  update public.lead_sequence_progress p
  set channel_id = v_channel.id,
      decision = (
        case when jsonb_typeof(p.decision) = 'object'
          then p.decision
          else '{}'::jsonb
        end
      ) || jsonb_build_object(
        'reserved_email_channel_id', v_channel.id,
        'reserved_email_at', now()
      )
  where p.id = v_progress.id;

  v_sender_name := nullif(v_channel.sender_name, '');
  if v_sender_name is null then
    v_sender_name := initcap(split_part(split_part(v_from, '@', 1), '.', 1));
  end if;

  return jsonb_build_object(
    'email_channel_available', true,'shouldEmail', true,'email_skip_reason', null,'email_retry_at', null,
    'email_channel_id', v_channel.id,'channel_id', v_channel.id,'locked_email_channel_id', v_channel.id,
    'email_reservation_at', v_channel.last_used_at,
    'sender_first_name', coalesce(nullif(v_sender_name, ''), 'Julian'),
    'sender_name', coalesce(nullif(v_sender_name, ''), 'Julian'),
    'from_email', v_from,'reply_to_email', v_channel.reply_to_email,
    'smtp_host', coalesce(nullif(v_creds->>'smtp_host', ''), 'smtp.gmail.com'),
    'smtp_port', coalesce(nullif(v_creds->>'smtp_port', '')::integer, 587),
    'smtp_secure', coalesce(nullif(v_creds->>'smtp_secure', '')::boolean, false),
    'smtp_user', v_smtp_user,'smtp_pass', v_smtp_pass,
    'email_channel', to_jsonb(v_channel)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.outreach_channel_reservation_before_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_progress public.lead_sequence_progress%rowtype;
  v_channel public.channels%rowtype;
  v_shared_result jsonb;
  v_cooldown integer := greatest(0, least(coalesce(new.cooldown_seconds, 60), 86400));
  v_next_midnight timestamptz :=
    ((date_trunc('day', now() at time zone 'UTC') + interval '1 day') at time zone 'UTC');
begin
  if new.id is null then
    new.id := gen_random_uuid();
  end if;

  select * into v_progress
  from public.lead_sequence_progress p
  where p.id = new.progress_id
  for update;

  if not found then
    new.available := false;
    new.skip_reason := 'progress_not_found';
    new.retry_at := now() + interval '15 minutes';
    return new;
  end if;

  if v_progress.status <> 'running' then
    new.available := false;
    new.skip_reason := 'progress_not_running';
    new.retry_at := now() + interval '15 minutes';
    return new;
  end if;

  if new.user_id is null then
    new.user_id := v_progress.user_id;
  end if;

  if new.user_id is distinct from v_progress.user_id then
    new.available := false;
    new.skip_reason := 'user_mismatch';
    new.retry_at := now() + interval '15 minutes';
    return new;
  end if;

  select * into v_channel
  from public.channels c
  where c.user_id = new.user_id
    and c.channel_type = new.channel_type
    and coalesce(c.is_active,false) = true
    and (new.channel_type <> 'email' or outreach_private.can_reserve_shared_email(c.id, v_cooldown))
    and coalesce(c.usage_count,0) < greatest(coalesce(c.max_usage,0),0)
    and (
      v_cooldown = 0
      or c.last_used_at is null
      or c.last_used_at <= now() - make_interval(secs => v_cooldown)
    )
  order by
    (coalesce(c.usage_count,0)::numeric / greatest(coalesce(c.max_usage,1),1)) asc,
    c.last_used_at asc nulls first,
    c.id
  for update skip locked
  limit 1;

  if not found then
    new.available := false;
    new.skip_reason := 'no_' || new.channel_type || '_channel_currently_available';

    select min(
      case
        when coalesce(c.usage_count,0) >= greatest(coalesce(c.max_usage,0),0)
          then v_next_midnight
        when v_cooldown = 0 or c.last_used_at is null
          then now()
        else c.last_used_at + make_interval(secs => v_cooldown)
      end
    )
    into new.retry_at
    from public.channels c
    where c.user_id = new.user_id
      and c.channel_type = new.channel_type
      and coalesce(c.is_active,false) = true;

    new.retry_at := coalesce(new.retry_at, now() + interval '15 minutes');
    return new;
  end if;

  if new.channel_type = 'email' then
  v_shared_result := outreach_private.reserve_shared_email(v_channel.id, v_cooldown, false);
  if not coalesce((v_shared_result->>'available')::boolean,false) then
    new.available := false;
    new.channel_id := v_channel.id;
    new.skip_reason := v_shared_result->>'skip_reason';
    new.retry_at := (v_shared_result->>'retry_at')::timestamptz;
    return new;
  end if;

  end if;

  update public.channels c
  set usage_count = coalesce(c.usage_count,0) + 1,
      last_used_at = now(),
      updated_at = now()
  where c.id = v_channel.id
  returning * into v_channel;

  new.available := true;
  new.channel_id := v_channel.id;
  new.skip_reason := null;
  new.retry_at := null;
  new.reserved_at := v_channel.last_used_at;
  return new;
end;
$function$;

alter table public.campaigns enable row level security;
alter table public.campaign_sequences enable row level security;
alter table public.campaign_prompts enable row level security;
alter table public.uploaded_leads enable row level security;
alter table public.lead_sequence_progress enable row level security;
alter table public.conversation_history enable row level security;
alter table public.lead_activity_history enable row level security;
alter table public.raw_inbound_email enable row level security;
alter policy "Users can manage sequences for their campaigns" on public.campaign_sequences using ((user_id is null or user_id=(select auth.uid())) and exists(select 1 from public.campaigns c where c.id=campaign_sequences.campaign_id and c.user_id=(select auth.uid()))) with check ((user_id is null or user_id=(select auth.uid())) and exists(select 1 from public.campaigns c where c.id=campaign_sequences.campaign_id and c.user_id=(select auth.uid())));
alter policy "Users can manage sequence progress for their campaigns" on public.lead_sequence_progress using ((user_id is null or user_id=(select auth.uid())) and exists(select 1 from public.campaigns c where c.id=lead_sequence_progress.campaign_id and c.user_id=(select auth.uid())) and exists(select 1 from public.uploaded_leads l where l.id=lead_sequence_progress.lead_id and l.user_id=(select auth.uid()))) with check ((user_id is null or user_id=(select auth.uid())) and exists(select 1 from public.campaigns c where c.id=lead_sequence_progress.campaign_id and c.user_id=(select auth.uid())) and exists(select 1 from public.uploaded_leads l where l.id=lead_sequence_progress.lead_id and l.user_id=(select auth.uid())));
alter policy "Users can view conversation history for their campaigns" on public.conversation_history using (exists(select 1 from public.uploaded_leads l where l.id=conversation_history.lead_id and l.user_id=(select auth.uid())) and (campaign_id is null or exists(select 1 from public.campaigns c where c.id=conversation_history.campaign_id and c.user_id=(select auth.uid()))) and (channel_id is null or exists(select 1 from public.channels c where c.id=conversation_history.channel_id and c.user_id=(select auth.uid())))) with check (exists(select 1 from public.uploaded_leads l where l.id=conversation_history.lead_id and l.user_id=(select auth.uid())) and (campaign_id is null or exists(select 1 from public.campaigns c where c.id=conversation_history.campaign_id and c.user_id=(select auth.uid()))) and (channel_id is null or exists(select 1 from public.channels c where c.id=conversation_history.channel_id and c.user_id=(select auth.uid()))));
create policy "Users can manage prompts for their campaigns" on public.campaign_prompts for all to authenticated using (user_id=(select auth.uid()) and exists(select 1 from public.campaigns c where c.id=campaign_prompts.campaign_id and c.user_id=(select auth.uid()))) with check (user_id=(select auth.uid()) and exists(select 1 from public.campaigns c where c.id=campaign_prompts.campaign_id and c.user_id=(select auth.uid())));
alter policy "Users can manage own uploaded leads" on public.uploaded_leads with check (user_id=(select auth.uid()) and (campaign_id is null or exists(select 1 from public.campaigns c where c.id=uploaded_leads.campaign_id and c.user_id=(select auth.uid()))));
create policy "Users can view their own raw inbox messages" on public.raw_inbound_email for select to authenticated using (exists(select 1 from public.channels c where c.id=raw_inbound_email.channel_id and c.user_id=(select auth.uid())));
alter view public.available_email_channels set (security_invoker=true);
alter view public.email_analytics set (security_invoker=true);
alter view public.ready_sequence_tasks set (security_invoker=true);
