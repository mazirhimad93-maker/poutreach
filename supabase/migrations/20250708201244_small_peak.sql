/*
  # Campaign Publishing Setup

  1. New Tables & Updates
    - Add prompt column to campaign_sequences
    - Ensure proper constraints and defaults
    - Add user_twilio_settings table if missing

  2. Security
    - Maintain existing RLS policies
    - Ensure proper foreign key relationships

  3. Indexes
    - Add performance indexes for campaign publishing queries
*/

-- Add prompt column to campaign_sequences if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'campaign_sequences' AND column_name = 'prompt') THEN
    ALTER TABLE campaign_sequences ADD COLUMN prompt text;
  END IF;
END $$;

-- Create user_twilio_settings table if it doesn't exist
CREATE TABLE IF NOT EXISTS user_twilio_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  twilio_sid text NOT NULL,
  twilio_auth_token text NOT NULL,
  sms_number text,
  whatsapp_number text,
  vapi_number text,
  created_at timestamptz DEFAULT timezone('utc'::text, now())
);

-- Add foreign key constraint for user_twilio_settings if it doesn't exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') 
     AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                     WHERE constraint_name = 'user_twilio_settings_user_id_fkey' 
                     AND table_name = 'user_twilio_settings') THEN
    ALTER TABLE user_twilio_settings 
    ADD CONSTRAINT user_twilio_settings_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Enable RLS on user_twilio_settings
ALTER TABLE user_twilio_settings ENABLE ROW LEVEL SECURITY;

-- Create policy for users to manage their own Twilio settings
DROP POLICY IF EXISTS "Users can manage their own Twilio settings" ON user_twilio_settings;
CREATE POLICY "Users can manage their own Twilio settings"
  ON user_twilio_settings
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid());

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_user_twilio_settings_user_id ON user_twilio_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_campaign_sequences_campaign_step ON campaign_sequences(campaign_id, step_number);
CREATE INDEX IF NOT EXISTS idx_lead_sequence_progress_status ON lead_sequence_progress(status);
CREATE INDEX IF NOT EXISTS idx_lead_sequence_progress_ready ON lead_sequence_progress(campaign_id, status) WHERE status = 'ready';

-- Update campaign_sequences constraint to include the new prompt column
ALTER TABLE campaign_sequences ALTER COLUMN type SET DEFAULT 'call';
ALTER TABLE campaign_sequences ALTER COLUMN step_number SET DEFAULT 1;
ALTER TABLE campaign_sequences ALTER COLUMN wait_seconds SET DEFAULT 0;

-- Ensure leads table has proper defaults
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'leads') THEN
    ALTER TABLE leads ALTER COLUMN status SET DEFAULT 'not_called';
  END IF;
END $$;

-- Add campaign publishing validation function
CREATE OR REPLACE FUNCTION validate_campaign_for_publishing(campaign_uuid uuid)
RETURNS TABLE(is_valid boolean, errors text[]) AS $$
DECLARE
  error_list text[] := '{}';
  lead_count integer;
  sequence_count integer;
  resource_count integer;
BEGIN
  -- Check if campaign has leads
  SELECT COUNT(*) INTO lead_count
  FROM uploaded_leads 
  WHERE campaign_id = campaign_uuid;
  
  IF lead_count = 0 THEN
    error_list := array_append(error_list, 'Campaign must have at least one lead');
  END IF;
  
  -- Check if campaign has sequences
  SELECT COUNT(*) INTO sequence_count
  FROM campaign_sequences 
  WHERE campaign_id = campaign_uuid;
  
  IF sequence_count = 0 THEN
    error_list := array_append(error_list, 'Campaign must have at least one sequence step');
  END IF;
  
  -- Check if campaign has training resources
  SELECT COUNT(*) INTO resource_count
  FROM training_resources 
  WHERE campaign_id = campaign_uuid;
  
  IF resource_count = 0 THEN
    error_list := array_append(error_list, 'Campaign must have at least one training resource');
  END IF;
  
  RETURN QUERY SELECT (array_length(error_list, 1) IS NULL), error_list;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;