/*
  # Add user_id to campaign_sequences table

  1. Changes
    - Add user_id column to campaign_sequences table
    - Add foreign key constraint to users table
    - Update RLS policy to include user_id check
    - Add index for better performance

  2. Security
    - Maintain existing RLS policies
    - Ensure users can only access their own sequences
*/

-- Add user_id column to campaign_sequences if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'campaign_sequences' AND column_name = 'user_id') THEN
    ALTER TABLE campaign_sequences ADD COLUMN user_id uuid;
  END IF;
END $$;

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

-- Update existing records to have user_id from their campaigns
UPDATE campaign_sequences 
SET user_id = campaigns.user_id 
FROM campaigns 
WHERE campaign_sequences.campaign_id = campaigns.id 
AND campaign_sequences.user_id IS NULL;

-- Update RLS policy to include user_id check for better performance
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

-- Add index for user_id for better performance
CREATE INDEX IF NOT EXISTS idx_campaign_sequences_user_id ON campaign_sequences(user_id);