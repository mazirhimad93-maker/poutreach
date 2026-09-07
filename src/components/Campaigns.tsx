import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../lib/supabase';
import { Plus, Target, Calendar, Edit2, Trash2, Crown, Star, Zap, CheckCircle, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';

interface Campaign {
  id: string;
  avatar: string | null;
  offer: string | null;
  calendar_url: string | null;
  goal: string | null;
  status: string | null;
  created_at: string;
}

export function Campaigns() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadResult, setUploadResult] = useState<{success: boolean; message: string; errors?: string[]} | null>(null);
  const [availableChannels, setAvailableChannels] = useState<any[]>([]);
  const [formData, setFormData] = useState({
    offer: '',
    calendar_url: '',
    goal: '',
    status: 'draft',
  });

  useEffect(() => {
    if (user) {
      fetchCampaigns();
      fetchAvailableChannels();
    }
  }, [user]);

  const fetchAvailableChannels = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('channels')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true);

      if (error) throw error;
      setAvailableChannels(data || []);
    } catch (error) {
      console.error('Error fetching channels:', error);
    }
  };

  const fetchCampaigns = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('campaigns')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setCampaigns(data || []);
    } catch (error) {
      console.error('Error fetching campaigns:', error);
    } finally {
      setLoading(false);
    }
  };

  const getChannelOptions = () => {
    const options = [];
    
    // Check if user has voice channel (Vapi)
    const hasVapi = availableChannels.some(ch => ch.channel_type === 'voice' && ch.provider === 'vapi');
    if (hasVapi) {
      options.push({ value: 'vapi', label: 'Voice Call (Vapi)', type: 'call' });
    }
    
    // Check if user has SMS channel (Twilio)
    const hasSms = availableChannels.some(ch => ch.channel_type === 'sms' && ch.provider === 'twilio');
    if (hasSms) {
      options.push({ value: 'sms', label: 'SMS (Twilio)', type: 'sms' });
    }
    
    // Check if user has WhatsApp channel (Twilio)
    const hasWhatsApp = availableChannels.some(ch => ch.channel_type === 'whatsapp' && ch.provider === 'twilio');
    if (hasWhatsApp) {
      options.push({ value: 'whatsapp', label: 'WhatsApp (Twilio)', type: 'whatsapp' });
    }
    
    return options;
  };

  const generateCampaignSequences = (selectedChannels: string[], campaignId: string) => {
    const sequences = selectedChannels.map((channel, index) => {
      let type = channel;
      let provider = 'twilio';
      
      if (channel === 'vapi') {
        type = 'call';
        provider = 'vapi';
      }
      
      return {
        campaign_id: campaignId,
        user_id: user?.id,
        step_number: index + 1,
        type: type,
        wait_seconds: index === 0 ? 0 : 3600, // First step immediate, others wait 1 hour
        prompt: `You are an AI appointment setter for this campaign. Contact leads via ${channel} and book qualified appointments.`
      };
    });
    
    return sequences;
  };

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    
    if (!supabase) {
      setUploadResult({
        success: false,
        message: 'Database connection not available',
        errors: ['Please check your environment configuration']
      });
      setSaving(false);
      return;
    }
    
    if (!user) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data, error } = await supabase.from('campaigns').insert({
        user_id: user.id,
        offer: formData.offer,
        calendar_url: formData.calendar_url,
        goal: formData.goal,
        status: formData.status,
      }).select();

      if (error) throw error;

      if (data && data[0]) {
        const campaignId = data[0].id;
        const campaignOffer = data[0].offer || 'prospects';
        
        try {
          // Create default training resource
          await supabase
            .from('training_resources')
            .insert({
              campaign_id: campaignId,
              user_id: user.id,
              type: 'note',
              content: `You are an appointment setter for this campaign. Set qualified appointments for our offer targeting ${campaignOffer}. Be professional, friendly, and focus on qualifying prospects who would benefit from our solution.`
            });

          // Create default campaign sequence
          await supabase
            .from('campaign_sequences')
            .insert({
              campaign_id: campaignId,
              user_id: user.id,
              step_number: 1,
              type: 'call',
              wait_seconds: 0,
              prompt: `You are an AI appointment setter for this campaign. Your job is to contact leads and book qualified appointments for our offer targeting ${campaignOffer}. Be professional, friendly, and focus on qualifying prospects who would benefit from our solution.`
            });
        } catch (trainingError) {
          console.error('Error adding default training resource:', trainingError);
          // Don't fail the campaign creation if training resource fails
        }
      }
      // Show success message
      setUploadResult({
        success: true,
        message: 'Campaign created successfully with default AI training! You can now configure channels and test your AI assistant.'
      });

      setFormData({ offer: '', calendar_url: '', goal: '', status: 'draft' });
      setShowCreateForm(false);
      fetchCampaigns();
    } catch (error) {
      console.error('Error creating campaign:', error);
      setUploadResult({
        success: false,
        message: 'Failed to create campaign. Please try again.',
        errors: [error instanceof Error ? error.message : 'Unknown error']
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCampaign = async (campaignId: string) => {
    const confirmMessage = theme === 'gold' 
      ? 'Are you sure you want to delete this elite campaign?'
      : 'Are you sure you want to delete this campaign?';
    
    if (!confirm(confirmMessage)) return;

    try {
      const { error } = await supabase
        .from('campaigns')
        .delete()
        .eq('id', campaignId);

      if (error) throw error;
      fetchCampaigns();
    } catch (error) {
      console.error('Error deleting campaign:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="relative">
          <div className={`animate-spin rounded-full h-12 w-12 border-4 border-transparent ${
            theme === 'gold'
              ? 'border-t-yellow-400 border-r-yellow-500'
              : 'border-t-blue-600 border-r-blue-500'
          }`}></div>
          {theme === 'gold' ? (
            <Crown className="absolute inset-0 m-auto h-4 w-4 text-yellow-400" />
          ) : (
            <Target className="absolute inset-0 m-auto h-4 w-4 text-blue-600" />
          )}
        </div>
      </div>
    );
  }

  if (theme === 'gold') {
    return (
      <div className="space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center space-x-3 mb-2">
              <Crown className="h-8 w-8 text-yellow-400" />
              <h1 className="text-3xl font-bold gold-text-gradient">Elite Campaigns</h1>
            </div>
            <p className="text-gray-400">
              Manage your premium outreach campaigns
            </p>
          </div>
          <button
            onClick={() => setShowCreateForm(true)}
            className="inline-flex items-center px-6 py-3 gold-gradient text-black text-sm font-bold rounded-lg hover-gold transition-all duration-200 shadow-lg"
          >
            <Plus className="h-4 w-4 mr-2" />
            New Elite Campaign
          </button>
        </div>

        {/* Create Campaign Form */}
        {showCreateForm && (
          <div className="black-card rounded-xl gold-border p-6 shadow-2xl">
            <div className="flex items-center space-x-2 mb-4">
              <Star className="h-5 w-5 text-yellow-400" />
              <h2 className="text-lg font-semibold text-gray-200">
                Create New Elite Campaign
              </h2>
            </div>
            <form onSubmit={handleCreateCampaign} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Premium Offer Description
                  </label>
                  <input
                    type="text"
                    value={formData.offer}
                    onChange={(e) =>
                      setFormData({ ...formData, offer: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-yellow-400/30 rounded-lg bg-black/50 text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent"
                    placeholder="e.g., Exclusive VIP consultation"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Elite Calendar URL
                  </label>
                  <input
                    type="url"
                    value={formData.calendar_url}
                    onChange={(e) =>
                      setFormData({ ...formData, calendar_url: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-yellow-400/30 rounded-lg bg-black/50 text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent"
                    placeholder="https://calendly.com/..."
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Campaign Vision
                </label>
                <textarea
                  value={formData.goal}
                  onChange={(e) =>
                    setFormData({ ...formData, goal: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-yellow-400/30 rounded-lg bg-black/50 text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent h-20"
                  placeholder="Describe your elite campaign objectives..."
                />
              </div>


              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="px-4 py-2 text-gray-400 bg-gray-800 border border-gray-600 rounded-lg hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className={`inline-flex items-center px-6 py-2 text-sm font-bold rounded-lg hover-gold transition-all duration-200 shadow-lg ${
                    theme === 'gold'
                      ? 'gold-gradient text-black'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  } disabled:opacity-50`}
                >
                  {saving ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2"></div>
                      Creating...
                    </>
                  ) : (
                    'Launch Campaign'
                  )}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Campaigns Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {campaigns.map((campaign) => (
            <div
              key={campaign.id}
              className="black-card rounded-xl gold-border p-6 hover:gold-shadow transition-all duration-300 group"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 gold-gradient rounded-lg flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-200">
                  <Target className="h-6 w-6 text-black" />
                </div>
                <span
                  className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                    campaign.status === 'active'
                      ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                      : campaign.status === 'paused'
                      ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                      : 'bg-gray-500/20 text-gray-400 border border-gray-500/30'
                  }`}
                >
                  {campaign.status === 'active' && <Zap className="h-3 w-3 mr-1" />}
                  {campaign.status || 'Draft'}
                </span>
              </div>

              <h3 className="text-lg font-semibold text-gray-200 mb-2">
                {campaign.offer || 'Elite Campaign'}
              </h3>
              
              <p className="text-sm text-gray-400 mb-4 line-clamp-2">
                {campaign.goal || 'Premium outreach strategy'}
              </p>

              {campaign.calendar_url && (
                <div className="flex items-center text-sm text-yellow-400 mb-4">
                  <Calendar className="h-4 w-4 mr-1" />
                  <span className="truncate">VIP Calendar Active</span>
                </div>
              )}

              <div className="flex items-center justify-between mb-4">
                <span className="text-xs text-gray-500">
                  {new Date(campaign.created_at).toLocaleDateString()}
                </span>
              </div>

              {/* Action buttons */}
              <div className="flex justify-end gap-2">
                <Link
                  to={`/campaigns/${campaign.id}/edit`}
                  className="p-2 text-yellow-400 hover:bg-yellow-400/10 rounded-lg transition-colors border border-transparent hover:border-yellow-400/30"
                  title="Edit campaign"
                >
                  <Edit2 className="h-4 w-4" />
                </Link>
                <button
                  onClick={() => handleDeleteCampaign(campaign.id)}
                  className="p-2 text-red-400 hover:bg-red-400/10 rounded-lg transition-colors border border-transparent hover:border-red-400/30"
                  title="Delete campaign"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Empty State */}
        {campaigns.length === 0 && (
          <div className="text-center py-16">
            <div className="w-20 h-20 gold-gradient rounded-full flex items-center justify-center mx-auto mb-6 shadow-2xl">
              <Crown className="h-10 w-10 text-black" />
            </div>
            <h3 className="text-2xl font-bold gold-text-gradient mb-2">
              Ready to dominate your market?
            </h3>
            <p className="text-gray-400 mb-8 max-w-md mx-auto">
              Create your first elite campaign and start converting high-value prospects into premium clients.
            </p>
            <button
              onClick={() => setShowCreateForm(true)}
              className="inline-flex items-center px-8 py-4 gold-gradient text-black text-sm font-bold rounded-lg hover-gold transition-all duration-200 shadow-lg"
            >
              <Crown className="h-5 w-5 mr-2" />
              Create Elite Campaign
            </button>
          </div>
        )}
      </div>
    );
  }

  // Blue theme (original design)
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Campaigns</h1>
          <p className="mt-2 text-gray-600">
            Manage your outreach campaigns
          </p>
        </div>
        <button
          onClick={() => setShowCreateForm(true)}
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-4 w-4 mr-2" />
          New Campaign
        </button>
      </div>

      {/* Upload Result Message */}
      {uploadResult && (
        <div className={`rounded-lg border p-4 ${
          uploadResult.success 
            ? theme === 'gold'
              ? 'bg-green-500/10 border-green-500/30 text-green-400'
              : 'bg-green-50 border-green-200 text-green-800'
            : theme === 'gold'
              ? 'bg-red-500/10 border-red-500/30 text-red-400'
              : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          <div className="flex items-start">
            <div className="flex-shrink-0">
              {uploadResult.success ? (
                <CheckCircle className="h-5 w-5" />
              ) : (
                <XCircle className="h-5 w-5" />
              )}
            </div>
            <div className="ml-3 flex-1">
              <h3 className="text-sm font-medium">
                {uploadResult.message}
              </h3>
              {uploadResult.errors && uploadResult.errors.length > 0 && (
                <ul className="mt-1 text-sm list-disc list-inside">
                  {uploadResult.errors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              )}
            </div>
            <button
              onClick={() => setUploadResult(null)}
              className="flex-shrink-0 ml-3 hover:opacity-70"
            >
              <XCircle className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      {/* Create Campaign Form */}
      {showCreateForm && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Create New Campaign
          </h2>
          <form onSubmit={handleCreateCampaign} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Offer Description
                </label>
                <input
                  type="text"
                  value={formData.offer}
                  onChange={(e) =>
                    setFormData({ ...formData, offer: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., Free consultation call"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Calendar URL
                </label>
                <input
                  type="url"
                  value={formData.calendar_url}
                  onChange={(e) =>
                    setFormData({ ...formData, calendar_url: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="https://calendly.com/..."
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Campaign Goal
              </label>
              <textarea
                value={formData.goal}
                onChange={(e) =>
                  setFormData({ ...formData, goal: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 h-20"
                placeholder="Describe your campaign objectives..."
              />
            </div>


            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="px-4 py-2 text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className={`px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors ${saving ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {saving ? (
                  <div className="flex items-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2"></div>
                    Creating...
                  </div>
                ) : (
                  'Create Campaign'
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Campaigns Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {campaigns.map((campaign) => (
          <div
            key={campaign.id}
            className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <Target className="h-6 w-6 text-blue-600" />
              </div>
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  campaign.status === 'active'
                    ? 'bg-green-100 text-green-800'
                    : campaign.status === 'paused'
                    ? 'bg-yellow-100 text-yellow-800'
                    : 'bg-gray-100 text-gray-800'
                }`}
              >
                {campaign.status || 'Draft'}
              </span>
            </div>

            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {campaign.offer || 'Untitled Campaign'}
            </h3>
            
            <p className="text-sm text-gray-600 mb-4 line-clamp-2">
              {campaign.goal || 'No goal set'}
            </p>

            {campaign.calendar_url && (
              <div className="flex items-center text-sm text-gray-500 mb-4">
                <Calendar className="h-4 w-4 mr-1" />
                <span className="truncate">Calendar linked</span>
              </div>
            )}

            <div className="flex items-center justify-between mb-4">
              <span className="text-xs text-gray-500">
                {new Date(campaign.created_at).toLocaleDateString()}
              </span>
            </div>

            {/* Action buttons with grey styling */}
            <div className="flex justify-end gap-2">
              <Link
                to={`/campaigns/${campaign.id}/edit`}
                className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
                title="Edit campaign"
              >
                <Edit2 className="h-4 w-4" />
              </Link>
              <button
                onClick={() => handleDeleteCampaign(campaign.id)}
                className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
                title="Delete campaign"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Empty State */}
      {campaigns.length === 0 && (
        <div className="text-center py-12">
          <Target className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-medium text-gray-900 mb-2">
            No campaigns yet
          </h3>
          <p className="text-gray-600 mb-6">
            Create your first campaign to start reaching out to leads.
          </p>
          <button
            onClick={() => setShowCreateForm(true)}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Edit2 className="h-4 w-4 mr-2" />
            Create & Setup Campaign
          </button>
        </div>
      )}
    </div>
  );
}