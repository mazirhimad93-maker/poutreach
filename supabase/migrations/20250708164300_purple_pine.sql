/*
  # Create channels table for communication channel management

  1. New Tables
    - `channels` - Store communication channel configurations (VAPI, Twilio, Instantly)

  2. Security
    - Enable RLS on channels table
    - Add policy for users to manage their own channels

  3. Structure
    - Support for multiple providers (vapi, twilio, instantly)
    - Store encrypted credentials
    - Track usage and limits
*/

-- Create channels table if it doesn't exist
CREATE TABLE IF NOT EXISTS channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('vapi', 'twilio', 'instantly')),
  channel_type text NOT NULL CHECK (channel_type IN ('voice', 'sms', 'whatsapp', 'email')),
  credentials jsonb NOT NULL DEFAULT '{}',
  sender_id text,
  is_active boolean DEFAULT true,
  usage_count integer DEFAULT 0,
  max_usage integer DEFAULT 1000,
  created_at timestamptz DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz DEFAULT timezone('utc'::text, now())
);

-- Add foreign key constraint for user_id if it doesn't exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') 
     AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                     WHERE constraint_name = 'channels_user_id_fkey' 
                     AND table_name = 'channels') THEN
    ALTER TABLE channels 
    ADD CONSTRAINT channels_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Enable RLS
ALTER TABLE channels ENABLE ROW LEVEL SECURITY;

-- Create policy for users to manage their own channels
DROP POLICY IF EXISTS "Users can manage their own channels" ON channels;
CREATE POLICY "Users can manage their own channels"
  ON channels
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid());

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_channels_user_id ON channels(user_id);
CREATE INDEX IF NOT EXISTS idx_channels_provider_type ON channels(provider, channel_type);

-- Add trigger for updated_at
DROP TRIGGER IF EXISTS update_channels_updated_at_trigger ON channels;
CREATE TRIGGER update_channels_updated_at_trigger
  BEFORE UPDATE ON channels
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();