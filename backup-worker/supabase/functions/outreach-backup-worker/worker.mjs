import {
  addTracking,
  classifyEmailResult,
  createTrackingId,
  encodeEmail,
  prepareReservedEmail,
  renderSequence,
  resolveThread,
  senderPayload,
} from "./email.mjs";

const MINUTE = 60_000;
const SENDER_TIMEOUT = 25_000;

function filters(values) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, "eq." + value]));
}

export function database({ url, key, fetchImpl = fetch }) {
  const base = new URL("/rest/v1/", url);
  async function request(path, method, query, body) {
    const target = new URL(path, base);
    target.search = new URLSearchParams(query);
    const response = await fetchImpl(target, {
      method,
      headers: {
        apikey: key,
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      // PostgREST errors can include records or credentials. Keep them out of logs.
      throw new Error("DATABASE_" + response.status + "_" + path);
    }
    return await response.json();
  }
  return {
    rpc: (name, args = {}) => request("rpc/" + name, "POST", {}, args),
    select: (table, query) => request(table, "GET", query),
    insert: async (table, body) => (await request(table, "POST", {}, body))[0],
  };
}

async function emailHistory(db, progress) {
  const history = [];
  const pageSize = 250;
  for (let offset = 0; ; offset += pageSize) {
    const page = await db.select("conversation_history", {
      ...filters({ lead_id: progress.lead_id, campaign_id: progress.campaign_id, channel: "email" }),
      select: "id,channel,from_role,created_at,timestamp,email_message_id,message_id,email_in_reply_to,email_references,email_subject,email_from,email_to",
      order: "created_at.asc,id.asc",
      limit: String(pageSize),
      offset: String(offset),
    });
    history.push(...page);
    if (page.length < pageSize) return history;
    if (history.length >= 5000) throw new Error("HISTORY_TOO_LARGE");
  }
}

function timeAfter(ms) {
  return new Date(Date.now() + ms).toISOString();
}

function claimed(job) {
  return { p_job_id: job.id, p_claim_token: job.claim_token };
}

function unavailable(reason, minutes = 15) {
  return { p_outcome: "deferred", p_reason: reason, p_retry_at: timeAfter(minutes * MINUTE) };
}

function stopped(reason) {
  return { p_outcome: "stopped", p_reason: reason };
}

async function deliver(payload, url, fetchImpl) {
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SENDER_TIMEOUT),
    });
    let body;
    try {
      body = await response.json();
    } catch {
      return { ambiguous: true };
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return { ambiguous: true };
    const result = classifyEmailResult({ statusCode: response.status, body }, {});
    if (result.email_send_success) return { result };

    // SMTP timeouts or connection losses can happen after a message was accepted.
    // Retry only when the response identifies a definite rejection before acceptance.
    const detail = JSON.stringify(body).toLowerCase();
    const explicitlyRejected = result.should_quarantine_channel
      || result.error_class === "recipient_rejected"
      || /(?:eauth|econnrefused|connect etimedout|invalid (?:payload|parameters)|missing required|smtp configuration)/.test(detail);
    return explicitlyRejected ? { result } : { ambiguous: true };
  } catch {
    return { ambiguous: true };
  }
}

async function processJob(db, job, config, fetchImpl) {
  async function finish(fields) {
    if (!await db.rpc("outreach_backup_finish_job", { ...claimed(job), ...fields })) {
      throw new Error("BACKUP_FINISH_REJECTED");
    }
  }
  let guardRequested = false;
  let phase = "start";

  try {
    const started = await db.rpc("outreach_backup_start_job", claimed(job));
    if (!started) return "stale";
    const progress = started.progress;
    phase = "load";
    const [step] = await db.select("campaign_sequences", {
      ...filters({ campaign_id: progress.campaign_id, step_number: progress.step }),
      limit: "1",
    });
    const [lead] = await db.select("uploaded_leads", {
      ...filters({ id: progress.lead_id }),
      limit: "1",
    });
    if (!step || !lead) {
      await finish(unavailable("backup_sequence_or_lead_missing", 60));
      return "deferred";
    }
    if (String(step.type || progress.type || "email").trim().toLowerCase() !== "email") {
      await finish(unavailable("backup_non_email_waiting_for_n8n", 15));
      return "deferred";
    }

    const manualReply = String(progress.decision?.manual_direct_reply).toLowerCase() === "true";
    if (/^(?:unsubscribed|opt[_ -]?out|bounced|invalid|do[_ -]?not[_ -]?contact)$/i.test(lead.status || "")) {
      await finish(stopped("backup_suppressed_contact"));
      return "stopped";
    }
    if (!manualReply && step.stop_on_reply !== false && lead.last_reply_at) {
      await finish(stopped("backup_lead_replied"));
      return "stopped";
    }

    phase = "render";
    const rendered = renderSequence(step, step, progress, lead);
    phase = "reserve";
    const reservation = await db.insert("outreach_email_reservation_requests", {
      progress_id: progress.id,
      claim_token: job.claim_token,
      cooldown_seconds: 900,
    });
    if (!reservation?.available) {
      await finish({
        ...unavailable(reservation?.skip_reason || "email_channel_cooldown"),
        p_retry_at: reservation?.retry_at || timeAfter(15 * MINUTE),
      });
      return "deferred";
    }

    phase = "load_inbox";
    const [channel] = await db.select("channels", {
      ...filters({ id: reservation.channel_id }),
      limit: "1",
    });
    if (!channel?.id) throw new Error("RESERVED_EMAIL_CHANNEL_NOT_FOUND");
    phase = "load_history";
    const history = await emailHistory(db, progress);
    phase = "prepare_email";
    const context = prepareReservedEmail(rendered, progress, reservation, channel, history);
    const tracked = addTracking(createTrackingId(resolveThread(context)), config.tracker_url);
    const payload = senderPayload(encodeEmail(tracked));

    // A single address, from the same uploaded lead as the claimed job.
    if (!/^[^\s<>,;@]+@[^\s<>,;@]+\.[^\s<>,;@]+$/.test(payload.to || "") || payload.to !== lead.email?.trim()) {
      await finish(stopped("backup_invalid_recipient"));
      return "stopped";
    }

    guardRequested = true;
    const guard = await db.rpc("outreach_backup_begin_email", {
      ...claimed(job),
      p_step_id: step.id,
      p_recipient: payload.to,
    });
    if (!guard?.send_allowed) {
      const reason = guard?.guard_reason || "send_guard_busy";
      if (reason === "already_sent") {
        await finish({
          p_outcome: "already_sent",
          p_reason: "completed_idempotent_guard",
          p_guard_id: guard.guard_id,
        });
        return "already_sent";
      }
      if (reason === "ambiguous_previous_attempt") {
        await finish(stopped("ambiguous_email_send_manual_review"));
        return "ambiguous";
      }
      if (reason === "suppressed_contact" || reason === "lead_replied") {
        await finish(stopped("backup_" + reason));
        return "stopped";
      }
      await finish({
        ...unavailable(reason),
        p_retry_at: guard?.retry_at || timeAfter(15 * MINUTE),
      });
      return "deferred";
    }

    const delivery = await deliver(payload, config.sender_url, fetchImpl);
    const outcome = { p_guard_id: guard.guard_id, p_attempt_token: guard.attempt_token };
    if (delivery.ambiguous) {
      await finish({ ...outcome, p_outcome: "ambiguous", p_reason: "ambiguous_email_send_manual_review" });
      return "ambiguous";
    }
    const result = delivery.result;
    if (!result.email_send_success) {
      await finish({
        ...outcome,
        p_outcome: "failed",
        p_reason: result.stop_reason,
        p_retry_at: result.email_retry_at,
        p_quarantine: result.should_quarantine_channel,
      });
      return "failed";
    }
    await finish({
      ...outcome,
      p_outcome: "sent",
      p_reason: "completed",
      p_message_id: result.messageId,
      p_subject: payload.subject,
      p_body: payload.html || payload.text,
      p_from: context.from_email,
      p_to: payload.to,
    });
    return "sent";
  } catch {
    // If authorization to send was requested, let the durable guard decide recovery.
    // The request or its outcome may have committed even if our connection failed.
    if (!guardRequested) {
      try {
        await finish(unavailable("backup_pre_send_error_" + phase));
        return "deferred";
      } catch {
        return "review";
      }
    }
    return "review";
  }
}

function result(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function createHandler({ db, fetchImpl = fetch }) {
  return async (request) => {
    if (request.method !== "POST") return result({ error: "method_not_allowed" }, 405);
    const token = request.headers.get("x-outreach-backup-token") || "";
    if (!/^[a-f0-9]{64}$/.test(token)) return result({ error: "unauthorized" }, 401);
    try {
      const config = await db.rpc("outreach_backup_authorize", { p_token: token });
      if (!config) return result({ error: "unauthorized" }, 401);
      const body = await request.json();
      if (body.mode === "preview") {
        const preview = await db.rpc("outreach_backup_preview");
        return result({ mode: "preview", ...preview });
      }
      if (body.mode === "sender_health") {
        // The existing sender accepts POST only. GET verifies the endpoint without a send.
        const response = await fetchImpl(config.sender_url, {
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        });
        return result({ mode: "sender_health", status: response.status });
      }
      if (body.mode !== "tick") return result({ error: "invalid_mode" }, 400);
      if (config.mode !== "backup") return result({ mode: config.mode, processed: 0 });
      const batch = await db.rpc("outreach_backup_claim", { p_token: token });
      const counts = {};
      for (const job of batch || []) {
        const outcome = await processJob(db, job, config, fetchImpl);
        counts[outcome] = (counts[outcome] || 0) + 1;
      }
      return result({ mode: "backup", processed: batch?.length || 0, outcomes: counts });
    } catch {
      return result({ error: "backup_tick_failed" }, 503);
    }
  };
}
