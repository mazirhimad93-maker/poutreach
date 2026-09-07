import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { ArrowLeft, Save, Upload, MessageCircle, CheckCircle, XCircle, AlertCircle, Eye, ArrowRight, ArrowDown, Play, Phone, MessageSquare } from 'lucide-react';
import { AITrainer } from './AITrainer';
import { CampaignAnalytics } from './CampaignAnalytics';
import { UploadLeadsTab } from './UploadLeadsTab';
import { SequenceBuilder } from './SequenceBuilder';

interface Campaign {
  id: string;
  avatar: string | null;
  offer: string | null;
  calendar_url: string | null;
  goal: string | null;
  status: string | null;
  created_at: string;
}

interface UploadResult {
  success: boolean;
  message: string;
  leadsCount?: number;
  errors?: string[];
}

interface CSVPreview {
  headers: string[];
  rows: string[][];
  totalRows: number;
}

interface ColumnMapping {
  [dbColumn: string]: string; // Maps database column to CSV column
}

const DATABASE_COLUMNS = [
  { key: 'name', label: 'Name', description: 'Contact\'s full name', required: false },
  { key: 'phone', label: 'Phone Number', description: 'Contact phone number', required: false },
  { key: 'email', label: 'Email Address', description: 'Contact email address', required: false },
  { key: 'company_name', label: 'Company Name', description: 'Company or organization name', required: false },
  { key: 'job_title', label: 'Job Title', description: 'Contact\'s position or role', required: false },
  { key: 'source_url', label: 'Source URL', description: 'Website or profile URL', required: false },
  { key: 'source_platform', label: 'Source Platform', description: 'Platform where contact was found', required: false },
];

export default function EditCampaign() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'analytics' | 'leads' | 'details' | 'training' | 'sequence'>('analytics');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [csvPreview, setCsvPreview] = useState<CSVPreview | null>(null);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({});
  const [showPreview, setShowPreview] = useState(false);
  const [formData, setFormData] = useState({
    offer: '',
    calendar_url: '',
    goal: '',
    status: 'draft',
  });

  useEffect(() => {
    if (id && user) {
      fetchCampaign();
    }
  }, [id, user]);

  const fetchCampaign = async () => {
    if (!id || !user) return;

    try {
      const { data, error } = await supabase
        .from('campaigns')
        .select('*')
        .eq('id', id)
        .eq('user_id', user.id)
        .single();

      if (error) throw error;

      if (data) {
        setCampaign(data);
        setFormData({
          offer: data.offer || '',
          calendar_url: data.calendar_url || '',
          goal: data.goal || '',
          status: data.status || 'draft',
        });
      }
    } catch (error) {
      console.error('Error fetching campaign:', error);
      navigate('/campaigns');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !user) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('campaigns')
        .update(formData)
        .eq('id', id)
        .eq('user_id', user.id);

      if (error) throw error;

      setUploadResult({
        success: true,
        message: 'Campaign updated successfully!'
      });
    } catch (error) {
      console.error('Error updating campaign:', error);
      setUploadResult({
        success: false,
        message: 'Error updating campaign. Please try again.'
      });
    } finally {
      setSaving(false);
    }
  };

  const validateCampaignForPublishing = async (): Promise<string[]> => {
    const errors: string[] = [];
    
    if (!user || !campaign) return ['Campaign or user not found'];

    try {
      // Check if user has connected communication channels
      const { data: channels } = await supabase
        .from('channels')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true);

      if (!channels || channels.length === 0) {
        errors.push('You must connect at least one communication channel before publishing a campaign. Go to Settings > Channels to set up your integrations.');
      }

      // Check if campaign has leads
      const { data: leads } = await supabase
        .from('uploaded_leads')
        .select('id')
        .eq('campaign_id', campaign.id)
        .limit(1);

      if (!leads || leads.length === 0) {
        errors.push('Campaign must have at least one lead before publishing. Upload leads in the "Upload Leads" tab.');
      }

      // Check basic campaign info
      if (!campaign.offer || campaign.offer.trim() === '') {
        errors.push('Campaign must have an offer description.');
      }

      if (!campaign.calendar_url || campaign.calendar_url.trim() === '') {
        errors.push('Campaign must have a calendar URL for booking appointments.');
      }

    } catch (error) {
      console.error('Error validating campaign:', error);
      errors.push('Error validating campaign. Please try again.');
    }

    return errors;
  };

  const setupCampaignDefaults = async (campaignId: string) => {
    if (!user) return;

    const errors: string[] = [];
    try {
      // Get existing training resources to use for prompt generation
      const { data: existingResources } = await supabase
        .from('training_resources')
        .select('content')
        .eq('campaign_id', campaignId)
        .limit(1);

      // Generate prompt from training resources, campaign description, or default
      let promptText = "You are an AI setter. Your job is to contact leads and book them into a calendar.";
      
      if (existingResources && existingResources.length > 0) {
        // Use training resource content
        promptText = existingResources[0].content;
      } else if (campaign?.goal && campaign.goal.trim() !== '') {
        // Use campaign description
        promptText = `You are an AI appointment setter. ${campaign.goal} Your job is to contact leads and book qualified appointments for our offer targeting ${campaign?.offer || 'prospects'}.`;
      } else {
        // Use default with campaign context
        promptText = `You are an AI setter. Your job is to contact leads and book them into a calendar for our offer: ${campaign?.offer || 'our solution'}. Be professional and focus on qualifying prospects.`;
      }

      // 1. Check if campaign_sequences exists, if not create default
      const { data: existingSequences } = await supabase
        .from('campaign_sequences')
        .select('id')
        .eq('campaign_id', campaignId)
        .limit(1);

      if (!existingSequences || existingSequences.length === 0) {
        await supabase
          .from('campaign_sequences')
          .insert({
            campaign_id: campaignId,
            user_id: user.id,
            step_number: 1,
            type: 'call', 
            wait_seconds: 0,
            prompt: promptText
          });
      }

      // 2. Check if training_resources exists, if not create default
      const { data: trainingResources } = await supabase
        .from('training_resources')
        .select('id')
        .eq('campaign_id', campaignId)
        .limit(1);

      if (!trainingResources || trainingResources.length === 0) {
        await supabase
          .from('training_resources')
          .insert({
            campaign_id: campaignId,
            user_id: user.id,
            type: 'note',
            content: promptText
          });
      }

      // 3. Create lead_sequence_progress for all uploaded leads
      const { data: campaignLeads } = await supabase
        .from('uploaded_leads')
        .select('id')
        .eq('campaign_id', campaignId);

      // Ensure all uploaded leads are properly set up for outreach
      if (campaignLeads && campaignLeads.length > 0) {
        // First, insert leads into the leads table if they don't exist
        const leadsToInsert = campaignLeads.map(lead => ({
          id: lead.id,
          campaign_id: campaignId,
          user_id: user.id,
          status: 'not_called'
        }));

        // Use upsert to avoid duplicates
        await supabase
          .from('leads')
          .upsert(leadsToInsert, { onConflict: 'id' });

        // Then create sequence progress entries for automation engine
        const sequenceProgressData = campaignLeads.map(lead => ({
          lead_id: lead.id,
          campaign_id: campaignId,
          user_id: user.id,
          step: 1,
          status: 'ready'
        }));

        // Insert sequence progress entries for each lead
        for (const progressData of sequenceProgressData) {
          const { data: existing } = await supabase
            .from('lead_sequence_progress')
            .select('id')
            .eq('lead_id', progressData.lead_id)
            .eq('campaign_id', progressData.campaign_id)
            .limit(1);

          if (!existing || existing.length === 0) {
            const { error: progressError } = await supabase
              .from('lead_sequence_progress')
              .insert(progressData);
            
            if (progressError) {
              console.error('Error creating sequence progress:', progressError);
              errors.push(`Failed to set up lead ${progressData.lead_id} for outreach`);
            }
          }
        }
      } else {
        errors.push('No leads found to set up for outreach');
      }

    } catch (error) {
      console.error('Error setting up campaign defaults:', error);
      throw error;
    }
    
    if (errors.length > 0) {
      throw new Error(`Setup errors: ${errors.join(', ')}`);
    }
  };

  const handlePublish = async () => {
    if (!id || !user) return;

    // Validate campaign before publishing
    const errors = await validateCampaignForPublishing();
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    setPublishing(true);
    setValidationErrors([]);
    
    try {
      // Setup campaign defaults and validate database requirements
      await setupCampaignDefaults(id);

      // Then update campaign status
      const { error } = await supabase
        .from('campaigns')
        .update({ status: 'active' })
        .eq('id', id)
        .eq('user_id', user.id);

      if (error) throw error;

      // Update local state
      setCampaign(prev => prev ? { ...prev, status: 'active' } : null);
      setFormData(prev => ({ ...prev, status: 'active' }));

      setUploadResult({
        success: true,
        message: 'Campaign published successfully! All leads are now ready for automated outreach with proper sequence steps and AI training.'
      });
    } catch (error) {
      console.error('Error publishing campaign:', error);
      setUploadResult({
        success: false,
        message: 'Error publishing campaign. Please try again.'
      });
    } finally {
      setPublishing(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const clearUploadResult = () => {
    setUploadResult(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="text-center py-12">
        <h3 className="text-lg font-medium text-gray-900 mb-2">
          Campaign not found
        </h3>
        <Link
          to="/campaigns"
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Campaigns
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center space-x-4">
          <Link
            to="/campaigns"
            className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">{campaign.offer || 'Untitled Campaign'}</h1>
            <p className="mt-1 text-sm text-gray-500">
              Campaign ID: {campaign.id}
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
            campaign.status === 'active'
              ? 'bg-green-100 text-green-800'
              : campaign.status === 'paused'
              ? 'bg-yellow-100 text-yellow-800'
              : 'bg-gray-100 text-gray-800'
          }`}>
            {campaign.status || 'Draft'}
          </span>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save
          </button>
          {campaign?.status === 'draft' && (
            <button
              onClick={handlePublish}
              disabled={publishing || validationErrors.length > 0}
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {publishing ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              {publishing ? 'Publishing...' : 'Publish'}
            </button>
          )}
        </div>
      </div>

      {/* Upload Result Message */}
      {uploadResult && (
        <div className={`rounded-lg border p-4 ${
          uploadResult.success 
            ? 'bg-green-50 border-green-200' 
            : 'bg-red-50 border-red-200'
        }`}>
          <div className="flex items-start">
            <div className="flex-shrink-0">
              {uploadResult.success ? (
                <CheckCircle className="h-5 w-5 text-green-600" />
              ) : (
                <XCircle className="h-5 w-5 text-red-600" />
              )}
            </div>
            <div className="ml-3 flex-1">
              <h3 className={`text-sm font-medium ${
                uploadResult.success ? 'text-green-800' : 'text-red-800'
              }`}>
                {uploadResult.message}
              </h3>
              {uploadResult.leadsCount && (
                <p className="text-sm text-green-700 mt-1">
                  {uploadResult.leadsCount} leads have been added to your database and are ready for outreach.
                </p>
              )}
              {uploadResult.errors && uploadResult.errors.length > 0 && (
                <div className="mt-2">
                  <div className="flex items-center">
                    <AlertCircle className="h-4 w-4 text-yellow-600 mr-1" />
                    <span className="text-sm font-medium text-yellow-800">Additional Information:</span>
                  </div>
                  <ul className="mt-1 text-sm text-yellow-700 list-disc list-inside">
                    {uploadResult.errors.map((error, index) => (
                      <li key={index}>{error}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <button
              onClick={clearUploadResult}
              className="flex-shrink-0 ml-3 text-gray-400 hover:text-gray-600"
            >
              <XCircle className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      {/* Validation Errors */}
      {validationErrors.length > 0 && (
        <div className="rounded-lg border p-4 bg-red-50 border-red-200">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <XCircle className="h-5 w-5 text-red-600" />
            </div>
            <div className="ml-3 flex-1">
              <h3 className="text-sm font-medium text-red-800">
                Campaign cannot be published
              </h3>
              <div className="mt-2">
                <ul className="text-sm text-red-700 list-disc list-inside space-y-1">
                  {validationErrors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              </div>
            </div>
            <button
              onClick={() => setValidationErrors([])}
              className="flex-shrink-0 ml-3 text-red-400 hover:text-red-600"
            >
              <XCircle className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="border-b border-gray-200">
          <nav className="flex overflow-x-auto px-4 sm:px-6">
            {[
              { key: 'analytics', label: 'Campaign Analytics' },
              { key: 'leads', label: 'Upload Leads' },
              { key: 'details', label: 'Campaign Details' },
              { key: 'training', label: 'AI Training' },
              { key: 'sequence', label: 'Sequence Builder' }
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as any)}
                className={`py-4 px-4 border-b-2 font-medium text-sm whitespace-nowrap ${
                  activeTab === tab.key
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="p-4 sm:p-6">
          {/* Campaign Details Tab */}
          {activeTab === 'details' && (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                  <label htmlFor="offer" className="block text-sm font-medium text-gray-700 mb-2">
                    Campaign Offer *
                  </label>
                  <input
                    type="text"
                    id="offer"
                    name="offer"
                    value={formData.offer}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="e.g., Free consultation call"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="status" className="block text-sm font-medium text-gray-700 mb-2">
                    Campaign Status
                  </label>
                  <select
                    id="status"
                    name="status"
                    value={formData.status}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="goal" className="block text-sm font-medium text-gray-700 mb-2">
                  Description
                </label>
                <textarea
                  id="goal"
                  name="goal"
                  value={formData.goal}
                  onChange={handleInputChange}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Describe your campaign objectives..."
                />
              </div>

              <div>
                <label htmlFor="calendar_url" className="block text-sm font-medium text-gray-700 mb-2">
                  Calendar URL *
                </label>
                <input
                  type="url"
                  id="calendar_url"
                  name="calendar_url"
                  value={formData.calendar_url}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="https://calendly.com/..."
                />
              </div>
            </form>
          )}

          {/* Campaign Analytics Tab */}
          {activeTab === 'analytics' && campaign && (
            <CampaignAnalytics campaignId={campaign.id} />
          )}

          {/* Upload Leads Tab */}
          {activeTab === 'leads' && campaign && (
            <UploadLeadsTab campaignId={campaign.id} />
          )}

          {/* AI Training Tab */}
          {activeTab === 'training' && campaign && (
            <AITrainer campaignId={campaign.id} />
          )}

          {/* Sequence Builder Tab */}
          {activeTab === 'sequence' && campaign && (
            <SequenceBuilder campaignId={campaign.id} />
          )}
        </div>
      </div>
    </div>
  );
}