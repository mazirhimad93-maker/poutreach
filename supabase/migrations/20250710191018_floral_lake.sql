/*
  # Sequence System Enhancement

  1. Updates
    - Ensure lead_sequence_progress table has all required columns
    - Add indexes for efficient querying by n8n
    - Update constraints and defaults

  2. Performance
    - Add indexes for next_at timestamp queries
    - Add indexes for status filtering
    - Optimize for n8n polling queries

  3. Data Integrity
    - Ensure proper foreign key relationships
    - Add constraints for valid status values
*/

-- Ensure lead_sequence_progress table has all required columns
DO $$
BEGIN
  -- Add next_at column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'lead_sequence_progress' AND column_name = 'next_at') THEN
    ALTER TABLE lead_sequence_progress ADD COLUMN next_at timestamptz;
  END IF;

  -- Add step column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'lead_sequence_progress' AND column_name = 'step') THEN
    ALTER TABLE lead_sequence_progress ADD COLUMN step integer DEFAULT 1;
  END IF;

  -- Add user_id column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'lead_sequence_progress' AND column_name = 'user_id') THEN
    ALTER TABLE lead_sequence_progress ADD COLUMN user_id uuid;
  END IF;

  -- Ensure status column has proper constraint
  ALTER TABLE lead_sequence_progress DROP CONSTRAINT IF EXISTS lead_sequence_progress_status_check;
  ALTER TABLE lead_sequence_progress ADD CONSTRAINT lead_sequence_progress_status_check 
    CHECK (status IN ('ready', 'running', 'done', 'failed', 'queued'));

  -- Set default status
  ALTER TABLE lead_sequence_progress ALTER COLUMN status SET DEFAULT 'queued';
END $$;

-- Add foreign key constraints if they don't exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') 
     AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                     WHERE constraint_name = 'lead_sequence_progress_user_id_fkey' 
                     AND table_name = 'lead_sequence_progress') THEN
    ALTER TABLE lead_sequence_progress 
    ADD CONSTRAINT lead_sequence_progress_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'leads') 
     AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                     WHERE constraint_name = 'lead_sequence_progress_lead_id_fkey' 
                     AND table_name = 'lead_sequence_progress') THEN
    ALTER TABLE lead_sequence_progress 
    ADD CONSTRAINT lead_sequence_progress_lead_id_fkey 
    FOREIGN KEY (lead_id) REFERENCES uploaded_leads(id) ON DELETE CASCADE;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'campaigns') 
     AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                     WHERE constraint_name = 'lead_sequence_progress_campaign_id_fkey' 
                     AND table_name = 'lead_sequence_progress') THEN
    ALTER TABLE lead_sequence_progress 
    ADD CONSTRAINT lead_sequence_progress_campaign_id_fkey 
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Add performance indexes for n8n queries
CREATE INDEX IF NOT EXISTS idx_lead_sequence_progress_ready_next_at 
  ON lead_sequence_progress(next_at) 
  WHERE status = 'ready';

CREATE INDEX IF NOT EXISTS idx_lead_sequence_progress_status_next_at 
  ON lead_sequence_progress(status, next_at);

CREATE INDEX IF NOT EXISTS idx_lead_sequence_progress_campaign_status 
  ON lead_sequence_progress(campaign_id, status);

-- Create a view for n8n to easily query ready tasks
CREATE OR REPLACE VIEW ready_sequence_tasks AS
SELECT 
  lsp.id,
  lsp.lead_id,
  lsp.campaign_id,
  lsp.user_id,
  lsp.step,
  lsp.next_at,
  cs.type as channel_type,
  cs.prompt,
  ul.name as lead_name,
  ul.phone as lead_phone,
  ul.email as lead_email,
  c.offer as campaign_offer,
  c.calendar_url as campaign_calendar_url
FROM lead_sequence_progress lsp
JOIN campaign_sequences cs ON cs.campaign_id = lsp.campaign_id AND cs.step_number = lsp.step
JOIN uploaded_leads ul ON ul.id = lsp.lead_id
JOIN campaigns c ON c.id = lsp.campaign_id
WHERE lsp.status = 'ready' 
  AND lsp.next_at <= NOW()
  AND c.status = 'active';

-- Function to mark a sequence step as completed and activate the next step
CREATE OR REPLACE FUNCTION complete_sequence_step(
  step_id uuid,
  success boolean DEFAULT true
) RETURNS void AS $$
DECLARE
  current_step record;
  next_step_number integer;
BEGIN
  -- Get current step info
  SELECT * INTO current_step 
  FROM lead_sequence_progress 
  WHERE id = step_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sequence step not found';
  END IF;
  
  -- Mark current step as done or failed
  UPDATE lead_sequence_progress 
  SET status = CASE WHEN success THEN 'done' ELSE 'failed' END,
      last_contacted_at = NOW()
  WHERE id = step_id;
  
  -- If successful, activate next step
  IF success THEN
    next_step_number := current_step.step + 1;
    
    UPDATE lead_sequence_progress 
    SET status = 'ready'
    WHERE lead_id = current_step.lead_id 
      AND campaign_id = current_step.campaign_id 
      AND step = next_step_number
      AND status = 'queued';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get next ready tasks for n8n (with limit)
CREATE OR REPLACE FUNCTION get_ready_tasks(task_limit integer DEFAULT 10)
RETURNS TABLE(
  id uuid,
  lead_id uuid,
  campaign_id uuid,
  user_id uuid,
  step integer,
  channel_type text,
  prompt text,
  lead_name text,
  lead_phone text,
  lead_email text,
  campaign_offer text,
  campaign_calendar_url text
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    rst.id,
    rst.lead_id,
    rst.campaign_id,
    rst.user_id,
    rst.step,
    rst.channel_type,
    rst.prompt,
    rst.lead_name,
    rst.lead_phone,
    rst.lead_email,
    rst.campaign_offer,
    rst.campaign_calendar_url
  FROM ready_sequence_tasks rst
  ORDER BY rst.next_at ASC
  LIMIT task_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;