import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Please check your .env file.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          full_name: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string | null;
          created_at?: string;
        };
      };
      memberships: {
        Row: {
          id: string;
          user_id: string | null;
          role: 'owner' | 'member' | 'admin' | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          role?: 'owner' | 'member' | 'admin' | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          role?: 'owner' | 'member' | 'admin' | null;
          created_at?: string;
        };
      };
      campaigns: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          description: string | null;
          avatar: string | null;
          offer: string | null;
          calendar_url: string | null;
          goal: string | null;
          status: string | null;
          created_at: string;
          updated_at: string;
          weekly_call_limit: number | null;
          weekly_sms_limit: number | null;
          weekly_whatsapp_limit: number | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          name?: string;
          description?: string | null;
          avatar?: string | null;
          offer?: string | null;
          calendar_url?: string | null;
          goal?: string | null;
          status?: string | null;
          created_at?: string;
          updated_at?: string;
          weekly_call_limit?: number | null;
          weekly_sms_limit?: number | null;
          weekly_whatsapp_limit?: number | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          description?: string | null;
          avatar?: string | null;
          offer?: string | null;
          calendar_url?: string | null;
          goal?: string | null;
          status?: string | null;
          created_at?: string;
          updated_at?: string;
          weekly_call_limit?: number | null;
          weekly_sms_limit?: number | null;
          weekly_whatsapp_limit?: number | null;
        };
      };
      campaign_sequences: {
        Row: {
          id: string;
          campaign_id: string;
          step_number: number;
          type: 'call' | 'sms' | 'whatsapp';
          wait_seconds: number | null;
          created_at: string;
          prompt: string | null;
          user_id: string | null;
        };
        Insert: {
          id?: string;
          campaign_id: string;
          step_number?: number;
          type?: 'call' | 'sms' | 'whatsapp';
          wait_seconds?: number | null;
          created_at?: string;
          prompt?: string | null;
          user_id?: string | null;
        };
        Update: {
          id?: string;
          campaign_id?: string;
          step_number?: number;
          type?: 'call' | 'sms' | 'whatsapp';
          wait_seconds?: number | null;
          created_at?: string;
          prompt?: string | null;
          user_id?: string | null;
        };
      };
      conversation_history: {
        Row: {
          id: string;
          lead_id: string;
          campaign_id: string;
          channel: 'vapi' | 'sms' | 'whatsapp';
          from_role: 'ai' | 'lead';
          message: string;
          timestamp: string | null;
        };
        Insert: {
          id?: string;
          lead_id: string;
          campaign_id: string;
          channel: 'vapi' | 'sms' | 'whatsapp';
          from_role: 'ai' | 'lead';
          message: string;
          timestamp?: string | null;
        };
        Update: {
          id?: string;
          lead_id?: string;
          campaign_id?: string;
          channel?: 'vapi' | 'sms' | 'whatsapp';
          from_role?: 'ai' | 'lead';
          message?: string;
          timestamp?: string | null;
        };
      };
      training_resources: {
        Row: {
          id: string;
          campaign_id: string;
          user_id: string | null;
          type: 'note' | 'url' | 'file';
          content: string;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          campaign_id: string;
          user_id?: string | null;
          type: 'note' | 'url' | 'file';
          content: string;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          campaign_id?: string;
          user_id?: string | null;
          type?: 'note' | 'url' | 'file';
          content?: string;
          created_at?: string | null;
        };
      };
      bookings: {
        Row: {
          id: string;
          campaign_id: string | null;
          user_id: string | null;
          lead_id: string | null;
          calendar_link: string | null;
          recording_url: string | null;
          created_at: string;
          processed: boolean | null;
        };
        Insert: {
          id?: string;
          campaign_id?: string | null;
          user_id?: string | null;
          lead_id?: string | null;
          calendar_link?: string | null;
          recording_url?: string | null;
          created_at?: string;
          processed?: boolean | null;
        };
        Update: {
          id?: string;
          campaign_id?: string | null;
          user_id?: string | null;
          lead_id?: string | null;
          calendar_link?: string | null;
          recording_url?: string | null;
          created_at?: string;
          processed?: boolean | null;
        };
      };
      lead_sequence_progress: {
        Row: {
          id: string;
          lead_id: string;
          campaign_id: string;
          step: number | null;
          status: string | null;
          last_contacted_at: string | null;
          next_at: string | null;
          created_at: string;
          user_id: string | null;
        };
        Insert: {
          id?: string;
          lead_id: string;
          campaign_id: string;
          step?: number | null;
          status?: string | null;
          last_contacted_at?: string | null;
          next_at?: string | null;
          created_at?: string;
          user_id?: string | null;
        };
        Update: {
          id?: string;
          lead_id?: string;
          campaign_id?: string;
          step?: number | null;
          status?: string | null;
          last_contacted_at?: string | null;
          next_at?: string | null;
          created_at?: string;
          user_id?: string | null;
        };
      };
      uploaded_leads: {
        Row: {
          id: string;
          user_id: string | null;
          campaign_id: string | null;
          name: string | null;
          phone: string;
          email: string | null;
          company_name: string | null;
          job_title: string | null;
          source_url: string | null;
          source_platform: string | null;
          status: string | null;
          booking_url: string | null;
          vapi_call_id: string | null;
          twilio_sms_status: string | null;
          retries: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          campaign_id?: string | null;
          name?: string | null;
          phone: string;
          email?: string | null;
          company_name?: string | null;
          job_title?: string | null;
          source_url?: string | null;
          source_platform?: string | null;
          status?: string | null;
          booking_url?: string | null;
          vapi_call_id?: string | null;
          twilio_sms_status?: string | null;
          retries?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          campaign_id?: string | null;
          name?: string | null;
          phone?: string;
          email?: string | null;
          company_name?: string | null;
          job_title?: string | null;
          source_url?: string | null;
          source_platform?: string | null;
          status?: string | null;
          booking_url?: string | null;
          vapi_call_id?: string | null;
          twilio_sms_status?: string | null;
          retries?: number | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      leads: {
        Row: {
          id: string;
          campaign_id: string | null;
          name: string | null;
          phone: string | null;
          status: string | null;
          booking_url: string | null;
          created_at: string;
          user_id: string | null;
          calls_made_this_week: number | null;
          sms_sent_this_week: number | null;
          whatsapp_sent_this_week: number | null;
          last_called_at: string | null;
          last_sms_sent_at: string | null;
          last_whatsapp_sent_at: string | null;
          replied: boolean | null;
        };
        Insert: {
          id?: string;
          campaign_id?: string | null;
          name?: string | null;
          phone?: string | null;
          status?: string | null;
          booking_url?: string | null;
          created_at?: string;
          user_id?: string | null;
          calls_made_this_week?: number | null;
          sms_sent_this_week?: number | null;
          whatsapp_sent_this_week?: number | null;
          last_called_at?: string | null;
          last_sms_sent_at?: string | null;
          last_whatsapp_sent_at?: string | null;
          replied?: boolean | null;
        };
        Update: {
          id?: string;
          campaign_id?: string | null;
          name?: string | null;
          phone?: string | null;
          status?: string | null;
          booking_url?: string | null;
          created_at?: string;
          user_id?: string | null;
          calls_made_this_week?: number | null;
          sms_sent_this_week?: number | null;
          whatsapp_sent_this_week?: number | null;
          last_called_at?: string | null;
          last_sms_sent_at?: string | null;
          last_whatsapp_sent_at?: string | null;
          replied?: boolean | null;
        };
      };
      channels: {
        Row: {
          id: string;
          user_id: string;
          provider: string;
          channel_type: string;
          credentials: any;
          sender_id: string | null;
          is_active: boolean | null;
          last_used_at: string | null;
          created_at: string;
          updated_at: string;
          usage_count: number | null;
          max_usage: number | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          provider: string;
          channel_type: string;
          credentials: any;
          sender_id?: string | null;
          is_active?: boolean | null;
          last_used_at?: string | null;
          created_at?: string;
          updated_at?: string;
          usage_count?: number | null;
          max_usage?: number | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          provider?: string;
          channel_type?: string;
          credentials?: any;
          sender_id?: string | null;
          is_active?: boolean | null;
          last_used_at?: string | null;
          created_at?: string;
          updated_at?: string;
          usage_count?: number | null;
          max_usage?: number | null;
        };
      };
      user_twilio_settings: {
        Row: {
          id: string;
          user_id: string;
          twilio_sid: string;
          twilio_auth_token: string;
          sms_number: string | null;
          whatsapp_number: string | null;
          vapi_number: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          twilio_sid: string;
          twilio_auth_token: string;
          sms_number?: string | null;
          whatsapp_number?: string | null;
          vapi_number?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          twilio_sid?: string;
          twilio_auth_token?: string;
          sms_number?: string | null;
          whatsapp_number?: string | null;
          vapi_number?: string | null;
          created_at?: string | null;
        };
      };
      lead_activity_history: {
        Row: {
          id: string;
          lead_id: string | null;
          campaign_id: string | null;
          status: string | null;
          started_at: string | null;
          ended_at: string | null;
          call_duration: number | null;
          recording_url: string | null;
          created_at: string | null;
          user_id: string | null;
          notes: string | null;
          type: string | null;
          channel_response: string | null;
          executed_at: string | null;
        };
        Insert: {
          id?: string;
          lead_id?: string | null;
          campaign_id?: string | null;
          status?: string | null;
          started_at?: string | null;
          ended_at?: string | null;
          call_duration?: number | null;
          recording_url?: string | null;
          created_at?: string | null;
          user_id?: string | null;
          notes?: string | null;
          type?: string | null;
          channel_response?: string | null;
          executed_at?: string | null;
        };
        Update: {
          id?: string;
          lead_id?: string | null;
          campaign_id?: string | null;
          status?: string | null;
          started_at?: string | null;
          ended_at?: string | null;
          call_duration?: number | null;
          recording_url?: string | null;
          created_at?: string | null;
          user_id?: string | null;
          notes?: string | null;
          type?: string | null;
          channel_response?: string | null;
          executed_at?: string | null;
        };
      };
      campaign_prompts: {
        Row: {
          id: string;
          campaign_id: string;
          user_id: string;
          prompt: string;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          campaign_id: string;
          user_id: string;
          prompt: string;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          campaign_id?: string;
          user_id?: string;
          prompt?: string;
          created_at?: string | null;
          updated_at?: string | null;
        };
      };
    };
  };
};