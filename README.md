# Cold Outreach SaaS

## Sequence Builder System

### How It Works

1. **Sequence Creation**: Users build multi-step sequences in the Sequence Builder using their connected channels (Vapi, Twilio, etc.)

2. **Pre-scheduling**: When a campaign is published, the system generates ALL sequence steps for ALL leads with pre-calculated timestamps:
   - Step 1: `next_at = now()` (ready immediately)
   - Step 2: `next_at = now() + wait_seconds` 
   - Step 3: `next_at = step2_time + wait_seconds`
   - etc.

3. **n8n Execution**: n8n simply queries for ready tasks and executes them:
   ```sql
   SELECT * FROM ready_sequence_tasks 
   WHERE next_at <= NOW() 
   LIMIT 10;
   ```

4. **Step Completion**: When n8n completes a step, it calls `complete_sequence_step(step_id, success)` which:
   - Marks current step as 'done' or 'failed'
   - Activates the next step (changes status from 'queued' to 'ready')

### Database Schema

- `campaign_sequences`: Template steps (channel, wait_seconds, prompt)
- `lead_sequence_progress`: Individual step instances with timestamps
- `ready_sequence_tasks`: View for n8n to query ready tasks

### Benefits

- ✅ No complex scheduling logic in n8n
- ✅ Exact timing control
- ✅ Easy to pause/resume campaigns
- ✅ Clear audit trail
- ✅ Scalable to millions of leads