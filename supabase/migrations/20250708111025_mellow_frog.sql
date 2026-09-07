/*
  # Fix foreign key relationships for lead_activity_history table

  1. Changes
    - Add foreign key constraint from lead_activity_history.lead_id to leads.id
    - Add foreign key constraint from lead_activity_history.campaign_id to campaigns.id
  
  2. Safety
    - Uses conditional logic to only add constraints if they don't already exist
    - Checks for table existence before adding constraints
*/

DO $$
BEGIN
  -- Add foreign key constraint for lead_id if it doesn't exist
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'leads') 
     AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                     WHERE constraint_name = 'lead_activity_history_lead_id_fkey' 
                     AND table_name = 'lead_activity_history') 
  THEN
    ALTER TABLE lead_activity_history 
    ADD CONSTRAINT lead_activity_history_lead_id_fkey 
    FOREIGN KEY (lead_id) REFERENCES leads(id);
  END IF;
  
  -- Add foreign key constraint for campaign_id if it doesn't exist
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'campaigns') 
     AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                     WHERE constraint_name = 'lead_activity_history_campaign_id_fkey' 
                     AND table_name = 'lead_activity_history')
  THEN
    ALTER TABLE lead_activity_history 
    ADD CONSTRAINT lead_activity_history_campaign_id_fkey 
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id);
  END IF;
END $$;