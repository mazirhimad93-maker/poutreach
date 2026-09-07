/*
  # Fix campaign_sequences table alignment

  1. Changes
    - Ensure all required columns exist with proper types
    - Fix column constraints and defaults
    - Update RLS policies to match application expectations
    - Add missing indexes for performance

  2. Security
    - Maintain proper RLS policies
    - Ensure users can only access their own data
*/

-- Ensure the campaign_sequences table has all required columns
DO $$
BEGIN
  -- Add user_id column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'campaign_sequences' AND column_name = 'user_id') THEN
    ALTER TABLE campaign_sequences ADD COLUMN user_id uuid;
  END IF;

  -- Add prompt column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'campaign_sequences' AND column_name = 'prompt') THEN
    ALTER TABLE campaign_sequences ADD COLUMN prompt text;
  END IF;

  -- Ensure step_number has proper default
  ALTER TABLE campaign_sequences ALTER COLUMN step_number SET DEFAULT 1;
  
  -- Ensure type has proper default and constraint
  ALTER TABLE campaign_sequences ALTER COLUMN type SET DEFAULT 'call';
  
  -- Update type constraint to match application expectations
  ALTER TABLE campaign_sequences DROP CONSTRAINT IF EXISTS campaign_sequences_type_check;
  ALTER TABLE campaign_sequences ADD CONSTRAINT campaign_sequences_type_check 
    CHECK (type IN ('call', 'sms', 'whatsapp'));
  
  -- Ensure wait_seconds has proper default
  ALTER TABLE campaign_sequences ALTER COLUMN wait_seconds SET DEFAULT 0;
END $$;

-- Update existing records to have user_id from their campaigns if missing
UPDATE campaign_sequences 
SET user_id = campaigns.user_id 
FROM campaigns 
WHERE campaign_sequences.campaign_id = campaigns.id 
AND campaign_sequences.user_id IS NULL;

-- Add foreign key constraint for user_id if it doesn't exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') 
     AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                     WHERE constraint_name = 'campaign_sequences_user_id_fkey' 
                     AND table_name = 'campaign_sequences') THEN
    ALTER TABLE campaign_sequences 
    ADD CONSTRAINT campaign_sequences_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Ensure campaign_id foreign key exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'campaigns') 
     AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                     WHERE constraint_name = 'campaign_sequences_campaign_id_fkey' 
                     AND table_name = 'campaign_sequences') THEN
    ALTER TABLE campaign_sequences 
    ADD CONSTRAINT campaign_sequences_campaign_id_fkey 
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Update RLS policy to properly handle user access
DROP POLICY IF EXISTS "Users can manage sequences for their campaigns" ON campaign_sequences;
CREATE POLICY "Users can manage sequences for their campaigns"
  ON campaign_sequences
  FOR ALL
  TO authenticated
  USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM campaigns 
      WHERE campaigns.id = campaign_sequences.campaign_id 
      AND campaigns.user_id = auth.uid()
    )
  );

-- Add performance indexes
CREATE INDEX IF NOT EXISTS idx_campaign_sequences_user_id ON campaign_sequences(user_id);
CREATE INDEX IF NOT EXISTS idx_campaign_sequences_campaign_id ON campaign_sequences(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_sequences_campaign_step ON campaign_sequences(campaign_id, step_number);

-- Ensure lead_sequence_progress table is properly aligned
DO $$
BEGIN
  -- Add user_id column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'lead_sequence_progress' AND column_name = 'user_id') THEN
    ALTER TABLE lead_sequence_progress ADD COLUMN user_id uuid;
  END IF;

  -- Rename current_step to step if needed
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'lead_sequence_progress' AND column_name = 'current_step')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns 
                     WHERE table_name = 'lead_sequence_progress' AND column_name = 'step') THEN
    ALTER TABLE lead_sequence_progress RENAME COLUMN current_step TO step;
  END IF;

  -- Add step column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'lead_sequence_progress' AND column_name = 'step') THEN
    ALTER TABLE lead_sequence_progress ADD COLUMN step integer DEFAULT 1;
  END IF;

  -- Update status constraint to include 'ready'
  ALTER TABLE lead_sequence_progress DROP CONSTRAINT IF EXISTS lead_sequence_progress_status_check;
  ALTER TABLE lead_sequence_progress ADD CONSTRAINT lead_sequence_progress_status_check 
    CHECK (status IN ('ready', 'running', 'done', 'failed', 'queued'));

  -- Rename last_executed to last_contacted_at if needed
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'lead_sequence_progress' AND column_name = 'last_executed')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns 
                     WHERE table_name = 'lead_sequence_progress' AND column_name = 'last_contacted_at') THEN
    ALTER TABLE lead_sequence_progress RENAME COLUMN last_executed TO last_contacted_at;
  END IF;

  -- Add last_contacted_at column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'lead_sequence_progress' AND column_name = 'last_contacted_at') THEN
    ALTER TABLE lead_sequence_progress ADD COLUMN last_contacted_at timestamptz;
  END IF;
END $$;

-- Update existing lead_sequence_progress records to have user_id from their campaigns if missing
UPDATE lead_sequence_progress 
SET user_id = campaigns.user_id 
FROM campaigns 
WHERE lead_sequence_progress.campaign_id = campaigns.id 
AND lead_sequence_progress.user_id IS NULL;

-- Add foreign key constraint for user_id in lead_sequence_progress if it doesn't exist
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
END $$;

-- Update RLS policy for lead_sequence_progress
DROP POLICY IF EXISTS "Users can manage sequence progress for their campaigns" ON lead_sequence_progress;
CREATE POLICY "Users can manage sequence progress for their campaigns"
  ON lead_sequence_progress
  FOR ALL
  TO authenticated
  USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM campaigns 
      WHERE campaigns.id = lead_sequence_progress.campaign_id 
      AND campaigns.user_id = auth.uid()
    )
  );

-- Add performance indexes for lead_sequence_progress
CREATE INDEX IF NOT EXISTS idx_lead_sequence_progress_user_id ON lead_sequence_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_lead_sequence_progress_status ON lead_sequence_progress(status);
CREATE INDEX IF NOT EXISTS idx_lead_sequence_progress_ready ON lead_sequence_progress(campaign_id, status) WHERE status = 'ready';