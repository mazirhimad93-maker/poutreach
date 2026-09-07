/*
  # Create Backend Integration Tables

  1. New Tables
    - `campaign_sequences` - Message sequence steps for campaigns
    - `conversation_history` - All message logs and call records  
    - `training_resources` - AI training materials (notes, links, files)
    - `bookings` - Booking records and status
    - `lead_sequence_progress` - Progress tracking for lead sequences
    - `lead_activity_history` - Activity history for leads

  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated users to manage their own data
    - Users can only access data they own or that belongs to their campaigns

  3. Indexes
    - Add indexes for frequently queried columns
    - Optimize for campaign and lead lookups
*/

-- First, ensure we have the required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create update function first
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Campaign Sequences Table
CREATE TABLE IF NOT EXISTS campaign_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  step_number integer NOT NULL,
  type text NOT NULL CHECK (type IN ('call', 'sms', 'whatsapp')),
  wait_seconds integer DEFAULT 0,
  created_at timestamptz DEFAULT timezone('utc'::text, now())
);

-- Add foreign key constraint only if it doesn't exist and campaigns table exists
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

ALTER TABLE campaign_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage sequences for their campaigns" ON campaign_sequences;
CREATE POLICY "Users can manage sequences for their campaigns"
  ON campaign_sequences
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM campaigns 
      WHERE campaigns.id = campaign_sequences.campaign_id 
      AND campaigns.user_id = auth.uid()
    )
  );

-- Conversation History Table
CREATE TABLE IF NOT EXISTS conversation_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('vapi', 'sms', 'whatsapp')),
  from_role text NOT NULL CHECK (from_role IN ('ai', 'lead')),
  message text NOT NULL,
  timestamp timestamptz DEFAULT timezone('utc'::text, now())
);

-- Add foreign key constraints only if they don't exist and referenced tables exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'leads') 
     AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                     WHERE constraint_name = 'conversation_history_lead_id_fkey' 
                     AND table_name = 'conversation_history') THEN
    ALTER TABLE conversation_history 
    ADD CONSTRAINT conversation_history_lead_id_fkey 
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'campaigns') 
     AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                     WHERE constraint_name = 'conversation_history_campaign_id_fkey' 
                     AND table_name = 'conversation_history') THEN
    ALTER TABLE conversation_history 
    ADD CONSTRAINT conversation_history_campaign_id_fkey 
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE conversation_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view conversation history for their campaigns" ON conversation_history;
CREATE POLICY "Users can view conversation history for their campaigns"
  ON conversation_history
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM campaigns 
      WHERE campaigns.id = conversation_history.campaign_id 
      AND campaigns.user_id = auth.uid()
    )
  );

-- Training Resources Table
CREATE TABLE IF NOT EXISTS training_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  user_id uuid,
  type text NOT NULL CHECK (type IN ('note', 'url', 'file')),
  content text NOT NULL,
  created_at timestamptz DEFAULT timezone('utc'::text, now())
);

-- Add foreign key constraint only if it doesn't exist and campaigns table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'campaigns') 
     AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                     WHERE constraint_name = 'training_resources_campaign_id_fkey' 
                     AND table_name = 'training_resources') THEN
    ALTER TABLE training_resources 
    ADD CONSTRAINT training_resources_campaign_id_fkey 
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE training_resources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage training resources for their campaigns" ON training_resources;
CREATE POLICY "Users can manage training resources for their campaigns"
  ON training_resources
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM campaigns 
      WHERE campaigns.id = training_resources.campaign_id 
      AND campaigns.user_id = auth.uid()
    )
  );

-- Bookings Table
CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid,
  user_id uuid,
  lead_id uuid,
  calendar_link text,
  recording_url text,
  created_at timestamptz DEFAULT now(),
  processed boolean DEFAULT false
);

-- Add foreign key constraints only if they don't exist and referenced tables exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'campaigns') 
     AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                     WHERE constraint_name = 'bookings_campaign_id_fkey' 
                     AND table_name = 'bookings') THEN
    ALTER TABLE bookings 
    ADD CONSTRAINT bookings_campaign_id_fkey 
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') 
     AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                     WHERE constraint_name = 'bookings_user_id_fkey' 
                     AND table_name = 'bookings') THEN
    ALTER TABLE bookings 
    ADD CONSTRAINT bookings_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'leads') 
     AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                     WHERE constraint_name = 'bookings_lead_id_fkey' 
                     AND table_name = 'bookings') THEN
    ALTER TABLE bookings 
    ADD CONSTRAINT bookings_lead_id_fkey 
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own bookings" ON bookings;
CREATE POLICY "Users can manage their own bookings"
  ON bookings
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid());

-- Lead Sequence Progress Table
CREATE TABLE IF NOT EXISTS lead_sequence_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  current_step integer DEFAULT 0,
  status text DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  last_executed timestamptz DEFAULT timezone('utc'::text, now()),
  next_at timestamptz,
  created_at timestamptz DEFAULT timezone('utc'::text, now())
);

-- Add foreign key constraints only if they don't exist and referenced tables exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'leads') 
     AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                     WHERE constraint_name = 'lead_sequence_progress_lead_id_fkey' 
                     AND table_name = 'lead_sequence_progress') THEN
    ALTER TABLE lead_sequence_progress 
    ADD CONSTRAINT lead_sequence_progress_lead_id_fkey 
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
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

ALTER TABLE lead_sequence_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage sequence progress for their campaigns" ON lead_sequence_progress;
CREATE POLICY "Users can manage sequence progress for their campaigns"
  ON lead_sequence_progress
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM campaigns 
      WHERE campaigns.id = lead_sequence_progress.campaign_id 
      AND campaigns.user_id = auth.uid()
    )
  );

-- Lead Activity History Table
CREATE TABLE IF NOT EXISTS lead_activity_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid,
  campaign_id uuid,
  status text,
  started_at timestamp without time zone,
  ended_at timestamp without time zone,
  call_duration integer,
  recording_url text,
  created_at timestamp without time zone DEFAULT now(),
  user_id uuid,
  notes text,
  type text,
  channel_response text,
  executed_at timestamptz DEFAULT timezone('utc'::text, now())
);

-- Add foreign key constraints only if they don't exist and referenced tables exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'leads') 
     AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                     WHERE constraint_name = 'lead_activity_history_lead_id_fkey' 
                     AND table_name = 'lead_activity_history') THEN
    ALTER TABLE lead_activity_history 
    ADD CONSTRAINT lead_activity_history_lead_id_fkey 
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'campaigns') 
     AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                     WHERE constraint_name = 'lead_activity_history_campaign_id_fkey' 
                     AND table_name = 'lead_activity_history') THEN
    ALTER TABLE lead_activity_history 
    ADD CONSTRAINT lead_activity_history_campaign_id_fkey 
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE lead_activity_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view activity history for their campaigns" ON lead_activity_history;
CREATE POLICY "Users can view activity history for their campaigns"
  ON lead_activity_history
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM campaigns 
      WHERE campaigns.id = lead_activity_history.campaign_id 
      AND campaigns.user_id = auth.uid()
    )
  );

-- Indexes for better performance (only create if they don't exist)
CREATE INDEX IF NOT EXISTS idx_campaign_sequences_campaign_id ON campaign_sequences(campaign_id);
CREATE INDEX IF NOT EXISTS idx_conversation_history_lead_campaign ON conversation_history(lead_id, campaign_id);
CREATE INDEX IF NOT EXISTS idx_training_resources_campaign_id ON training_resources(campaign_id);
CREATE INDEX IF NOT EXISTS idx_bookings_user_id ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_lead_sequence_progress_campaign_id ON lead_sequence_progress(campaign_id);
CREATE INDEX IF NOT EXISTS idx_lead_activity_history_campaign_id ON lead_activity_history(campaign_id);

-- Add triggers for updated_at columns where needed (only if they don't exist)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'campaigns') 
     AND NOT EXISTS (SELECT 1 FROM information_schema.triggers 
                     WHERE trigger_name = 'update_campaigns_updated_at_trigger' 
                     AND event_object_table = 'campaigns') THEN
    CREATE TRIGGER update_campaigns_updated_at_trigger
      BEFORE UPDATE ON campaigns
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'uploaded_leads') 
     AND NOT EXISTS (SELECT 1 FROM information_schema.triggers 
                     WHERE trigger_name = 'update_uploaded_leads_updated_at_trigger' 
                     AND event_object_table = 'uploaded_leads') THEN
    CREATE TRIGGER update_uploaded_leads_updated_at_trigger
      BEFORE UPDATE ON uploaded_leads
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;