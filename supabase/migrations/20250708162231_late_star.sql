/*
  # Fix lead_sequence_progress table structure

  1. Changes
    - Update lead_sequence_progress table to match the expected structure
    - Add missing columns and fix column names
    - Ensure proper constraints and indexes

  2. Security
    - Maintain existing RLS policies
    - Ensure users can only access their own data
*/

-- Update the lead_sequence_progress table structure
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

  -- Update status column to use 'ready' instead of 'queued'
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'lead_sequence_progress' AND column_name = 'status') THEN
    -- Update existing constraint
    ALTER TABLE lead_sequence_progress DROP CONSTRAINT IF EXISTS lead_sequence_progress_status_check;
    ALTER TABLE lead_sequence_progress ADD CONSTRAINT lead_sequence_progress_status_check 
      CHECK (status IN ('ready', 'running', 'done', 'failed', 'queued'));
  END IF;

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

  -- Add foreign key constraint for user_id if it doesn't exist
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') 
     AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                     WHERE constraint_name = 'lead_sequence_progress_user_id_fkey' 
                     AND table_name = 'lead_sequence_progress') THEN
    ALTER TABLE lead_sequence_progress 
    ADD CONSTRAINT lead_sequence_progress_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Update RLS policy to include user_id check
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

-- Add index for user_id if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_lead_sequence_progress_user_id ON lead_sequence_progress(user_id);