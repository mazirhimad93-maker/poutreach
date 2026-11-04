# Poutreach backup worker

A temporary, email-only replacement for the n8n Outreach Engine V5.4.5. Supabase Cron invokes a Supabase Edge Function every minute. The function calls the existing Netlify SMTP sender and uses the same Poutreach database and campaign data. GitHub versions this folder independently of the web interface.

The worker reuses the live dispatcher, inbox reservations and send guards. This preserves campaign schedules, daily caps, 15-minute inbox cooldown, same-inbox follow-ups, and sequence advancement. The email renderer carries over the saved n8n workflow's templates, personalization, dynamic sender signature, tracking, and thread headers. It checks stored replies and opt-outs before sending. The worker keeps SMTP failures with uncertain delivery in review so a timed-out message is not sent twice.

The fallback defaults to three jobs per minute. The original n8n export requested 25 per batch. SMS, WhatsApp, voice and incoming IMAP polling run separately. The fallback processes outgoing email and honors replies already saved in the database.

## Phone-friendly handoff

The following statements are for the existing Poutreach project's Supabase SQL Editor. A regular browser on a phone is enough.

To preview safely, queue a read-only check. It returns a request ID and sends no email.

```sql
select outreach_private.backup_invoke('preview');
```

Look up the request using its numeric ID.

```sql
select status_code, content
from net._http_response
where id = YOUR_REQUEST_ID;
```

To enable the fallback after confirming the sender is healthy and n8n is down or paused:

```sql
select outreach_private.backup_set_mode('backup');
```

The next cron tick can claim and send real campaign email. While backup mode is active, the database blocks n8n from claiming a new batch even if EC2 comes back. Existing campaign pauses and inbox restrictions still apply.

To hand back to n8n, first drain the backup and then restore primary mode.

```sql
select outreach_private.backup_set_mode('draining');
select outreach_private.backup_invoke('preview');
```

Wait for active backup jobs to clear, then run:

```sql
select outreach_private.backup_set_mode('primary');
```

If the database reports that jobs are still draining, leave the mode as `draining` and retry after the existing jobs finish. Resume n8n after the switch returns `primary`.

## Install and verify

1. Use the existing Poutreach Supabase project. The V5.4.5 dispatch, email reservation and send guard tables and the `pg_cron` and `pg_net` extensions must already exist.
2. Apply `sql/install.sql` once. It creates the handoff switch in `primary` mode. The scheduler is idle in this mode. Set `project_url` and `sender_url` in `outreach_private.backup_worker_control` to the existing project origin and the V5.4.5 Netlify send endpoint. Leave the generated scheduler token in the database.
3. Deploy the files in `supabase/functions/outreach-backup-worker/` as the `outreach-backup-worker` Edge Function. The function uses its own scheduler-token authentication backed by a service-only RPC. The Edge gateway JWT check is disabled for this function. Supabase supplies the project URL and service-role key to the runtime.
4. Invoke `outreach_private.backup_invoke('preview')` and `outreach_private.backup_invoke('sender_health')`. The sender check uses an HTTP GET and cannot send mail. A transport-only check does not verify a mailbox's SMTP credentials. Use a controlled inbox before enabling live delivery.
5. Run the offline tests with Node.js 22 or newer.

```sh
node --test backup-worker/tests/*.test.mjs
```

Runtime secrets, SMTP credentials, and lead data stay out of this folder. The worker logs only counts and generic error codes.
