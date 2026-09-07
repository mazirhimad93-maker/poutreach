import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../lib/supabase';
import { 
  Search, 
  Calendar, 
  MessageSquare, 
  Phone, 
  ExternalLink, 
  User, 
  Crown, 
  Zap,
  Bot,
  CheckCircle,
  Clock,
  Filter
} from 'lucide-react';
import { AITrainer } from './AITrainer';

interface BookedLead {
  id: string;
  campaign_id: string;
  name: string | null;
  phone: string | null;
  status: string | null;
  booking_url: string | null;
  created_at: string;
}

interface ConversationReply {
  id: string;
  lead_id: string;
  campaign_id: string;
  channel: string;
  from_role: string;
  message: string;
  timestamp: string;
}

interface Campaign {
  id: string;
  offer: string | null;
}

export function Inbox() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [bookedLeads, setBookedLeads] = useState<BookedLead[]>([]);
  const [replies, setReplies] = useState<ConversationReply[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'bookings' | 'replies' | 'ai-setter'>('bookings');
  const [selectedCampaign, setSelectedCampaign] = useState('');

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user]);

  const fetchData = async () => {
    if (!user) return;

    try {
      const [leadsResponse, repliesResponse, campaignsResponse] = await Promise.all([
        supabase
          .from('uploaded_leads')
          .select('*')
          .eq('user_id', user.id)
          .not('booking_url', 'is', null)
          .order('created_at', { ascending: false }),
        supabase
          .from('conversation_history')
          .select('*')
          .eq('from_role', 'lead')
          .order('timestamp', { ascending: false }),
        supabase
          .from('campaigns')
          .select('id, offer')
          .eq('user_id', user.id),
      ]);

      if (leadsResponse.error) throw leadsResponse.error;
      if (repliesResponse.error) throw repliesResponse.error;
      if (campaignsResponse.error) throw campaignsResponse.error;

      setBookedLeads(leadsResponse.data || []);
      setReplies(repliesResponse.data || []);
      setCampaigns(campaignsResponse.data || []);
    } catch (error) {
      console.error('Error fetching inbox data:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredBookings = bookedLeads.filter((lead) => {
    const matchesSearch = !searchTerm || 
      (lead.name?.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (lead.phone?.includes(searchTerm));

    const matchesCampaign = !selectedCampaign || lead.campaign_id === selectedCampaign;

    return matchesSearch && matchesCampaign;
  });

  const filteredReplies = replies.filter((reply) => {
    const matchesSearch = !searchTerm || 
      reply.message.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesCampaign = !selectedCampaign || reply.campaign_id === selectedCampaign;

    return matchesSearch && matchesCampaign;
  });

  const getCampaignName = (campaignId: string) => {
    const campaign = campaigns.find(c => c.id === campaignId);
    return campaign?.offer || 'Unknown Campaign';
  };

  const getChannelIcon = (channel: string) => {
    switch (channel) {
      case 'vapi':
        return Phone;
      case 'sms':
      case 'whatsapp':
        return MessageSquare;
      default:
        return MessageSquare;
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
            <Calendar className="absolute inset-0 m-auto h-4 w-4 text-blue-600" />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center space-x-3 mb-2">
          {theme === 'gold' ? (
            <Crown className="h-8 w-8 text-yellow-400" />
          ) : (
            <Calendar className="h-8 w-8 text-blue-600" />
          )}
          <h1 className={`text-3xl font-bold ${
            theme === 'gold' ? 'gold-text-gradient' : 'text-gray-900'
          }`}>
            Inbox
          </h1>
        </div>
        <p className={theme === 'gold' ? 'text-gray-400' : 'text-gray-600'}>
          Manage booked appointments, lead replies, and AI setter training
        </p>
      </div>

      {/* Tabs */}
      <div className={`rounded-xl shadow-sm border ${
        theme === 'gold' 
          ? 'black-card gold-border' 
          : 'bg-white border-gray-200'
      }`}>
        <div className={`border-b ${
          theme === 'gold' ? 'border-yellow-400/20' : 'border-gray-200'
        }`}>
          <nav className="flex overflow-x-auto px-4 sm:px-6">
            {[
              { key: 'bookings', label: 'Booked Appointments', icon: Calendar },
              { key: 'replies', label: 'Lead Replies', icon: MessageSquare },
              { key: 'ai-setter', label: 'AI Setter Training', icon: Bot }
            ].map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key as any)}
                  className={`py-4 px-4 border-b-2 font-medium text-sm whitespace-nowrap flex items-center space-x-2 ${
                    activeTab === tab.key
                      ? theme === 'gold'
                        ? 'border-yellow-400 text-yellow-400'
                        : 'border-blue-500 text-blue-600'
                      : theme === 'gold'
                        ? 'border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-4 sm:p-6">
          {/* Search and Filters */}
          {(activeTab === 'bookings' || activeTab === 'replies') && (
            <div className="mb-6 space-y-4">
              <div className="flex flex-col md:flex-row md:items-center md:space-x-4 space-y-4 md:space-y-0">
                {/* Search */}
                <div className="flex-1">
                  <div className="relative">
                    <Search className={`absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 ${
                      theme === 'gold' ? 'text-yellow-400' : 'text-gray-400'
                    }`} />
                    <input
                      type="text"
                      placeholder={activeTab === 'bookings' ? 'Search bookings...' : 'Search replies...'}
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className={`w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                        theme === 'gold'
                          ? 'border-yellow-400/30 bg-black/50 text-gray-200 placeholder-gray-500 focus:ring-yellow-400'
                          : 'border-gray-300 bg-white text-gray-900 focus:ring-blue-500'
                      } focus:border-transparent`}
                    />
                  </div>
                </div>

                {/* Campaign Filter */}
                <div className="flex-shrink-0">
                  <select
                    value={selectedCampaign}
                    onChange={(e) => setSelectedCampaign(e.target.value)}
                    className={`px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                      theme === 'gold'
                        ? 'border-yellow-400/30 bg-black/50 text-gray-200 focus:ring-yellow-400'
                        : 'border-gray-300 bg-white text-gray-900 focus:ring-blue-500'
                    } focus:border-transparent`}
                  >
                    <option value="">All Campaigns</option>
                    {campaigns.map((campaign) => (
                      <option key={campaign.id} value={campaign.id}>
                        {campaign.offer || 'Untitled Campaign'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Booked Appointments Tab */}
          {activeTab === 'bookings' && (
            <div className="space-y-4">
              {filteredBookings.length === 0 ? (
                <div className="text-center py-12">
                  <Calendar className={`h-12 w-12 mx-auto mb-4 ${
                    theme === 'gold' ? 'text-gray-600' : 'text-gray-400'
                  }`} />
                  <h3 className={`text-lg font-medium mb-2 ${
                    theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
                  }`}>
                    No booked appointments yet
                  </h3>
                  <p className={theme === 'gold' ? 'text-gray-400' : 'text-gray-600'}>
                    {searchTerm || selectedCampaign
                      ? 'No appointments match your search criteria'
                      : 'Booked appointments will appear here when prospects schedule meetings'}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredBookings.map((lead) => (
                    <div
                      key={lead.id}
                      className={`p-4 rounded-lg border transition-colors ${
                        theme === 'gold'
                          ? 'border-yellow-400/20 bg-black/10 hover:bg-yellow-400/5'
                          : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                            theme === 'gold' ? 'bg-green-500/20' : 'bg-green-100'
                          }`}>
                            <User className={`h-5 w-5 ${
                              theme === 'gold' ? 'text-green-400' : 'text-green-600'
                            }`} />
                          </div>
                          <div>
                            <div className={`text-sm font-medium ${
                              theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
                            }`}>
                              {lead.name || 'No name'}
                            </div>
                            {lead.phone && (
                              <div className={`text-sm flex items-center ${
                                theme === 'gold' ? 'text-gray-400' : 'text-gray-500'
                              }`}>
                                <Phone className="h-3 w-3 mr-1" />
                                {lead.phone}
                              </div>
                            )}
                            <div className={`text-xs ${
                              theme === 'gold' ? 'text-gray-500' : 'text-gray-500'
                            }`}>
                              {getCampaignName(lead.campaign_id)}
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex items-center space-x-3">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            theme === 'gold'
                              ? 'bg-green-500/20 text-green-400'
                              : 'bg-green-100 text-green-800'
                          }`}>
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Booked
                          </span>
                          
                          {lead.booking_url && (
                            <a
                              href={lead.booking_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`text-sm hover:underline flex items-center ${
                                theme === 'gold' ? 'text-yellow-400' : 'text-blue-600'
                              }`}
                            >
                              <ExternalLink className="h-3 w-3 mr-1" />
                              View Booking
                            </a>
                          )}
                          
                          <span className={`text-xs ${
                            theme === 'gold' ? 'text-gray-500' : 'text-gray-500'
                          }`}>
                            {new Date(lead.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Lead Replies Tab */}
          {activeTab === 'replies' && (
            <div className="space-y-4">
              {filteredReplies.length === 0 ? (
                <div className="text-center py-12">
                  <MessageSquare className={`h-12 w-12 mx-auto mb-4 ${
                    theme === 'gold' ? 'text-gray-600' : 'text-gray-400'
                  }`} />
                  <h3 className={`text-lg font-medium mb-2 ${
                    theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
                  }`}>
                    No replies yet
                  </h3>
                  <p className={theme === 'gold' ? 'text-gray-400' : 'text-gray-600'}>
                    {searchTerm || selectedCampaign
                      ? 'No replies match your search criteria'
                      : 'Lead replies will appear here when prospects respond to your outreach'}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredReplies.map((reply) => {
                    const Icon = getChannelIcon(reply.channel);
                    return (
                      <div
                        key={reply.id}
                        className={`p-4 rounded-lg border transition-colors ${
                          theme === 'gold'
                            ? 'border-yellow-400/20 bg-black/10 hover:bg-yellow-400/5'
                            : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                        }`}
                      >
                        <div className="flex items-start space-x-4">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                            theme === 'gold' ? 'bg-blue-500/20' : 'bg-blue-100'
                          }`}>
                            <Icon className={`h-5 w-5 ${
                              theme === 'gold' ? 'text-blue-400' : 'text-blue-600'
                            }`} />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-2">
                              <div className={`text-sm font-medium ${
                                theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
                              }`}>
                                Reply via {reply.channel.toUpperCase()}
                              </div>
                              <div className="flex items-center space-x-2">
                                <span className={`text-xs ${
                                  theme === 'gold' ? 'text-gray-500' : 'text-gray-500'
                                }`}>
                                  {getCampaignName(reply.campaign_id)}
                                </span>
                                <span className={`text-xs ${
                                  theme === 'gold' ? 'text-gray-500' : 'text-gray-500'
                                }`}>
                                  {new Date(reply.timestamp).toLocaleDateString()} {new Date(reply.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                            </div>
                            <p className={`text-sm ${
                              theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
                            }`}>
                              {reply.message}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* AI Setter Training Tab */}
          {activeTab === 'ai-setter' && (
            <div className="space-y-6">
              <div className={`p-4 rounded-lg ${
                theme === 'gold'
                  ? 'bg-yellow-400/10 border border-yellow-400/20'
                  : 'bg-blue-50 border border-blue-200'
              }`}>
                <h4 className={`text-sm font-medium mb-2 ${
                  theme === 'gold' ? 'text-yellow-400' : 'text-blue-700'
                }`}>
                  AI Setter Training
                </h4>
                <p className={`text-sm ${
                  theme === 'gold' ? 'text-gray-400' : 'text-blue-600'
                }`}>
                  Train your AI to better handle appointment setting and lead qualification. This feature will be available soon.
                </p>
              </div>

              <div className="text-center py-12">
                <Bot className={`h-16 w-16 mx-auto mb-4 ${
                  theme === 'gold' ? 'text-gray-600' : 'text-gray-400'
                }`} />
                <h3 className={`text-xl font-medium mb-2 ${
                  theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
                }`}>
                  AI Setter Training Coming Soon
                </h3>
                <p className={`max-w-md mx-auto ${
                  theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
                }`}>
                  Advanced AI training features for appointment setting, objection handling, and lead qualification will be available in the next update.
                </p>
                
                <div className={`mt-6 inline-flex items-center px-4 py-2 rounded-lg ${
                  theme === 'gold'
                    ? 'bg-yellow-400/10 border border-yellow-400/20 text-yellow-400'
                    : 'bg-blue-50 border border-blue-200 text-blue-700'
                }`}>
                  <Clock className="h-4 w-4 mr-2" />
                  <span className="text-sm font-medium">In Development</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Summary Stats */}
      {(activeTab === 'bookings' || activeTab === 'replies') && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className={`p-6 rounded-xl border ${
            theme === 'gold' 
              ? 'black-card gold-border' 
              : 'bg-white border-gray-200'
          }`}>
            <div className="flex items-center">
              <div className={`p-2 rounded-lg ${
                theme === 'gold' ? 'bg-green-500/20' : 'bg-green-100'
              }`}>
                <Calendar className={`h-6 w-6 ${
                  theme === 'gold' ? 'text-green-400' : 'text-green-600'
                }`} />
              </div>
              <div className="ml-4">
                <p className={`text-2xl font-bold ${
                  theme === 'gold' ? 'text-yellow-400' : 'text-gray-900'
                }`}>
                  {bookedLeads.length}
                </p>
                <p className={`text-sm ${
                  theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
                }`}>
                  Total Bookings
                </p>
              </div>
            </div>
          </div>

          <div className={`p-6 rounded-xl border ${
            theme === 'gold' 
              ? 'black-card gold-border' 
              : 'bg-white border-gray-200'
          }`}>
            <div className="flex items-center">
              <div className={`p-2 rounded-lg ${
                theme === 'gold' ? 'bg-blue-500/20' : 'bg-blue-100'
              }`}>
                <MessageSquare className={`h-6 w-6 ${
                  theme === 'gold' ? 'text-blue-400' : 'text-blue-600'
                }`} />
              </div>
              <div className="ml-4">
                <p className={`text-2xl font-bold ${
                  theme === 'gold' ? 'text-yellow-400' : 'text-gray-900'
                }`}>
                  {replies.length}
                </p>
                <p className={`text-sm ${
                  theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
                }`}>
                  Total Replies
                </p>
              </div>
            </div>
          </div>

          <div className={`p-6 rounded-xl border ${
            theme === 'gold' 
              ? 'black-card gold-border' 
              : 'bg-white border-gray-200'
          }`}>
            <div className="flex items-center">
              <div className={`p-2 rounded-lg ${
                theme === 'gold' ? 'bg-purple-500/20' : 'bg-purple-100'
              }`}>
                <User className={`h-6 w-6 ${
                  theme === 'gold' ? 'text-purple-400' : 'text-purple-600'
                }`} />
              </div>
              <div className="ml-4">
                <p className={`text-2xl font-bold ${
                  theme === 'gold' ? 'text-yellow-400' : 'text-gray-900'
                }`}>
                  {bookedLeads.filter(lead => lead.booking_url).length}
                </p>
                <p className={`text-sm ${
                  theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
                }`}>
                  With Booking URLs
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}