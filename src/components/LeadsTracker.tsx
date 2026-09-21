import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../lib/supabase';
import { 
  Search, 
  Filter, 
  Target, 
  TrendingUp, 
  Users, 
  Phone, 
  MessageSquare, 
  Calendar,
  BarChart3,
  Activity,
  Crown,
  Zap,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Clock,
  ArrowUp,
  ArrowDown
} from 'lucide-react';

interface Campaign {
  id: string;
  offer: string | null;
  status: string | null;
  created_at: string;
}

interface CampaignPerformance {
  campaign: Campaign;
  totalLeads: number;
  sequenceProgress: {
    queued: number;
    running: number;
    done: number;
    failed: number;
  };
  channelTypes: string[];
  primaryChannel: string;
  activityStats: {
    calls: number;
    sms: number;
    whatsapp: number;
    email: number;
    reach: number;
    replies: number;
    bookings: number;
  };
  responseRate: number;
  dailyActivity: Array<{
    date: string;
    total: number;
  }>;
}

interface LiveActivity {
  id: string;
  type: 'call' | 'vapi' | 'sms' | 'whatsapp' | 'email' | 'booking' | 'reply';
  campaign_name: string;
  lead_name: string;
  timestamp: string;
  status: 'success' | 'failed' | 'pending';
  message?: string;
}

export function LeadsTracker() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [performanceData, setPerformanceData] = useState<CampaignPerformance[]>([]);
  const [liveActivities, setLiveActivities] = useState<LiveActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  useEffect(() => {
    if (user) {
      fetchCampaignPerformance();
    }
  }, [user]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchCampaignPerformance();
      fetchLiveActivities();
    }, 30000);

    return () => clearInterval(interval);
  }, [autoRefresh, user]);

  const fetchCampaignPerformance = async () => {
    if (!user) return;

    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
      const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];

      const [
        campaignsResult,
        summaryResult,
        sequencesResult,
        dailyResult
      ] = await Promise.all([
        supabase
          .from('campaigns')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('campaign_performance_summary')
          .select('*')
          .eq('user_id', user.id),
        supabase
          .from('campaign_sequences')
          .select('campaign_id, type, step_number')
          .eq('user_id', user.id)
          .order('step_number', { ascending: true }),
        supabase
          .from('campaign_daily_reach')
          .select('campaign_id, activity_date, total')
          .eq('user_id', user.id)
          .gte('activity_date', sevenDaysAgoStr)
      ]);

      if (campaignsResult.error) throw campaignsResult.error;
      if (summaryResult.error) throw summaryResult.error;
      if (sequencesResult.error) throw sequencesResult.error;
      if (dailyResult.error) throw dailyResult.error;

      const campaigns = campaignsResult.data || [];
      setCampaigns(campaigns);

      const summaryByCampaign = new Map(
        (summaryResult.data || []).map((row: any) => [row.campaign_id, row])
      );

      const typesByCampaign = new Map<string, string[]>();
      for (const row of sequencesResult.data || []) {
        const type = String(row.type || '').toLowerCase();
        if (!type) continue;
        const current = typesByCampaign.get(row.campaign_id) || [];
        if (!current.includes(type)) current.push(type);
        typesByCampaign.set(row.campaign_id, current);
      }

      const dailyByCampaign = new Map<string, Map<string, number>>();
      for (const row of dailyResult.data || []) {
        if (!dailyByCampaign.has(row.campaign_id)) {
          dailyByCampaign.set(row.campaign_id, new Map());
        }
        dailyByCampaign
          .get(row.campaign_id)!
          .set(String(row.activity_date), Number(row.total || 0));
      }

      const performanceResults = campaigns.map((campaign) => {
        const summary: any = summaryByCampaign.get(campaign.id) || {};

        const rawQueued = Number(summary.queued || 0);
        const rawRunning = Number(summary.running || 0);
        const rawDone = Number(summary.done || 0);
        const rawFailed = Number(summary.failed || 0);
        const reachedLeads = Number(summary.reached_leads || 0);

        // If delivery is already logged but progress has not yet flipped to done,
        // the dashboard reflects the actual contacted lead count.
        const effectiveDone = Math.max(rawDone, reachedLeads);
        const inferredCompleted = Math.max(0, effectiveDone - rawDone);

        const sequenceProgress = {
          queued: Math.max(0, rawQueued - inferredCompleted),
          running: rawRunning,
          done: effectiveDone,
          failed: rawFailed,
        };

        const activityStats = {
          calls: Number(summary.calls || 0),
          sms: Number(summary.sms || 0),
          whatsapp: Number(summary.whatsapp || 0),
          email: Number(summary.email || 0),
          reach: Number(summary.reach || 0),
          replies: Number(summary.replies || 0),
          bookings: Number(summary.bookings || 0),
        };

        let channelTypes = typesByCampaign.get(campaign.id) || [];
        if (!channelTypes.length) {
          const observed: string[] = [];
          if (activityStats.email > 0) observed.push('email');
          if (activityStats.calls > 0) observed.push('vapi');
          if (activityStats.sms > 0) observed.push('sms');
          if (activityStats.whatsapp > 0) observed.push('whatsapp');
          channelTypes = observed;
        }

        const primaryChannel =
          channelTypes.length === 1
            ? channelTypes[0]
            : channelTypes.length > 1
              ? 'mixed'
              : 'unknown';

        const responseRate =
          activityStats.reach > 0
            ? (activityStats.replies / activityStats.reach) * 100
            : 0;

        const campaignDays = dailyByCampaign.get(campaign.id) || new Map();
        const dailyActivity = [];
        for (let i = 6; i >= 0; i--) {
          const date = new Date();
          date.setDate(date.getDate() - i);
          const dateStr = date.toISOString().split('T')[0];
          dailyActivity.push({
            date: dateStr,
            total: campaignDays.get(dateStr) || 0,
          });
        }

        return {
          campaign,
          totalLeads: Number(summary.total_leads || 0),
          sequenceProgress,
          channelTypes,
          primaryChannel,
          activityStats,
          responseRate,
          dailyActivity,
        };
      });

      setPerformanceData(performanceResults);
      setLastUpdate(new Date());
    } catch (error) {
      console.error('Error fetching campaign performance:', error);
      setPerformanceData([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchLiveActivities = async () => {
    if (!user) return;

    try {
      // Get recent activities from the last hour
      const oneHourAgo = new Date();
      oneHourAgo.setHours(oneHourAgo.getHours() - 1);

      const { data: recentActivities } = await supabase
        .from('lead_activity_history')
        .select(`
          id,
          lead_id,
          campaign_id,
          status,
          type,
          notes,
          channel_response,
          executed_at,
          campaigns(offer),
          leads(name)
        `)
        .gte('executed_at', oneHourAgo.toISOString())
        .order('executed_at', { ascending: false })
        .limit(20);

      if (recentActivities) {
        const formattedActivities: LiveActivity[] = recentActivities.map(activity => ({
          id: activity.id,
          type: activity.type as any,
          campaign_name: activity.campaigns?.offer || 'Unknown Campaign',
          lead_name: activity.leads?.name || 'Unknown Lead',
          timestamp: activity.executed_at,
          status: ['completed','sent','success','succeeded','delivered'].includes(String(activity.status || '').toLowerCase()) ? 'success' : String(activity.status || '').toLowerCase() === 'failed' ? 'failed' : 'pending',
          message: activity.notes,
        }));

        setLiveActivities(formattedActivities);
      }
    } catch (error) {
      console.error('Error fetching live activities:', error);
    }
  };

  const filteredPerformance = performanceData.filter((performance) => {
    const matchesSearch = !searchTerm || 
      (performance.campaign.offer?.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesStatus = !selectedStatus || performance.campaign.status === selectedStatus;

    return matchesSearch && matchesStatus;
  });

  const getStatusColor = (status: string | null) => {
    switch (status) {
      case 'active':
        return theme === 'gold' ? 'bg-green-500/20 text-green-400' : 'bg-green-100 text-green-800';
      case 'paused':
        return theme === 'gold' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-yellow-100 text-yellow-800';
      case 'completed':
        return theme === 'gold' ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-800';
      default:
        return theme === 'gold' ? 'bg-gray-500/20 text-gray-400' : 'bg-gray-100 text-gray-800';
    }
  };

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'call':
      case 'vapi':
        return Phone;
      case 'email':
      case 'sms':
      case 'whatsapp':
        return MessageSquare;
      case 'booking':
        return Calendar;
      case 'reply':
        return MessageSquare;
      default:
        return Activity;
    }
  };

  const getActivityStatusColor = (status: string) => {
    switch (status) {
      case 'success':
        return theme === 'gold' ? 'text-green-400' : 'text-green-600';
      case 'failed':
        return theme === 'gold' ? 'text-red-400' : 'text-red-600';
      case 'pending':
        return theme === 'gold' ? 'text-yellow-400' : 'text-yellow-600';
      default:
        return theme === 'gold' ? 'text-gray-400' : 'text-gray-600';
    }
  };

  const uniqueStatuses = [...new Set(campaigns.map(campaign => campaign.status).filter(Boolean))];

  // Calculate total metrics across all campaigns
  const totalMetrics = performanceData.reduce((acc, performance) => ({
    totalLeads: acc.totalLeads + performance.totalLeads,
    totalReach: acc.totalReach + performance.activityStats.reach,
    totalReplies: acc.totalReplies + performance.activityStats.replies,
    totalBookings: acc.totalBookings + performance.activityStats.bookings,
  }), { totalLeads: 0, totalReach: 0, totalReplies: 0, totalBookings: 0 });

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
            <Activity className="absolute inset-0 m-auto h-4 w-4 text-yellow-400" />
          ) : (
            <Activity className="absolute inset-0 m-auto h-4 w-4 text-blue-600" />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3 mb-2">
            {theme === 'gold' ? (
              <Crown className="h-8 w-8 text-yellow-400" />
            ) : (
              <Activity className="h-8 w-8 text-blue-600" />
            )}
            <h1 className={`text-3xl font-bold ${
              theme === 'gold' ? 'gold-text-gradient' : 'text-gray-900'
            }`}>
              Cold Performance
            </h1>
          </div>
          
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`p-2 rounded-lg transition-colors ${
                  autoRefresh
                    ? theme === 'gold'
                      ? 'bg-yellow-400/20 text-yellow-400'
                      : 'bg-blue-100 text-blue-600'
                    : theme === 'gold'
                      ? 'bg-gray-800 text-gray-400'
                      : 'bg-gray-100 text-gray-500'
                }`}
                title={autoRefresh ? 'Auto-refresh enabled' : 'Auto-refresh disabled'}
              >
                <RefreshCw className={`h-4 w-4 ${autoRefresh ? 'animate-spin' : ''}`} />
              </button>
              <span className={`text-xs ${
                theme === 'gold' ? 'text-gray-400' : 'text-gray-500'
              }`}>
                Last updated: {lastUpdate.toLocaleTimeString()}
              </span>
            </div>
          </div>
        </div>
        <p className={theme === 'gold' ? 'text-gray-400' : 'text-gray-600'}>
          Real-time tracking of your cold outreach system performance and channel activities
        </p>
      </div>

      {/* Global Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className={`p-4 rounded-lg border ${
          theme === 'gold'
            ? 'border-yellow-400/20 bg-black/20'
            : 'border-gray-200 bg-white'
        }`}>
          <div className="flex items-center space-x-2 mb-2">
            <Users className={`h-4 w-4 ${
              theme === 'gold' ? 'text-yellow-400' : 'text-blue-600'
            }`} />
            <span className={`text-xs font-medium ${
              theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
            }`}>
              Total Leads
            </span>
          </div>
          <p className={`text-2xl font-bold ${
            theme === 'gold' ? 'text-yellow-400' : 'text-blue-600'
          }`}>
            {totalMetrics.totalLeads.toLocaleString()}
          </p>
        </div>

        <div className={`p-4 rounded-lg border ${
          theme === 'gold'
            ? 'border-yellow-400/20 bg-black/20'
            : 'border-gray-200 bg-white'
        }`}>
          <div className="flex items-center space-x-2 mb-2">
            <Phone className={`h-4 w-4 ${
              theme === 'gold' ? 'text-yellow-400' : 'text-green-600'
            }`} />
            <span className={`text-xs font-medium ${
              theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
            }`}>
              Reach
            </span>
          </div>
          <p className={`text-2xl font-bold ${
            theme === 'gold' ? 'text-yellow-400' : 'text-green-600'
          }`}>
            {totalMetrics.totalReach.toLocaleString()}
          </p>
        </div>

        <div className={`p-4 rounded-lg border ${
          theme === 'gold'
            ? 'border-yellow-400/20 bg-black/20'
            : 'border-gray-200 bg-white'
        }`}>
          <div className="flex items-center space-x-2 mb-2">
            <MessageSquare className={`h-4 w-4 ${
              theme === 'gold' ? 'text-yellow-400' : 'text-purple-600'
            }`} />
            <span className={`text-xs font-medium ${
              theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
            }`}>
              Replies
            </span>
          </div>
          <p className={`text-2xl font-bold ${
            theme === 'gold' ? 'text-yellow-400' : 'text-purple-600'
          }`}>
            {totalMetrics.totalReplies.toLocaleString()}
          </p>
        </div>

        <div className={`p-4 rounded-lg border ${
          theme === 'gold'
            ? 'border-yellow-400/20 bg-black/20'
            : 'border-gray-200 bg-white'
        }`}>
          <div className="flex items-center space-x-2 mb-2">
            <Calendar className={`h-4 w-4 ${
              theme === 'gold' ? 'text-yellow-400' : 'text-orange-600'
            }`} />
            <span className={`text-xs font-medium ${
              theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
            }`}>
              Total Bookings
            </span>
          </div>
          <p className={`text-2xl font-bold ${
            theme === 'gold' ? 'text-yellow-400' : 'text-orange-600'
          }`}>
            {totalMetrics.totalBookings.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Live Activity Feed */}
      <div className={`rounded-xl border ${
        theme === 'gold' 
          ? 'black-card gold-border' 
          : 'bg-white border-gray-200'
      }`}>
        <div className={`px-6 py-4 border-b ${
          theme === 'gold' ? 'border-yellow-400/20' : 'border-gray-200'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Activity className={`h-5 w-5 ${
                theme === 'gold' ? 'text-yellow-400' : 'text-blue-600'
              }`} />
              <h2 className={`text-lg font-semibold ${
                theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
              }`}>
                Live Activity Feed
              </h2>
              <div className={`w-2 h-2 rounded-full animate-pulse ${
                theme === 'gold' ? 'bg-yellow-400' : 'bg-green-500'
              }`} />
            </div>
            <span className={`text-xs ${
              theme === 'gold' ? 'text-gray-400' : 'text-gray-500'
            }`}>
              Last hour
            </span>
          </div>
        </div>
        
        <div className="p-6">
          {liveActivities.length === 0 ? (
            <div className="text-center py-8">
              <Clock className={`h-12 w-12 mx-auto mb-4 ${
                theme === 'gold' ? 'text-gray-600' : 'text-gray-400'
              }`} />
              <h3 className={`text-lg font-medium mb-2 ${
                theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
              }`}>
                No recent activity
              </h3>
              <p className={theme === 'gold' ? 'text-gray-400' : 'text-gray-600'}>
                Live activities will appear here as your campaigns run
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {liveActivities.map((activity) => {
                const Icon = getActivityIcon(activity.type);
                return (
                  <div
                    key={activity.id}
                    className={`flex items-center space-x-3 p-3 rounded-lg ${
                      theme === 'gold'
                        ? 'bg-yellow-400/5 border border-yellow-400/10'
                        : 'bg-gray-50 border border-gray-100'
                    }`}
                  >
                    <div className={`p-2 rounded-lg ${
                      theme === 'gold' ? 'bg-yellow-400/20' : 'bg-blue-100'
                    }`}>
                      <Icon className={`h-4 w-4 ${getActivityStatusColor(activity.status)}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className={`text-sm font-medium ${
                          theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
                        }`}>
                          {activity.type.toUpperCase()}
                        </span>
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          activity.status === 'success'
                            ? theme === 'gold' ? 'bg-green-500/20 text-green-400' : 'bg-green-100 text-green-800'
                            : activity.status === 'failed'
                            ? theme === 'gold' ? 'bg-red-500/20 text-red-400' : 'bg-red-100 text-red-800'
                            : theme === 'gold' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-yellow-100 text-yellow-800'
                        }`}>
                          {activity.status}
                        </span>
                      </div>
                      <p className={`text-xs truncate ${
                        theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
                      }`}>
                        {activity.lead_name} • {activity.campaign_name}
                      </p>
                    </div>
                    <span className={`text-xs ${
                      theme === 'gold' ? 'text-gray-500' : 'text-gray-500'
                    }`}>
                      {new Date(activity.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className={`rounded-xl shadow-sm border p-4 ${
        theme === 'gold' 
          ? 'black-card gold-border' 
          : 'bg-white border-gray-200'
      }`}>
        <div className="flex flex-col md:flex-row md:items-center md:space-x-4 space-y-4 md:space-y-0">
          {/* Search */}
          <div className="flex-1">
            <div className="relative">
              <Search className={`absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 ${
                theme === 'gold' ? 'text-yellow-400' : 'text-gray-400'
              }`} />
              <input
                type="text"
                placeholder="Search campaigns..."
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

          {/* Status Filter */}
          <div className="flex-shrink-0">
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className={`px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                theme === 'gold'
                  ? 'border-yellow-400/30 bg-black/50 text-gray-200 focus:ring-yellow-400'
                  : 'border-gray-300 bg-white text-gray-900 focus:ring-blue-500'
              } focus:border-transparent`}
            >
              <option value="">All Statuses</option>
              {uniqueStatuses.map((status) => (
                <option key={status} value={status}>
                  {status?.charAt(0).toUpperCase() + status?.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Performance Cards */}
      <div className="space-y-4">
        {filteredPerformance.length === 0 ? (
          <div className={`text-center py-12 rounded-xl border ${
            theme === 'gold' 
              ? 'black-card gold-border' 
              : 'bg-white border-gray-200'
          }`}>
            <Activity className={`h-12 w-12 mx-auto mb-4 ${
              theme === 'gold' ? 'text-gray-600' : 'text-gray-400'
            }`} />
            <h3 className={`text-lg font-medium mb-2 ${
              theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
            }`}>
              No campaigns found
            </h3>
            <p className={theme === 'gold' ? 'text-gray-400' : 'text-gray-600'}>
              {searchTerm || selectedStatus
                ? 'Try adjusting your filters'
                : 'Create a campaign to start tracking performance'}
            </p>
          </div>
        ) : (
          filteredPerformance.map((performance) => (
            <div
              key={performance.campaign.id}
              className={`p-6 rounded-xl border transition-all duration-300 ${
                theme === 'gold'
                  ? 'black-card gold-border hover:gold-shadow'
                  : 'bg-white border-gray-200 hover:shadow-lg'
              }`}
            >
              {/* Campaign Header */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center space-x-4">
                  <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                    theme === 'gold' ? 'gold-gradient' : 'bg-blue-100'
                  }`}>
                    <Target className={`h-6 w-6 ${
                      theme === 'gold' ? 'text-black' : 'text-blue-600'
                    }`} />
                  </div>
                  <div>
                    <h3 className={`text-lg font-semibold ${
                      theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
                    }`}>
                      {performance.campaign.offer || 'Untitled Campaign'}
                    </h3>
                    <p className={`text-sm ${
                      theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
                    }`}>
                      Created {new Date(performance.campaign.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${theme === 'gold' ? 'bg-white/5 text-gray-300' : 'bg-gray-100 text-gray-700'}`}>
                    {performance.primaryChannel === 'email' ? 'Email' : performance.primaryChannel === 'vapi' || performance.primaryChannel === 'call' ? 'Voice' : performance.primaryChannel === 'sms' ? 'SMS' : performance.primaryChannel === 'whatsapp' ? 'WhatsApp' : performance.primaryChannel === 'mixed' ? 'Mixed' : 'Outreach'}
                  </span>
                  <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(performance.campaign.status)}`}>
                    {performance.campaign.status || 'Draft'}
                  </span>
                </div>
              </div>

              {/* Performance Metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className={`p-4 rounded-lg ${
                  theme === 'gold' ? 'bg-yellow-400/5 border border-yellow-400/20' : 'bg-gray-50'
                }`}>
                  <div className="flex items-center space-x-2 mb-2">
                    <Users className={`h-4 w-4 ${
                      theme === 'gold' ? 'text-yellow-400' : 'text-blue-600'
                    }`} />
                    <span className={`text-xs font-medium ${
                      theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
                    }`}>
                      Total Leads
                    </span>
                  </div>
                  <p className={`text-xl font-bold ${
                    theme === 'gold' ? 'text-yellow-400' : 'text-blue-600'
                  }`}>
                    {performance.totalLeads}
                  </p>
                </div>

                <div className={`p-4 rounded-lg ${
                  theme === 'gold' ? 'bg-yellow-400/5 border border-yellow-400/20' : 'bg-gray-50'
                }`}>
                  <div className="flex items-center space-x-2 mb-2">
                    <Phone className={`h-4 w-4 ${
                      theme === 'gold' ? 'text-yellow-400' : 'text-green-600'
                    }`} />
                    <span className={`text-xs font-medium ${
                      theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
                    }`}>
                      Reach
                    </span>
                  </div>
                  <p className={`text-xl font-bold ${
                    theme === 'gold' ? 'text-yellow-400' : 'text-green-600'
                  }`}>
                    {performance.activityStats.reach}
                  </p>
                  <p className={`text-xs mt-1 ${theme === 'gold' ? 'text-gray-500' : 'text-gray-500'}`}>
                    {performance.primaryChannel === 'email' ? 'Email sent' : performance.primaryChannel === 'vapi' || performance.primaryChannel === 'call' ? 'Voice calls' : performance.primaryChannel === 'sms' ? 'SMS sent' : performance.primaryChannel === 'whatsapp' ? 'WhatsApp sent' : performance.primaryChannel === 'mixed' ? 'Mixed channels' : 'Outreach attempts'}
                  </p>
                </div>

                <div className={`p-4 rounded-lg ${
                  theme === 'gold' ? 'bg-yellow-400/5 border border-yellow-400/20' : 'bg-gray-50'
                }`}>
                  <div className="flex items-center space-x-2 mb-2">
                    <MessageSquare className={`h-4 w-4 ${
                      theme === 'gold' ? 'text-yellow-400' : 'text-purple-600'
                    }`} />
                    <span className={`text-xs font-medium ${
                      theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
                    }`}>
                      Replies
                    </span>
                  </div>
                  <p className={`text-xl font-bold ${
                    theme === 'gold' ? 'text-yellow-400' : 'text-purple-600'
                  }`}>
                    {performance.activityStats.replies}
                  </p>
                </div>

                <div className={`p-4 rounded-lg ${
                  theme === 'gold' ? 'bg-yellow-400/5 border border-yellow-400/20' : 'bg-gray-50'
                }`}>
                  <div className="flex items-center space-x-2 mb-2">
                    <Calendar className={`h-4 w-4 ${
                      theme === 'gold' ? 'text-yellow-400' : 'text-orange-600'
                    }`} />
                    <span className={`text-xs font-medium ${
                      theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
                    }`}>
                      Bookings
                    </span>
                  </div>
                  <p className={`text-xl font-bold ${
                    theme === 'gold' ? 'text-yellow-400' : 'text-orange-600'
                  }`}>
                    {performance.activityStats.bookings}
                  </p>
                </div>
              </div>

              {/* Daily Activity Chart */}
              <div className="space-y-4">
                <h4 className={`text-sm font-medium ${
                  theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
                }`}>
                  7-Day Activity Trend
                </h4>
                
                <div className="flex items-end justify-between h-32 px-2">
                  {performance.dailyActivity.map((day, index) => {
                    const maxValue = Math.max(...performance.dailyActivity.map(d => d.total), 1);
                    const height = (day.total / maxValue) * 100;
                    const date = new Date(day.date);
                    const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
                    
                    return (
                      <div key={index} className="flex flex-col items-center space-y-2 flex-1">
                        <div className="relative flex flex-col justify-end h-24 w-6">
                          <div
                            className={`w-full rounded-t-sm transition-all duration-300 ${
                              theme === 'gold' ? 'bg-yellow-400' : 'bg-blue-500'
                            }`}
                            style={{
                              height: `${height}%`,
                              minHeight: day.total > 0 ? '4px' : '2px'
                            }}
                            title={`${day.total} activities`}
                          />
                          {day.total > 0 && (
                            <span className={`absolute -top-6 left-1/2 transform -translate-x-1/2 text-xs font-medium ${
                              theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
                            }`}>
                              {day.total}
                            </span>
                          )}
                        </div>
                        <span className={`text-xs ${
                          theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
                        }`}>
                          {dayName}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Sequence Progress */}
              <div className="space-y-4 mt-6">
                <h4 className={`text-sm font-medium ${
                  theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
                }`}>
                  Sequence Progress
                </h4>
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="text-center">
                    <div className={`text-lg font-bold ${
                      theme === 'gold' ? 'text-yellow-400' : 'text-blue-600'
                    }`}>
                      {performance.sequenceProgress.queued}
                    </div>
                    <div className={`text-xs ${
                      theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
                    }`}>
                      Queued
                    </div>
                  </div>
                  
                  <div className="text-center">
                    <div className={`text-lg font-bold ${
                      theme === 'gold' ? 'text-yellow-400' : 'text-orange-600'
                    }`}>
                      {performance.sequenceProgress.running}
                    </div>
                    <div className={`text-xs ${
                      theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
                    }`}>
                      Running
                    </div>
                  </div>
                  
                  <div className="text-center">
                    <div className={`text-lg font-bold ${
                      theme === 'gold' ? 'text-yellow-400' : 'text-green-600'
                    }`}>
                      {performance.sequenceProgress.done}
                    </div>
                    <div className={`text-xs ${
                      theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
                    }`}>
                      Completed / Reached
                    </div>
                  </div>
                  
                  <div className="text-center">
                    <div className={`text-lg font-bold ${
                      theme === 'gold' ? 'text-red-400' : 'text-red-600'
                    }`}>
                      {performance.sequenceProgress.failed}
                    </div>
                    <div className={`text-xs ${
                      theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
                    }`}>
                      Failed
                    </div>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className={theme === 'gold' ? 'text-gray-400' : 'text-gray-600'}>
                      Progress
                    </span>
                    <span className={theme === 'gold' ? 'text-yellow-400' : 'text-blue-600'}>
                      {performance.responseRate.toFixed(1)}% Response Rate
                    </span>
                  </div>
                  <div className={`w-full bg-gray-200 rounded-full h-2 ${
                    theme === 'gold' ? 'bg-gray-700' : 'bg-gray-200'
                  }`}>
                    <div
                      className={`h-2 rounded-full ${
                        theme === 'gold' ? 'gold-gradient' : 'bg-blue-600'
                      }`}
                      style={{
                        width: `${performance.totalLeads > 0 
                          ? (performance.sequenceProgress.done / performance.totalLeads) * 100 
                          : 0}%`
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}