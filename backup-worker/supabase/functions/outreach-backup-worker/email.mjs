// Email transformations from the V5.4.5 n8n export, with inputs passed explicitly.

export function renderSequence($json, currentStep, progress, leadRow) {
  const output = (() => {
    // Code node, Run Once for Each Item. Use the current item's linked rows.
    const live = $json || {};
    const clean = v => v == null ? '' : String(v).trim();
    function extractLabel(text, labels) {
      const wanted = new Set(labels.map(x => x.toUpperCase()));
      for (const segment of clean(text).split(/[|\r\n]+/)) {
        const match = segment.trim().match(/^([^:=]+)\s*[:=]\s*(.*)$/);
        if (match && wanted.has(match[1].trim().toUpperCase())) return match[2].trim();
      }
      return '';
    }
    function humanFirstName(value) {
      const source = clean(value);
      if (!source || source.includes('@') || /^https?:\/\//i.test(source) || /\d/.test(source)) return '';
      const match = source.match(/[A-Za-zÀ-ÿ'’-]{2,30}/);
      if (!match) return '';
      const first = match[0];
      if (new Set(['unknown','there','admin','info','contact','support','team','business','company','null','none','undefined','user']).has(first.toLowerCase())) return '';
      return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
    }
    function isInstruction(value) {
      return /you are an ai appointment setter|contact leads via email and book qualified appointments|return only valid json with exactly this structure|you are julian's outreach engine/i.test(clean(value));
    }
    const companyName = clean(leadRow.company_name || leadRow.company || live.company_name);
    const extractedFirstName = humanFirstName(extractLabel(companyName, ['FIRST_NAME','FIRST NAME','FIRSTNAME','NAME'])) || humanFirstName(leadRow.first_name || leadRow.name);
    const extractedOpening = extractLabel(companyName, ['OPENING','PERSONALIZED_OPENING','PERSONALIZED OPENING','PERSONALIZATION','ICEBREAKER','OPENING LINE']) || clean(leadRow.personalized_opening);
    // Bad enrichment must never crash an entire claimed batch.
    // A missing name renders naturally as "Hey there," and a missing opening gets a neutral line.
    const firstName = extractedFirstName || 'there';
    const opening = extractedOpening || 'I was checking out your content and had a couple ideas around what you are already doing.';
    const personalizationFallback = {
      first_name: !extractedFirstName,
      opening: !extractedOpening
    };
    const WARM_LEADS_CAMPAIGN_ID = '1317e852-9bc7-4447-9c7a-802f1789be75';
    const isWarmLeadsCampaign = progress.campaign_id === WARM_LEADS_CAMPAIGN_ID;
    const leadCampaignMatches = isWarmLeadsCampaign || leadRow.campaign_id === progress.campaign_id;
    if (!currentStep.id || currentStep.campaign_id !== progress.campaign_id || Number(currentStep.step_number) !== Number(progress.step) || leadRow.id !== progress.lead_id || !leadCampaignMatches || leadRow.user_id !== progress.user_id) {
      throw new Error('SEQUENCE_ROW_MISMATCH: linked lead, campaign, user and step must match');
    }
    const rawChannel = clean(currentStep.type || progress.type || 'email').toLowerCase();
    const channel = ['voice','vapi'].includes(rawChannel) ? 'call' : rawChannel;
    const rawTemplate = clean(currentStep.message_template || (channel === 'email' ? currentStep.email_template : ''));
    const subject = channel === 'email' ? clean(currentStep.email_subject) : '';
    const vars = { first_name:firstName, firstname:firstName, name:firstName, opening, personalized_opening:opening, company_name:companyName, company:companyName, email:clean(leadRow.email), phone:clean(leadRow.phone), step:Number(currentStep.step_number) };
    if (!rawTemplate || isInstruction(rawTemplate)) throw new Error('MISSING_OR_INVALID_SEQUENCE_TEMPLATE');
    if (channel === 'email' && !subject) throw new Error('MISSING_EMAIL_SUBJECT');
    const tokens = [...rawTemplate.matchAll(/\{\{?\s*([a-z_]+)\s*\}?\}/gi)].map(m => m[1].toLowerCase());
    if (tokens.some(t => !(t in vars))) throw new Error('UNSUPPORTED_SEQUENCE_TOKEN');
    const rendered = rawTemplate.replace(/\r/g,'').replace(/\{\{?\s*([a-z_]+)\s*\}?\}/gi, (_,key) => String(vars[key.toLowerCase()])).trim();
    if (isInstruction(rendered)) throw new Error('LEGACY_INSTRUCTION_BLOCKED');
    return {json: {
      ...live, ...leadRow,
      progress, progress_id:progress.id, lead_id:leadRow.id,
      user_id:progress.user_id, campaign_id:progress.campaign_id,
      channel_id:progress.channel_id || null,
      locked_email_channel_id:progress.channel_id || null,
      company:companyName, company_name:companyName,
      first_name:firstName, personalized_opening:opening, personalization_fallback:personalizationFallback,
      sequence_step:Number(currentStep.step_number), sequence_step_id:currentStep.id,
      stop_on_reply:currentStep.stop_on_reply !== false,
      action:channel, channel, type:channel, daily_limit:live.daily_limit ?? 100,
      sequence_source:'campaign_sequences', message_template:rawTemplate,
      rendered_sequence_message:rendered,
      email_subject:subject, subject,
      email_body:channel === 'email' ? rendered : '',
      text:channel === 'email' ? rendered : '',
      email_message:{subject, body:channel === 'email' ? rendered : '', text:channel === 'email' ? rendered : ''},
      sms_message:channel === 'sms' ? rendered : '',
      whatsapp_message:channel === 'whatsapp' ? rendered : '',
      vapi_script:channel === 'call' ? rendered : '',
      email_ready:channel !== 'email' || Boolean(rendered),
      shouldCall:channel === 'call', shouldSMS:channel === 'sms', shouldWhatsApp:channel === 'whatsapp', shouldEmail:channel === 'email'
    }};
  })();
  return output.json;
}

export function prepareReservedEmail(base, progress, reservation, channel, historyRows) {
  const output = (() => {
    function clean(v){ return v === undefined || v === null ? '' : String(v).trim(); }
    const history = historyRows.filter(x=>x.id && x.channel === 'email');
    history.sort((a,b)=>new Date(a.created_at||a.timestamp||0)-new Date(b.created_at||b.timestamp||0));
    const lastOutbound = [...history].reverse().find(x=>x.from_role==='ai' && (x.email_message_id || x.message_id));
    const creds = channel.credentials && typeof channel.credentials === 'object' ? channel.credentials : {};
    const smtpUser = clean(creds.smtp_username || creds.smtp_user || channel.email_address);
    const smtpPass = clean(creds.smtp_password || creds.smtp_pass).replace(/\s+/g,'');
    const fromEmail = clean(channel.email_address || creds.email_address || smtpUser);
    let senderName = clean(channel.sender_name);
    if (!senderName) {
      const local = fromEmail.includes('@') ? fromEmail.split('@')[0] : fromEmail;
      const first = local.split(/[._+\-\s]+/).filter(Boolean)[0] || 'Julian';
      senderName = first.length === 1 ? first.toUpperCase() : first.charAt(0).toUpperCase()+first.slice(1).toLowerCase();
    }
    if (!channel.id) throw new Error('RESERVED_EMAIL_CHANNEL_NOT_FOUND');
    if (!smtpUser || !smtpPass || !fromEmail) throw new Error('RESERVED_EMAIL_CHANNEL_MISSING_SMTP');
    return [{json:{
      ...base,
      progress,
      conversation_history_rows: history,
      email_channel: channel,
      channel_id: channel.id,
      email_channel_id: channel.id,
      locked_email_channel_id: channel.id,
      email_reserved: true,
      email_reservation_id: reservation.id,
      email_reservation_at: reservation.reserved_at,
      from_email: fromEmail,
      sender_first_name: senderName,
      sender_name: senderName,
      reply_to_email: clean(channel.reply_to_email) || null,
      smtp_host: clean(creds.smtp_host) || 'smtp.gmail.com',
      smtp_port: Number(creds.smtp_port || 587),
      smtp_secure: creds.smtp_secure === true || String(creds.smtp_secure).toLowerCase()==='true',
      smtp_user: smtpUser,
      smtp_pass: smtpPass,
      last_outbound_message_id: lastOutbound?.email_message_id || lastOutbound?.message_id || progress.reply_to_message_id || null,
      progress_message_id: progress.reply_to_message_id || null,
      thread_mode: Number(progress.step) > 1 ? 'followup' : 'new',
      shouldEmail: true,
      email_channel_available: true
    }, pairedItem:{item:0}}];
  })();
  return output[0].json;
}

export function resolveThread($json) {
  const output = (() => {
    /**
     * Resolve Email Thread Context (FIXED)
     * Outputs:
     * - thread_mode: "reply" | "followup" | "new"
     * - inReplyTo: string|null
     * - references: string[]|null
     *
     * Key idea:
     * - If we are replying to a lead's inbound message -> anchor = last inbound message_id
     * - If we are doing followup in the same thread -> anchor = last outbound message_id
     *
     * It tries multiple sources:
     * - explicit fields on $json
     * - conversation_history_rows (if you pass them in)
     */

    function s(v) {
      return v === undefined || v === null ? "" : String(v).trim();
    }

    function asArrayRefs(v) {
      if (!v) return [];
      if (Array.isArray(v)) return v.filter(Boolean).map(x => String(x).trim()).filter(Boolean);
      const str = String(v).trim();
      if (!str) return [];
      // Handles either "a b c" or "<id1> <id2>" or comma-separated
      return str
        .split(/[\s,]+/)
        .map(x => x.trim())
        .filter(Boolean);
    }

    function uniq(arr) {
      const out = [];
      const seen = new Set();
      for (const x of arr) {
        const k = String(x);
        if (!seen.has(k)) {
          seen.add(k);
          out.push(k);
        }
      }
      return out;
    }

    // --- Determine mode ---
    const status = s($json.status).toLowerCase();
    const eventType = s($json.event_type || $json.type).toLowerCase();

    let mode = s($json.thread_mode || $json.threadMode || $json.email_thread_mode || $json.email_mode).toLowerCase();

    // Infer mode if not explicitly set
    if (!["reply", "followup", "new"].includes(mode)) {
      const hasExplicitReplyAnchor = Boolean(
        $json.reply_to_message_id ||
        $json.event_message_id ||
        $json.latest_inbound_message_id ||
        $json.thread_anchor_message_id ||
        $json.inReplyTo || // already computed upstream in some runs
        $json.email_in_reply_to
      );

      const isReplyish =
        status === "replied" ||
        eventType === "inbound_reply" ||
        $json.is_reply === true ||
        hasExplicitReplyAnchor;

      const stepNumber = Number($json.step_number ?? $json.sequence_step ?? $json.step ?? 0);
      const isFollowup = Number.isFinite(stepNumber) && stepNumber > 0;

      mode = isReplyish ? "reply" : (isFollowup ? "followup" : "new");
    }

    // --- Pick anchor message-id ---
    let anchor = null;

    // Reply: anchor to the most recent inbound message
    if (mode === "reply") {
      anchor =
        s($json.reply_to_message_id) ||
        s($json.event_message_id) ||
        s($json.latest_inbound_message_id) ||
        s($json.thread_anchor_message_id) ||
        s($json.email_in_reply_to) ||
        s($json.inReplyTo) ||
        null;
    }

    // Followup: anchor to the last outbound message (keeps thread)
    if (mode === "followup") {
      anchor =
        s($json.progress_message_id) ||
        s($json.last_outbound_message_id) ||
        s($json.last_email_message_id) ||
        s($json.message_id) ||
        s($json.email_message_id) ||
        null;
    }

    if (anchor === "") anchor = null;

    // --- Fallback: use conversation_history_rows if provided ---
    const hist = Array.isArray($json.conversation_history_rows)
      ? $json.conversation_history_rows
      : [];

    function getDir(row) {
      const a = s(row.direction).toLowerCase();
      if (a) return a;
      const role = s(row.from_role || row.role).toLowerCase();
      if (role === "lead") return "inbound";
      if (role === "ai") return "outbound";
      return "";
    }

    function getMid(row) {
      return (
        s(row.message_id) ||
        s(row.email_message_id) ||
        s(row.messageId) ||
        ""
      );
    }

    if (!anchor && hist.length) {
      const reversed = [...hist].reverse();

      if (mode === "reply") {
        const lastInbound = reversed.find(r => getDir(r).includes("in"));
        const mid = lastInbound ? getMid(lastInbound) : "";
        if (mid) anchor = mid;
      }

      if (mode === "followup") {
        const lastOutbound = reversed.find(r => getDir(r).includes("out"));
        const mid = lastOutbound ? getMid(lastOutbound) : "";
        if (mid) anchor = mid;
      }
    }

    // --- Build references chain ---
    // Start with anything we already have
    let refs = asArrayRefs(
      $json.email_references ||
      $json.references ||
      $json.reply_references
    );

    // Add anchor to references if we have one
    if (anchor) {
      const a = String(anchor);
      if (!refs.includes(a)) refs.push(a);
    }

    refs = uniq(refs);

    // Final outputs
    const inReplyTo = anchor ? String(anchor) : null;
    const references = refs.length ? refs : (inReplyTo ? [inReplyTo] : null);

    return [
      {
        json: {
          ...$json,
          thread_mode: mode,
          inReplyTo,
          references,
        },
      },
    ];
  })();
  return output[0].json;
}

export function createTrackingId($json) {
  const output = (() => {
    // Node name: Create Tracking ID
    const rnd = globalThis.crypto.randomUUID();
    const tracking_id = 't_' + String(rnd).replace(/-/g,'');
    return [{
      json: {
        ...$json,
        tracking_id,
        sent_at: new Date().toISOString()
      }
    }];
  })();
  return output[0].json;
}

export function addTracking(input, trackerBase) {
  const output = (() => {
    const TRACKER_BASE =
      trackerBase;

    function clean(value) {
      if (value === undefined || value === null) return '';
      return String(value).trim();
    }

    function escapeHtml(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function normalizeBody(value) {
      return clean(value)
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    function buildHtmlFromText(body) {
      return normalizeBody(body)
        .split(/\n\s*\n/)
        .map(p => p.trim())
        .filter(Boolean)
        .map(paragraph => {
          const content = escapeHtml(paragraph).replace(/\n/g, '<br>');
          return `<div style="margin:0 0 16px 0;">${content}</div>`;
        })
        .join('');
    }

    return [{ json: input }].map((item, index) => {
      const data = item.json || {};

      const emailBody = normalizeBody(
        data.email_body ||
        data.email_message?.body ||
        data.rendered_sequence_message ||
        data.text
      );

      const emailSubject = clean(
        data.email_subject ||
        data.email_message?.subject ||
        data.subject
      );

      if (!emailBody) {
        throw new Error(
          `Sequence ${data.sequence_step || data.step || '?'} has no email body before tracking`
        );
      }

      if (!emailSubject) {
        throw new Error(
          `Sequence ${data.sequence_step || data.step || '?'} has no email subject before tracking`
        );
      }


      if (data.sequence_source !== 'campaign_sequences') {
        throw new Error(
          `Email blocked before tracking: source was ${data.sequence_source || 'missing'}`
        );
      }

      const legacyProbe = `${emailSubject}\n${emailBody}`.toLowerCase();

      if (
        legacyProbe.includes('you are an ai appointment setter') ||
        legacyProbe.includes('contact leads via email and book qualified appointments') ||
        legacyProbe.includes('return only valid json with exactly this structure')
      ) {
        throw new Error(
          `Email blocked before tracking: legacy AI instruction detected`
        );
      }

      let trackingId = clean(data.tracking_id || data.trackingId);

      if (!trackingId) {
        const rnd = globalThis.crypto.randomUUID();

        trackingId = 't_' + String(rnd).replace(/-/g, '');
      }

      const openUrl =
        `${TRACKER_BASE}/open?id=${encodeURIComponent(trackingId)}`;

      const clickBase =
        `${TRACKER_BASE}/click?id=${encodeURIComponent(trackingId)}&url=`;

      const htmlBody = buildHtmlFromText(emailBody);

      const trackingPixel =
        `<img src="${openUrl}" width="1" height="1" ` +
        `style="display:none;width:1px;height:1px;border:0;" alt="">`;

      const trackedHtml =
        `<div style="font-family:Arial,Helvetica,sans-serif;` +
        `font-size:14px;line-height:1.5;color:#111;">` +
        htmlBody +
        trackingPixel +
        `</div>`;

      return {
        json: {
          ...data,

          email_subject: emailSubject,
          email_body: emailBody,

          email_message: {
            ...(data.email_message || {}),
            subject: emailSubject,
            body: emailBody
          },

          subject: emailSubject,
          text: emailBody,
          html: trackedHtml,

          email_ready: true,
          email_validation_error: '',

          tracking_id: trackingId,
          tracking_open_url: openUrl,
          tracking_click_base: clickBase
        },

        pairedItem: {
          item: index
        }
      };
    });
  })();
  return output[0].json;
}

export function encodeEmail($json) {
  const output = (() => {
    function toPlainText(html) {
      if (!html) return '';

      return String(html)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    function clean(value) {
      return value === undefined || value === null
        ? ''
        : String(value).trim();
    }

    function deriveSenderFirstName(data) {
      const explicit = clean(
        data.sender_first_name ||
        data.sender_name ||
        data.email_channel?.sender_name ||
        data.email_channel?.display_name ||
        data.email_channel?.from_name
      );

      if (explicit) {
        if (explicit.length === 1) return explicit.toUpperCase();
        return explicit.charAt(0).toUpperCase() + explicit.slice(1).toLowerCase();
      }

      const email = clean(
        data.from_email ||
        data.smtp_user ||
        data.email_channel?.email_address ||
        data.email_channel?.sender_email
      );

      const local = email.includes('@') ? email.split('@')[0] : email;
      const first = local.split(/[._+\-\s]+/).filter(Boolean)[0] || '';

      if (!first) return 'Julian';
      if (first.length === 1) return first.toUpperCase();

      return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
    }

    function personalizePlainTextSignature(body, senderName) {
      let value = clean(body);
      if (!value || !senderName) return value;

      // Preferred template token for any new sequence.
      value = value
        .replace(/\{\{\s*sender_first_name\s*\}\}/gi, senderName)
        .replace(/\{\s*sender_first_name\s*\}/gi, senderName);

      // Backward compatibility for all existing campaigns:
      // only replace the NAME directly after the final sign-off.
      const signaturePattern =
        /((?:All the best|Best|Kind regards|Regards|Cheers),?\s*\n+)\s*[A-Za-zÀ-ÿ'’-]{1,40}\s*$/i;

      if (signaturePattern.test(value)) {
        value = value.replace(signaturePattern, `$1${senderName}`);
      }

      return value;
    }

    function personalizeHtmlSignature(html, senderName) {
      let value = clean(html);
      if (!value || !senderName) return value;

      value = value
        .replace(/\{\{\s*sender_first_name\s*\}\}/gi, senderName)
        .replace(/\{\s*sender_first_name\s*\}/gi, senderName);

      // Handles the HTML generated by "Add Tracking to Body":
      // "All the best,<br>Julian" -> "All the best,<br>Francisco"
      const htmlSignaturePattern =
        /((?:All the best|Best|Kind regards|Regards|Cheers),?\s*(?:<br\s*\/?>|\n|&nbsp;|\s)+)\s*[A-Za-zÀ-ÿ'’-]{1,40}(?=\s*(?:<\/div>|<\/p>|<img\b|$))/i;

      if (htmlSignaturePattern.test(value)) {
        value = value.replace(htmlSignaturePattern, `$1${senderName}`);
      }

      return value;
    }

    function looksLikeLegacyInstruction(value) {
      const s = clean(value).toLowerCase();

      return (
        s.includes('you are an ai appointment setter') ||
        s.includes('contact leads via email and book qualified appointments') ||
        s.includes('return only valid json with exactly this structure') ||
        s.includes("you are julian's outreach engine")
      );
    }

    if ($json.sequence_source !== 'campaign_sequences') {
      throw new Error(
        `Email blocked: expected campaign_sequences source, got ${$json.sequence_source || 'missing'}`
      );
    }

    const channel_id =
      $json.channel_id ||
      $json.email_channel_id ||
      $json.email_channel?.id ||
      $json.locked_email_channel_id ||
      null;

    const to =
      $json.to ||
      $json.lead_email ||
      $json.email ||
      null;

    const senderFirstName = deriveSenderFirstName($json);

    const rawHtml = clean(
      $json.html ||
      $json.email_body_tracked ||
      ''
    );

    const rawText = clean(
      $json.text ||
      $json.email_body ||
      $json.email_message?.text ||
      $json.email_message?.body ||
      ''
    ) || toPlainText(rawHtml);

    const text = personalizePlainTextSignature(rawText, senderFirstName);
    const html = personalizeHtmlSignature(rawHtml, senderFirstName);

    const subject = clean(
      $json.email_subject ||
      $json.subject ||
      $json.email_message?.subject
    );

    if (!to) throw new Error('Email blocked: missing recipient');
    if (!subject) throw new Error('Email blocked: missing sequence subject');
    if (!text) throw new Error('Email blocked: missing deterministic sequence body');

    if (looksLikeLegacyInstruction(text) || looksLikeLegacyInstruction(html)) {
      throw new Error('Email blocked: legacy AI instruction detected');
    }

    const inReplyTo =
      $json.inReplyTo ??
      $json.reply_in_reply_to ??
      null;

    const references =
      $json.references ??
      $json.reply_references ??
      null;

    const replyTo =
      $json.reply_to_email ||
      $json.email_channel?.reply_to_email ||
      null;

    const headers = inReplyTo
      ? {
          'In-Reply-To': inReplyTo,
          References: references || inReplyTo
        }
      : undefined;

    return [
      {
        json: {
          ...$json,
          channel_id,
          to,
          subject,
          sender_first_name: senderFirstName,
          sender_name: senderFirstName,
          html,
          text,
          email_body: text,
          inReplyTo,
          references,
          replyTo,
          deterministic_email_verified: true,
          email_message: {
            subject,
            body: html || text,
            text,
            inReplyTo,
            references,
            replyTo,
            headers
          }
        }
      }
    ];
  })();
  return output[0].json;
}

export function classifyEmailResult($json, reserved) {
  const output = (() => {
    // Classify the actual SMTP result and carry the reserved channel context forward.
    // A channel is quarantined only for channel/account-level failures, never for a bad recipient.

    const response = $json || {};
    const body =
      response.body && typeof response.body === 'object'
        ? response.body
        : response.data && typeof response.data === 'object'
          ? response.data
          : response;

    const errorObject =
      (response.error && typeof response.error === 'object' ? response.error : null) ||
      (body.error && typeof body.error === 'object' ? body.error : null);

    const statusCodeRaw =
      response.statusCode ??
      response.status ??
      body.statusCode ??
      body.status ??
      errorObject?.statusCode ??
      null;
    const statusCode = Number(statusCodeRaw) || null;

    const message = [
      typeof response.error === 'string' ? response.error : '',
      typeof body.error === 'string' ? body.error : '',
      errorObject?.message,
      errorObject?.description,
      response.message,
      body.message,
      body.detail,
      body.description,
    ].filter(Boolean).join(' | ').toLowerCase();

    const successFlag =
      body.success ??
      body.ok ??
      response.success ??
      response.ok ??
      null;

    const messageId =
      body.messageId ||
      body.message_id ||
      body.info?.messageId ||
      response.messageId ||
      response.message_id ||
      response.info?.messageId ||
      null;

    const accepted =
      body.accepted ||
      body.info?.accepted ||
      response.accepted ||
      response.info?.accepted ||
      [];

    const explicitError =
      successFlag === false ||
      Boolean(response.error) ||
      Boolean(body.error) ||
      (statusCode !== null && (statusCode < 200 || statusCode >= 300));

    const emailSendSuccess = !explicitError && (successFlag === true || Boolean(messageId) || (Array.isArray(accepted) && accepted.length > 0));

    const recipientFailure =
      /(?:recipient|mailbox|user unknown|no such user|address not found|invalid recipient|5\.1\.1|rcpt to)/i.test(message) &&
      !/(?:sender|account|username)/i.test(message);

    const authFailure =
      /(?:535|534|authentication|auth failed|invalid credentials|bad credentials|username and password not accepted|application-specific password|app password|login failed|oauth|token revoked)/i.test(message);

    const accountFailure =
      /(?:account (?:disabled|suspended|revoked|blocked)|sender (?:rejected|unauthori[sz]ed)|not allowed to send|relay (?:access )?denied|less secure app)/i.test(message);

    const configFailure =
      /(?:enotfound|getaddrinfo|dns|invalid smtp host|certificate|ssl routines|wrong version number)/i.test(message);

    const shouldQuarantine =
      !emailSendSuccess &&
      !recipientFailure &&
      (authFailure || accountFailure || configFailure);

    let errorClass = null;
    let stopReason = null;

    if (!emailSendSuccess) {
      if (recipientFailure) {
        errorClass = 'recipient_rejected';
        stopReason = 'email_recipient_rejected';
      } else if (authFailure) {
        errorClass = 'smtp_auth';
        stopReason = 'smtp_auth_error_channel_quarantined';
      } else if (accountFailure) {
        errorClass = 'smtp_account';
        stopReason = 'smtp_account_error_channel_quarantined';
      } else if (configFailure) {
        errorClass = 'smtp_config';
        stopReason = 'smtp_config_error_channel_quarantined';
      } else {
        errorClass = 'smtp_transient';
        stopReason = 'email_send_transient_error';
      }
    }

    const retryDelayMs = shouldQuarantine ? 60 * 1000 : 15 * 60 * 1000;

    return [{
      json: {
        ...reserved,
        ...response,
        messageId,
        email_send_success: emailSendSuccess,
        should_quarantine_channel: shouldQuarantine,
        channel: 'email',
        error_class: errorClass,
        stop_reason: stopReason,
        is_critical: shouldQuarantine,
        http_status: statusCode,
        raw_error: emailSendSuccess ? null : (body || response),
        email_retry_at: emailSendSuccess
          ? null
          : new Date(Date.now() + retryDelayMs).toISOString(),
      },
      pairedItem: { item: 0 },
    }];
  })();
  return output[0].json;
}

export function senderPayload($json) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();

  const parseRefs = (v) => {
    if (!v) return null;

    if (Array.isArray(v)) {
      const out = v.map(x => s(x)).filter(Boolean);
      return out.length ? out : null;
    }

    const str = s(v);
    if (!str) return null;

    try {
      const parsed = JSON.parse(str);
      if (Array.isArray(parsed)) {
        const out = parsed.map(x => s(x)).filter(Boolean);
        return out.length ? out : null;
      }
    } catch (_) {}

    const parts = str.split(/[\s,]+/).map(x => x.trim()).filter(Boolean);
    return parts.length ? parts : null;
  };

  const channel_id =
    s($json.channel_id) ||
    s($json.email_channel_id) ||
    s($json.email_channel?.id) ||
    s($json.locked_email_channel_id) ||
    null;

  const from =
    s($json.from) ||
    s($json.smtp_from) ||
    s($json.smtp_user) ||
    s($json.email_channel?.email_address) ||
    s($json.from_email) ||
    null;

  const to =
    s($json.to) ||
    s($json.lead_email) ||
    s($json.email) ||
    null;

  const subject =
    s($json.subject) ||
    s($json.email_subject) ||
    "BUSINESS INQUIRIES";

  const text =
    s($json.text) ||
    s($json.email_body) ||
    s($json.email_message?.text) ||
    s($json.email_message?.body) ||
    "";

  const rawHtml =
    s($json.email_body_tracked) ||
    s($json.html) ||
    s($json.email_message?.html) ||
    "";

  const pixelMatch = rawHtml.match(/<img\b[^>]*(?:\/t\/o\.gif|tracker)[^>]*>/i);
  const trackingPixel = pixelMatch ? pixelMatch[0] : "";
  const hasRealLayout = /<(?:p|br|div|table|ul|ol|li)\b/i.test(rawHtml);

  const escapeHtml = (value) => String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const linkify = (value) => value.replace(/(https?:\/\/[^\s<]+)/g, url =>
    '<a href="' + url + '">' + url + '</a>'
  );

  const formatTextAsHtml = (value) => String(value || "")
    .replace(/\\n/g, "\n")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map(paragraph =>
      '<p style="margin:0 0 16px 0;line-height:1.5;">' +
      linkify(escapeHtml(paragraph).replace(/\n/g, "<br>")) +
      '</p>'
    )
    .join("");

  const html = hasRealLayout
    ? rawHtml
    : formatTextAsHtml(text || rawHtml.replace(/<img\b[^>]*>/gi, "")) + trackingPixel;

  const inReplyTo =
    s($json.inReplyTo) ||
    s($json.email_in_reply_to) ||
    s($json.reply_in_reply_to) ||
    s($json.reply_to_message_id) ||
    null;

  const references =
    parseRefs($json.references) ||
    parseRefs($json.email_references) ||
    parseRefs($json.reply_references) ||
    (inReplyTo ? [inReplyTo] : null);

  const payload = {
    channel_id,
    from,
    to,
    subject,
    html,
    text,
    inReplyTo,
    references,

    smtp_host: $json.smtp_host || $json.email_channel?.credentials?.smtp_host || 'smtp.gmail.com',
    smtp_port: $json.smtp_port || $json.email_channel?.credentials?.smtp_port || 587,
    smtp_secure: $json.smtp_secure ?? $json.email_channel?.credentials?.smtp_secure ?? false,
    smtp_user: $json.smtp_user || $json.email_channel?.credentials?.smtp_username || $json.email_channel?.credentials?.smtp_user || '',
    smtp_pass: $json.smtp_pass || $json.email_channel?.credentials?.smtp_password || $json.email_channel?.credentials?.smtp_pass || '',

    lead_id: $json.lead_id || $json.id || null,
    campaign_id: $json.campaign_id || null,
    tracking_id: $json.tracking_id || null
  };

  return payload;
}
