import assert from "node:assert/strict";
import { test } from "node:test";
import { createHandler } from "../supabase/functions/outreach-backup-worker/worker.mjs";

const token = "a".repeat(64);
const job = { id: "job", claim_token: "claim" };
const progress = {
  id: "progress", campaign_id: "campaign", lead_id: "lead", user_id: "user",
  status: "running", step: 2, type: "email", reply_to_message_id: "<first@example.test>",
};
const step = {
  id: "step", campaign_id: "campaign", step_number: 2, type: "email",
  email_subject: "Collab inquiry", stop_on_reply: true,
  email_template: "Hey {first_name},\n\n{opening}\n\nAll the best,\nJulian",
};
const lead = {
  id: "lead", campaign_id: "campaign", user_id: "user",
  name: "Alex Smith", email: "alex@example.test", company_name: "OPENING: I enjoyed your recent video.",
};
const inbox = {
  id: "inbox", email_address: "casey@example.test", sender_name: "Casey",
  credentials: { smtp_username: "casey@example.test", smtp_password: "test-only-password" },
};
const history = [{
  id: "history", from_role: "ai", channel: "email",
  email_message_id: "<first@example.test>", created_at: "2026-10-01T00:00:00Z",
}];

function fixture(options = {}) {
  const calls = [];
  const db = {
    async rpc(name, args) {
      calls.push([name, args]);
      switch (name) {
        case "outreach_backup_authorize":
          return args.p_token === token ? {
            mode: options.mode || "backup",
            sender_url: "https://sender.example.test/send",
            tracker_url: "https://tracker.example.test/tracker",
          } : null;
        case "outreach_backup_preview":
          return { dispatcher: options.mode || "backup", active_email_inboxes: 1 };
        case "outreach_backup_claim":
          return [job];
        case "outreach_backup_start_job":
          return { progress: options.progress || progress };
        case "outreach_backup_begin_email":
          return options.guard || { send_allowed: true, guard_id: "guard", attempt_token: "attempt" };
        case "outreach_backup_finish_job":
          return options.rejectFinish ? false : true;
        default:
          assert.fail("Unexpected RPC " + name);
      }
    },
    async select(table) {
      calls.push([table]);
      switch (table) {
        case "uploaded_leads": return [options.lead || lead];
        case "campaign_sequences": return [options.step || step];
        case "channels": return [inbox];
        case "conversation_history": return history;
        default: assert.fail("Unexpected table " + table);
      }
    },
    async insert(table, payload) {
      calls.push([table, payload]);
      assert.equal(table, "outreach_email_reservation_requests");
      return options.reservation || { id: "reserve", available: true, channel_id: inbox.id };
    },
  };
  const fetchImpl = async (_url, request) => {
    calls.push(["transport", request?.body ? JSON.parse(request.body) : null]);
    if (options.timeout) throw new Error("upstream timeout");
    return options.response || Response.json({ success: true, messageId: "<next@example.test>" });
  };
  const handler = createHandler({ db, fetchImpl });
  const request = (mode, auth = token) => handler(new Request("https://worker.example.test", {
    method: "POST",
    headers: { "x-outreach-backup-token": auth },
    body: JSON.stringify({ mode }),
  }));
  return { request, calls, find: (name) => calls.find(([called]) => called === name)?.[1] };
}

test("unauthenticated or invalid tokens cannot claim or send", async () => {
  const f = fixture();
  assert.equal((await f.request("tick", "")).status, 401);
  assert.equal((await f.request("tick", "b".repeat(64))).status, 401);
  assert.deepEqual(f.calls.map(([name]) => name), ["outreach_backup_authorize"]);
});

test("preview, sender health, and primary mode never claim work or POST to SMTP", async () => {
  const f = fixture({ mode: "primary" });
  assert.deepEqual(await (await f.request("preview")).json(), {
    mode: "preview", dispatcher: "primary", active_email_inboxes: 1,
  });
  assert.deepEqual(await (await f.request("sender_health")).json(), { mode: "sender_health", status: 200 });
  assert.deepEqual(await (await f.request("tick")).json(), { mode: "primary", processed: 0 });
  assert.equal(f.calls.some(([name]) => name === "outreach_backup_claim"), false);
  assert.equal(f.find("transport"), null);
});

test("uses the same inbox, approved copy, signature, tracking and reply headers", async () => {
  const f = fixture();
  const tick = await (await f.request("tick")).json();
  assert.deepEqual(tick.outcomes, { sent: 1 });
  assert.equal(f.find("outreach_email_reservation_requests").cooldown_seconds, 900);
  const payload = f.find("transport");
  assert.equal(payload.channel_id, "inbox");
  assert.equal(payload.to, lead.email);
  assert.equal(payload.subject, "Collab inquiry");
  assert.equal(payload.inReplyTo, "<first@example.test>");
  assert.deepEqual(payload.references, ["<first@example.test>"]);
  assert.match(payload.text, /Hey Alex,\n\nI enjoyed your recent video\./);
  assert.match(payload.text, /All the best,\nCasey/);
  assert.match(payload.html, /tracker\.example\.test\/tracker\/open/);
  assert.equal(f.find("outreach_backup_finish_job").p_message_id, "<next@example.test>");
});

test("unavailable inbox defers to the database's retry time", async () => {
  const retry_at = "2030-01-01T00:00:00Z";
  const f = fixture({ reservation: { available: false, retry_at, skip_reason: "locked_email_channel_cooling_down" } });
  assert.deepEqual((await (await f.request("tick")).json()).outcomes, { deferred: 1 });
  assert.equal(f.find("transport"), undefined);
  assert.equal(f.find("outreach_backup_finish_job").p_retry_at, retry_at);
});

test("a sent guard advances without sending again", async () => {
  const f = fixture({ guard: { send_allowed: false, guard_reason: "already_sent", guard_id: "guard" } });
  assert.deepEqual((await (await f.request("tick")).json()).outcomes, { already_sent: 1 });
  assert.equal(f.find("transport"), undefined);
  assert.equal(f.find("outreach_backup_finish_job").p_guard_id, "guard");
});

test("an unknown transport outcome goes to review instead of retrying", async () => {
  const f = fixture({ timeout: true });
  assert.deepEqual((await (await f.request("tick")).json()).outcomes, { ambiguous: 1 });
  assert.equal(f.find("outreach_backup_finish_job").p_outcome, "ambiguous");
});

test("a known recipient failure never quarantines the sending account", async () => {
  const f = fixture({ response: Response.json({ success: false, error: "550 5.1.1 recipient not found" }, { status: 500 }) });
  assert.deepEqual((await (await f.request("tick")).json()).outcomes, { failed: 1 });
  assert.equal(f.find("outreach_backup_finish_job").p_quarantine, false);
  assert.equal(f.find("outreach_backup_finish_job").p_reason, "email_recipient_rejected");
});

test("honors opt-outs and ordinary replies while allowing explicit manual replies", async () => {
  const optedOut = fixture({ lead: { ...lead, status: "unsubscribed" } });
  const replied = fixture({ lead: { ...lead, last_reply_at: "2026-10-01T00:00:00Z" } });
  const manual = fixture({
    lead: { ...lead, last_reply_at: "2026-10-01T00:00:00Z" },
    progress: { ...progress, decision: { manual_direct_reply: true } },
  });
  assert.deepEqual((await (await optedOut.request("tick")).json()).outcomes, { stopped: 1 });
  assert.deepEqual((await (await replied.request("tick")).json()).outcomes, { stopped: 1 });
  assert.deepEqual((await (await manual.request("tick")).json()).outcomes, { sent: 1 });
  assert.equal(optedOut.find("transport"), undefined);
  assert.equal(replied.find("transport"), undefined);
});

test("a failed write after SMTP acceptance is surfaced for review without a second send", async () => {
  const f = fixture({ rejectFinish: true });
  assert.deepEqual((await (await f.request("tick")).json()).outcomes, { review: 1 });
  assert.equal(f.calls.filter(([name]) => name === "transport").length, 1);
});
