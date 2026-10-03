CREATE OR REPLACE FUNCTION public.sync_uploaded_leads_to_list()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  campaign_list_id UUID;
BEGIN
  -- Find the list that corresponds to this campaign
  SELECT l.id INTO campaign_list_id
  FROM public.lists l
  JOIN public.campaigns c ON (
    l.user_id = c.user_id AND 
    (l.name = c.name OR l.name = c.offer OR l.name = 'Campaign List') AND
    l.tags @> ARRAY['campaign', 'auto-created']
  )
  WHERE c.id = NEW.campaign_id
  LIMIT 1;
  
  -- If we found a matching campaign list, sync the lead
  IF campaign_list_id IS NOT NULL THEN
    -- Check if lead already exists in the list (prevent duplicates)
    IF NOT EXISTS (
      SELECT 1 FROM public.list_leads 
      WHERE list_id = campaign_list_id 
      AND user_id = NEW.user_id
      AND (
        (email IS NOT NULL AND email = NEW.email) OR
        (phone IS NOT NULL AND phone = NEW.phone AND phone != '')
      )
    ) THEN
      -- Insert into list_leads
      INSERT INTO public.list_leads (
        list_id,
        user_id,
        name,
        email,
        phone,
        company_name,
        job_title,
        source_url,
        source_platform,
        custom_fields,
        lead_intelligence,
        created_at,
        updated_at
      ) VALUES (
        campaign_list_id,
        NEW.user_id,
        NEW.name,
        NEW.email,
        NEW.phone,
        NEW.company_name,
        NEW.job_title,
        NEW.source_url,
        NEW.source_platform,
        '{}',
        NEW.lead_intelligence,
        NEW.created_at,
        NEW.updated_at
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$function$;
