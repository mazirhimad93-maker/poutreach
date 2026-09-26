import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../lib/supabase';
import {
  Activity,
  Calendar,
  Clock,
  Crown,
  Mail,
  MessageSquare,
  RefreshCw,
  Search,
  Target,
  Users,
} from 'lucide-react';

interface Campaign {
  id: string;
  name: string | null;
  offer: string | null;
  status: string | null;
  created_at: string;
}

interface DailyPoint {
  date: string;
  total: number;
  replies: number;
}

interface CampaignPerformance {
  campaign: Campaign;
  totalLeads: number;
  sequenceProgress: {
    ready: number;
    running: number;
    reached: number;
    failed: number;
  };
  primaryChannel: string;
  activityStats: {
    email: number;
    reach: number;
    replies: number;
    bookings: number;
  };
  responseRate: number;
  dailyActivity: DailyPoint[];
}

interface LiveEmail {
  id: string;
  campaign_id: string;
  campaign_name: string;
  lead_name: string;
  lead_email: string;
  subject: string;
  preview: string;
  timestamp: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function dateKeys(days: number) {
  const keys: string[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    keys.push(utcDateKey(new Date(now.getTime() - i * DAY_MS)));
  }
  return keys;
}

function dateRangeKeys(start: string, end: string) {
  if (!start) return [];
  const safeEnd = end || start;
  const a = new Date(start + 'T00:00:00Z');
  const b = new Date(safeEnd + 'T00:00:00Z');
  const from = a <= b ? a : b;
  const to = a <= b ? b : a;
  const keys: string[] = [];

  for (let cursor = new Date(from); cursor <= to; cursor = new Date(cursor.getTime() + DAY_MS)) {
    keys.push(utcDateKey(cursor));
  }

  return keys;
}

function campaignTitle(campaign: Campaign) {
  const name = (campaign.name || '').trim();
  const offer = (campaign.offer || '').trim();
  const generic = ['new campaign', 'campaign', 'creators'];
  if (name && !generic.includes(name.toLowerCase())) return name;
  return offer || name || 'Untitled Campaign';
}

function stripHtml(value: string) {
  return String(value || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function LeadsTracker() {
  const { user } = useAuth();
  const { theme } = useTheme();

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [performanceData, setPerformanceData] = useState<CampaignPerformance[]>([]);
  const [liveEmails, setLiveEmails] = useState<LiveEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [reachRange, setReachRange] = useState<1 | 7 | 14 | 30>(7);
  const [dateMode, setDateMode] = useState<'preset' | 'day' | 'range'>('preset');
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [customStartDate, setCustomStartDate] = useState(utcDateKey(new Date()));
  const [customEndDate, setCustomEndDate] = useState(utcDateKey(new Date()));

  const gold = theme === 'gold';
  const card = gold ? 'black-card gold-border' : 'bg-white border-gray-200';
  const muted = gold ? 'text-gray-400' : 'text-gray-600';

  useEffect(() => {
    if (user) fetchCampaignPerformance();
  }, [user]);

  useEffect(() => {
    if (!autoRefresh || !user) return;
    const interval = setInterval(fetchCampaignPerformance, 15000);
    return () => clearInterval(interval);
  }, [autoRefresh, user]);

  async function fetchLiveEmails(ownedCampaigns: Campaign[]) {
    if (!ownedCampaigns.length) {
      setLiveEmails([]);
      return;
    }

    const campaignIds = ownedCampaigns.map((campaign) => campaign.id);
    const { data: rows, error } = await supabase
      .from('conversation_history')
      .select('id,campaign_id,lead_id,email_subject,email_body,message,timestamp,created_at')
      .in('campaign_id', campaignIds)
      .eq('channel', 'email')
      .eq('from_role', 'ai')
      .order('timestamp', { ascending: false })
      .limit(15);

    if (error) {
      console.error('Error fetching live email feed:', error);
      return;
    }

    const leadIds = [...new Set((rows || []).map((row: any) => row.lead_id).filter(Boolean))];
    const leadById = new Map<string, any>();

    if (leadIds.length) {
      const { data: leads, error: leadsError } = await supabase
        .from('uploaded_leads')
        .select('id,name,email')
        .in('id', leadIds);

      if (!leadsError) {
        for (const lead of leads || []) leadById.set(lead.id, lead);
      }
    }

    const campaignById = new Map(ownedCampaigns.map((campaign) => [campaign.id, campaign]));

    const formatted = (rows || []).map((row: any) => {
      const lead = leadById.get(row.lead_id) || {};
      const campaign = campaignById.get(row.campaign_id);
      return {
        id: row.id,
        campaign_id: row.campaign_id,
        campaign_name: campaign ? campaignTitle(campaign) : 'Unknown campaign',
        lead_name: lead.name || lead.email || 'Unknown lead',
        lead_email: lead.email || '',
        subject: row.email_subject || 'Business Inquiries',
        preview: stripHtml(row.email_body || row.message || '').slice(0, 180),
        timestamp: row.timestamp || row.created_at,
      } as LiveEmail;
    });

    setLiveEmails(formatted);
  }

  async function fetchCampaignPerformance() {
    if (!user) return;

    try {
      const campaignsResult = await supabase
        .from('campaigns')
        .select('id,name,offer,status,created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (campaignsResult.error) throw campaignsResult.error;

      const ownedCampaigns = (campaignsResult.data || []) as Campaign[];
      setCampaigns(ownedCampaigns);
      const campaignIds = ownedCampaigns.map((campaign) => campaign.id);

      const [summaryResult, sequencesResult, dailyResult, repliesResult] = await Promise.all([
        supabase
          .from('campaign_performance_summary')
          .select('*')
          .eq('user_id', user.id),
        supabase
          .from('campaign_sequences')
          .select('campaign_id,type,step_number')
          .eq('user_id', user.id)
          .order('step_number', { ascending: true }),
        supabase
          .from('campaign_daily_reach')
          .select('campaign_id,activity_date,total')
          .eq('user_id', user.id)
          .order('activity_date', { ascending: true })
          .limit(10000),
        campaignIds.length
          ? supabase
              .from('conversation_history')
              .select('id,campaign_id,timestamp')
              .in('campaign_id', campaignIds)
              .eq('from_role', 'lead')
              .order('timestamp', { ascending: true })
              .limit(5000)
          : Promise.resolve({ data: [], error: null } as any),
      ]);

      if (summaryResult.error) throw summaryResult.error;
      if (sequencesResult.error) throw sequencesResult.error;
      if (dailyResult.error) throw dailyResult.error;
      if (repliesResult.error) throw repliesResult.error;

      const summaryByCampaign = new Map(
        (summaryResult.data || []).map((row: any) => [row.campaign_id, row]),
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
      const allDates = new Set<string>(dateKeys(30));

      for (const row of dailyResult.data || []) {
        const date = String(row.activity_date);
        allDates.add(date);
        if (!dailyByCampaign.has(row.campaign_id)) {
          dailyByCampaign.set(row.campaign_id, new Map());
        }
        dailyByCampaign
          .get(row.campaign_id)!
          .set(date, Number(row.total || 0));
      }

      const repliesByCampaign = new Map<string, Map<string, number>>();
      for (const row of repliesResult.data || []) {
        if (!row.timestamp) continue;
        const date = utcDateKey(new Date(row.timestamp));
        allDates.add(date);
        if (!repliesByCampaign.has(row.campaign_id)) {
          repliesByCampaign.set(row.campaign_id, new Map());
        }
        const current = repliesByCampaign.get(row.campaign_id)!.get(date) || 0;
        repliesByCampaign.get(row.campaign_id)!.set(date, current + 1);
      }

      const sortedDates = [...allDates].sort();

      const performance = ownedCampaigns.map((campaign) => {
        const summary: any = summaryByCampaign.get(campaign.id) || {};
        const channelTypes = typesByCampaign.get(campaign.id) || [];
        const dailyMap = dailyByCampaign.get(campaign.id) || new Map<string, number>();
        const replyMap = repliesByCampaign.get(campaign.id) || new Map<string, number>();

        const reach = Number(summary.reach || 0);
        const replies = Number(summary.replies || 0);
        const reachedLeads = Number(summary.reached_leads || 0);

        const primaryChannel =
          channelTypes.length === 1
            ? channelTypes[0]
            : channelTypes.length > 1
              ? 'mixed'
              : Number(summary.email || 0) > 0
                ? 'email'
                : 'outreach';

        return {
          campaign,
          totalLeads: Number(summary.total_leads || 0),
          sequenceProgress: {
            ready: Number(summary.queued || 0),
            running: Number(summary.running || 0),
            reached: reachedLeads,
            failed: Number(summary.failed || 0),
          },
          primaryChannel,
          activityStats: {
            email: Number(summary.email || 0),
            reach,
            replies,
            bookings: Number(summary.bookings || 0),
          },
          responseRate: reach > 0 ? (replies / reach) * 100 : 0,
          dailyActivity: sortedDates.map((date) => ({
            date,
            total: dailyMap.get(date) || 0,
            replies: replyMap.get(date) || 0,
          })),
        } as CampaignPerformance;
      });

      setPerformanceData(performance);
      await fetchLiveEmails(ownedCampaigns);
      setLastUpdate(new Date());
    } catch (error) {
      console.error('Error fetching campaign performance:', error);
    } finally {
      setLoading(false);
    }
  }

  const uniqueStatuses = [...new Set(campaigns.map((campaign) => campaign.status).filter(Boolean))];

  const filteredPerformance = performanceData.filter((performance) => {
    const haystack = [
      campaignTitle(performance.campaign),
      performance.campaign.offer || '',
      performance.campaign.name || '',
    ]
      .join(' ')
      .toLowerCase();

    const matchesSearch = !searchTerm || haystack.includes(searchTerm.toLowerCase());
    const matchesStatus = !selectedStatus || performance.campaign.status === selectedStatus;
    return matchesSearch && matchesStatus;
  });

  const totalMetrics = useMemo(
    () =>
      performanceData.reduce(
        (acc, performance) => ({
          totalLeads: acc.totalLeads + performance.totalLeads,
          totalReach: acc.totalReach + performance.activityStats.reach,
          totalReplies: acc.totalReplies + performance.activityStats.replies,
          totalBookings: acc.totalBookings + performance.activityStats.bookings,
        }),
        { totalLeads: 0, totalReach: 0, totalReplies: 0, totalBookings: 0 },
      ),
    [performanceData],
  );

  const selectedKeys = useMemo(() => {
    if (dateMode === 'day') return customStartDate ? [customStartDate] : [];
    if (dateMode === 'range') return dateRangeKeys(customStartDate, customEndDate);
    return dateKeys(reachRange);
  }, [dateMode, customStartDate, customEndDate, reachRange]);

  const selectedDateKeys = useMemo(() => new Set(selectedKeys), [selectedKeys]);

  const selectedRangeLabel = useMemo(() => {
    if (!selectedKeys.length) return 'No date selected';
    const format = (value: string) =>
      new Date(value + 'T00:00:00Z').toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      });

    if (selectedKeys.length === 1) return format(selectedKeys[0]);
    return `${format(selectedKeys[0])} – ${format(selectedKeys[selectedKeys.length - 1])}`;
  }, [selectedKeys]);

  const rangeDaily = useMemo(
    () =>
      selectedKeys.map((date) => ({
        date,
        total: performanceData.reduce((sum, performance) => {
          const point = performance.dailyActivity.find((day) => day.date === date);
          return sum + Number(point?.total || 0);
        }, 0),
        replies: performanceData.reduce((sum, performance) => {
          const point = performance.dailyActivity.find((day) => day.date === date);
          return sum + Number(point?.replies || 0);
        }, 0),
      })),
    [performanceData, selectedKeys],
  );

  const rangeCampaigns = useMemo(
    () =>
      performanceData
        .map((performance) => {
          const selected = performance.dailyActivity.filter((day) => selectedDateKeys.has(day.date));
          const total = selected.reduce((sum, day) => sum + day.total, 0);
          const replies = selected.reduce((sum, day) => sum + day.replies, 0);
          return {
            id: performance.campaign.id,
            name: campaignTitle(performance.campaign),
            total,
            replies,
            replyRate: total > 0 ? (replies / total) * 100 : 0,
          };
        })
        .filter((row) => row.total > 0 || row.replies > 0)
        .sort((a, b) => b.total - a.total || b.replies - a.replies),
    [performanceData, selectedDateKeys],
  );

  const rangeTotal = rangeDaily.reduce((sum, day) => sum + day.total, 0);
  const rangeReplies = rangeDaily.reduce((sum, day) => sum + day.replies, 0);
  const rangeReplyRate = rangeTotal > 0 ? (rangeReplies / rangeTotal) * 100 : 0;
  const campaignsReaching = rangeCampaigns.filter((campaign) => campaign.total > 0).length;
  const maxRangeDaily = Math.max(...rangeDaily.map((day) => day.total), 1);
  const maxRangeReplies = Math.max(...rangeDaily.map((day) => day.replies), 1);
  const maxCampaignRange = Math.max(...rangeCampaigns.map((campaign) => campaign.total), 1);

  const getStatusColor = (status: string | null) => {
    switch (String(status || '').toLowerCase()) {
      case 'active':
        return gold ? 'bg-green-500/20 text-green-400' : 'bg-green-100 text-green-800';
      case 'paused':
        return gold ? 'bg-yellow-500/20 text-yellow-400' : 'bg-yellow-100 text-yellow-800';
      case 'completed':
        return gold ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-800';
      default:
        return gold ? 'bg-gray-500/20 text-gray-400' : 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="relative">
          <div
            className={`h-12 w-12 animate-spin rounded-full border-4 border-transparent ${
              gold ? 'border-r-yellow-500 border-t-yellow-400' : 'border-r-blue-500 border-t-blue-600'
            }`}
          />
          <Activity
            className={`absolute inset-0 m-auto h-4 w-4 ${gold ? 'text-yellow-400' : 'text-blue-600'}`}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between gap-4">
          <div className="mb-2 flex items-center space-x-3">
            {gold ? (
              <Crown className="h-8 w-8 text-yellow-400" />
            ) : (
              <Activity className="h-8 w-8 text-blue-600" />
            )}
            <h1 className={`text-3xl font-bold ${gold ? 'gold-text-gradient' : 'text-gray-900'}`}>
              Cold Performance
            </h1>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`rounded-lg p-2 transition-colors ${
                autoRefresh
                  ? gold
                    ? 'bg-yellow-400/20 text-yellow-400'
                    : 'bg-blue-100 text-blue-600'
                  : gold
                    ? 'bg-gray-800 text-gray-400'
                    : 'bg-gray-100 text-gray-500'
              }`}
              title={autoRefresh ? 'Auto-refresh enabled' : 'Auto-refresh disabled'}
            >
              <RefreshCw className={`h-4 w-4 ${autoRefresh ? 'animate-spin' : ''}`} />
            </button>
            <span className={`text-xs ${gold ? 'text-gray-400' : 'text-gray-500'}`}>
              Last updated: {lastUpdate.toLocaleTimeString()}
            </span>
          </div>
        </div>
        <p className={muted}>
          Accurate sequence state, actual sent activity, replies, and campaign reach.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          ['Total Leads', totalMetrics.totalLeads, Users, gold ? 'text-yellow-400' : 'text-blue-600'],
          ['Reach', totalMetrics.totalReach, Mail, gold ? 'text-yellow-400' : 'text-green-600'],
          ['Replies', totalMetrics.totalReplies, MessageSquare, gold ? 'text-yellow-400' : 'text-purple-600'],
          ['Total Bookings', totalMetrics.totalBookings, Calendar, gold ? 'text-yellow-400' : 'text-orange-600'],
        ].map(([label, value, Icon, color]: any) => (
          <div key={label} className={`rounded-lg border p-4 ${card}`}>
            <div className="mb-2 flex items-center space-x-2">
              <Icon className={`h-4 w-4 ${color}`} />
              <span className={`text-xs font-medium ${muted}`}>{label}</span>
            </div>
            <p className={`text-2xl font-bold ${color}`}>{Number(value).toLocaleString()}</p>
          </div>
        ))}
      </div>

      <section className={`rounded-xl border ${card}`}>
        <div className={`flex flex-col gap-3 border-b px-6 py-4 sm:flex-row sm:items-start sm:justify-between ${
          gold ? 'border-yellow-400/20' : 'border-gray-200'
        }`}>
          <div>
            <div className="flex items-center gap-2">
              <Activity className={`h-5 w-5 ${gold ? 'text-yellow-400' : 'text-blue-600'}`} />
              <h2 className={`text-lg font-semibold ${gold ? 'text-gray-200' : 'text-gray-900'}`}>
                Reach & Replies
              </h2>
            </div>
            <p className={`mt-1 text-xs ${muted}`}>
              Actual successful outreach and inbound replies for {selectedRangeLabel}.
            </p>
          </div>

          <div className="relative">
            <div className="flex flex-wrap items-center rounded-lg border p-1 text-xs font-medium">
              {([
                [1, 'Today'],
                [7, '7D'],
                [14, '14D'],
                [30, '30D'],
              ] as const).map(([days, label]) => (
                <button
                  key={days}
                  onClick={() => {
                    setReachRange(days);
                    setDateMode('preset');
                    setCalendarOpen(false);
                  }}
                  className={`rounded-md px-3 py-1.5 transition-colors ${
                    dateMode === 'preset' && reachRange === days
                      ? gold
                        ? 'bg-yellow-400 text-black'
                        : 'bg-blue-600 text-white'
                      : gold
                        ? 'text-gray-400 hover:bg-white/5'
                        : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {label}
                </button>
              ))}

              <button
                onClick={() => setCalendarOpen((open) => !open)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors ${
                  dateMode !== 'preset'
                    ? gold
                      ? 'bg-yellow-400 text-black'
                      : 'bg-blue-600 text-white'
                    : gold
                      ? 'text-gray-400 hover:bg-white/5'
                      : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <Calendar className="h-3.5 w-3.5" />
                Calendar
              </button>
            </div>

            {calendarOpen && (
              <div className={`absolute right-0 z-30 mt-2 w-72 rounded-xl border p-4 shadow-xl ${
                gold ? 'border-yellow-400/30 bg-gray-950' : 'border-gray-200 bg-white'
              }`}>
                <div className="mb-3 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      setDateMode('day');
                      setCustomEndDate(customStartDate);
                    }}
                    className={`rounded-lg px-3 py-2 text-xs font-medium ${
                      dateMode === 'day'
                        ? gold
                          ? 'bg-yellow-400 text-black'
                          : 'bg-blue-600 text-white'
                        : gold
                          ? 'bg-white/5 text-gray-300'
                          : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    Single day
                  </button>
                  <button
                    onClick={() => setDateMode('range')}
                    className={`rounded-lg px-3 py-2 text-xs font-medium ${
                      dateMode === 'range'
                        ? gold
                          ? 'bg-yellow-400 text-black'
                          : 'bg-blue-600 text-white'
                        : gold
                          ? 'bg-white/5 text-gray-300'
                          : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    Date range
                  </button>
                </div>

                {dateMode === 'range' ? (
                  <div className="grid grid-cols-2 gap-3">
                    <label className={`text-xs ${muted}`}>
                      From
                      <input
                        type="date"
                        value={customStartDate}
                        max={utcDateKey(new Date())}
                        onChange={(event) => {
                          const next = event.target.value;
                          setCustomStartDate(next);
                          if (!customEndDate || customEndDate < next) setCustomEndDate(next);
                        }}
                        className={`mt-1 w-full rounded-lg border px-2 py-2 text-xs ${
                          gold
                            ? 'border-yellow-400/30 bg-black text-gray-200'
                            : 'border-gray-300 bg-white text-gray-900'
                        }`}
                      />
                    </label>
                    <label className={`text-xs ${muted}`}>
                      To
                      <input
                        type="date"
                        value={customEndDate}
                        min={customStartDate}
                        max={utcDateKey(new Date())}
                        onChange={(event) => setCustomEndDate(event.target.value)}
                        className={`mt-1 w-full rounded-lg border px-2 py-2 text-xs ${
                          gold
                            ? 'border-yellow-400/30 bg-black text-gray-200'
                            : 'border-gray-300 bg-white text-gray-900'
                        }`}
                      />
                    </label>
                  </div>
                ) : (
                  <label className={`text-xs ${muted}`}>
                    Day
                    <input
                      type="date"
                      value={customStartDate}
                      max={utcDateKey(new Date())}
                      onChange={(event) => {
                        setCustomStartDate(event.target.value);
                        setCustomEndDate(event.target.value);
                        setDateMode('day');
                      }}
                      className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm ${
                        gold
                          ? 'border-yellow-400/30 bg-black text-gray-200'
                          : 'border-gray-300 bg-white text-gray-900'
                      }`}
                    />
                  </label>
                )}

                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className={`truncate text-[11px] ${muted}`}>{selectedRangeLabel}</span>
                  <button
                    onClick={() => setCalendarOpen(false)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                      gold ? 'bg-yellow-400 text-black' : 'bg-blue-600 text-white'
                    }`}
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-5 p-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className={`rounded-lg p-3 ${gold ? 'bg-white/5' : 'bg-gray-50'}`}>
              <div className={`text-xs ${muted}`}>Selected Reach</div>
              <div className={`mt-1 text-xl font-bold ${gold ? 'text-yellow-400' : 'text-blue-600'}`}>
                {rangeTotal.toLocaleString()}
              </div>
            </div>
            <div className={`rounded-lg p-3 ${gold ? 'bg-white/5' : 'bg-gray-50'}`}>
              <div className={`text-xs ${muted}`}>Replies</div>
              <div className={`mt-1 text-xl font-bold ${gold ? 'text-yellow-400' : 'text-purple-600'}`}>
                {rangeReplies.toLocaleString()}
              </div>
            </div>
            <div className={`rounded-lg p-3 ${gold ? 'bg-white/5' : 'bg-gray-50'}`}>
              <div className={`text-xs ${muted}`}>Reply Rate</div>
              <div className={`mt-1 text-xl font-bold ${gold ? 'text-yellow-400' : 'text-green-600'}`}>
                {rangeReplyRate.toFixed(2)}%
              </div>
              <div className={`mt-1 text-[10px] ${muted}`}>Replies ÷ reach</div>
            </div>
            <div className={`rounded-lg p-3 ${gold ? 'bg-white/5' : 'bg-gray-50'}`}>
              <div className={`text-xs ${muted}`}>Campaigns Reaching</div>
              <div className={`mt-1 text-xl font-bold ${gold ? 'text-yellow-400' : 'text-gray-900'}`}>
                {campaignsReaching}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <div className={`flex items-center gap-1.5 ${muted}`}>
              <span className={`h-2.5 w-2.5 rounded-sm ${gold ? 'bg-yellow-400' : 'bg-blue-500'}`} />
              Reach
            </div>
            <div className={`flex items-center gap-1.5 ${muted}`}>
              <span className="h-2.5 w-2.5 rounded-sm bg-purple-500" />
              Replies
            </div>
          </div>

          <div className="overflow-x-auto pb-1">
            <div
              className="flex h-40 items-end gap-2"
              style={{ minWidth: `${Math.max(100, rangeDaily.length * 46)}px` }}
            >
              {rangeDaily.map((day) => {
                const reachHeight = day.total ? Math.max(5, (day.total / maxRangeDaily) * 100) : 2;
                const replyHeight = day.replies ? Math.max(8, (day.replies / maxRangeReplies) * 100) : 2;
                const label = new Date(day.date + 'T00:00:00Z').toLocaleDateString('en-US', {
                  month: rangeDaily.length > 7 ? 'numeric' : undefined,
                  day: rangeDaily.length > 7 ? 'numeric' : undefined,
                  weekday: rangeDaily.length <= 7 ? 'short' : undefined,
                  timeZone: 'UTC',
                });

                return (
                  <div key={day.date} className="flex min-w-[38px] flex-1 flex-col items-center justify-end gap-1">
                    <div className="flex h-28 items-end justify-center gap-1">
                      <div
                        className={`w-4 rounded-t-sm ${gold ? 'bg-yellow-400' : 'bg-blue-500'}`}
                        style={{ height: `${reachHeight}%` }}
                        title={`${day.date}: ${day.total} reach`}
                      />
                      <div
                        className="w-3 rounded-t-sm bg-purple-500"
                        style={{ height: `${replyHeight}%` }}
                        title={`${day.date}: ${day.replies} replies`}
                      />
                    </div>
                    <div className="flex items-center gap-1 text-[10px]">
                      <span className={gold ? 'text-yellow-400' : 'text-blue-600'}>{day.total || 0}</span>
                      <span className={gold ? 'text-gray-600' : 'text-gray-300'}>·</span>
                      <span className="text-purple-600">{day.replies || 0}</span>
                    </div>
                    <span className={`truncate text-[10px] ${muted}`}>{label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <div className={`mb-2 flex items-center justify-between text-xs font-medium uppercase tracking-wide ${muted}`}>
              <span>Campaign contribution</span>
              <span className="normal-case tracking-normal">{selectedRangeLabel}</span>
            </div>

            {rangeCampaigns.length === 0 ? (
              <div className={`rounded-lg p-4 text-sm ${gold ? 'bg-white/5' : 'bg-gray-50'} ${muted}`}>
                No reach or replies recorded in this period.
              </div>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {rangeCampaigns.map((campaign) => (
                  <div key={campaign.id} className={`rounded-lg border p-3 ${gold ? 'border-white/10' : 'border-gray-100'}`}>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className={`truncate text-sm font-medium ${gold ? 'text-gray-200' : 'text-gray-900'}`}>
                        {campaign.name}
                      </span>
                      <div className="flex shrink-0 items-center gap-2 text-xs font-semibold">
                        <span className={gold ? 'text-yellow-400' : 'text-blue-600'}>
                          {campaign.total.toLocaleString()} reach
                        </span>
                        <span className="text-purple-600">
                          {campaign.replies.toLocaleString()} replies
                        </span>
                      </div>
                    </div>
                    <div className="mb-1 flex items-center justify-between text-[10px]">
                      <span className={muted}>Reply rate</span>
                      <span className={gold ? 'text-yellow-400' : 'text-green-600'}>
                        {campaign.replyRate.toFixed(2)}%
                      </span>
                    </div>
                    <div className={`h-1.5 overflow-hidden rounded-full ${gold ? 'bg-gray-800' : 'bg-gray-100'}`}>
                      <div
                        className={`h-full rounded-full ${gold ? 'bg-yellow-400' : 'bg-blue-500'}`}
                        style={{
                          width: `${campaign.total > 0 ? Math.max(2, (campaign.total / maxCampaignRange) * 100) : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className={`rounded-xl border ${card}`}>
        <div className={`flex items-center justify-between border-b px-6 py-4 ${
          gold ? 'border-yellow-400/20' : 'border-gray-200'
        }`}>
          <div className="flex items-center gap-2">
            <Mail className={`h-5 w-5 ${gold ? 'text-yellow-400' : 'text-blue-600'}`} />
            <h2 className={`text-lg font-semibold ${gold ? 'text-gray-200' : 'text-gray-900'}`}>
              Live Email Feed
            </h2>
            <div className={`h-2 w-2 animate-pulse rounded-full ${gold ? 'bg-yellow-400' : 'bg-green-500'}`} />
          </div>
          <span className={`text-xs ${muted}`}>Latest sent across all campaigns</span>
        </div>

        <div className="p-4">
          {liveEmails.length === 0 ? (
            <div className={`py-8 text-center ${muted}`}>
              <Clock className="mx-auto mb-3 h-10 w-10 opacity-60" />
              Latest sent emails will appear here.
            </div>
          ) : (
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {liveEmails.map((email) => (
                <div
                  key={email.id}
                  className={`grid gap-2 rounded-lg border p-3 md:grid-cols-[minmax(170px,0.8fr)_minmax(220px,1fr)_minmax(260px,1.6fr)_90px] md:items-center ${
                    gold ? 'border-white/10 bg-white/5' : 'border-gray-100 bg-gray-50'
                  }`}
                >
                  <div className="min-w-0">
                    <div className={`truncate text-sm font-medium ${gold ? 'text-gray-200' : 'text-gray-900'}`}>
                      {email.lead_name}
                    </div>
                    <div className={`truncate text-xs ${muted}`}>{email.lead_email}</div>
                  </div>
                  <div className="min-w-0">
                    <div className={`truncate text-xs font-medium ${gold ? 'text-yellow-400' : 'text-blue-600'}`}>
                      {email.campaign_name}
                    </div>
                    <div className={`truncate text-xs ${muted}`}>{email.subject}</div>
                  </div>
                  <div className={`truncate text-sm ${gold ? 'text-gray-300' : 'text-gray-700'}`}>
                    {email.preview || 'Email sent'}
                  </div>
                  <div className="text-right">
                    <div className={`text-xs font-medium ${gold ? 'text-green-400' : 'text-green-700'}`}>Sent</div>
                    <div className={`text-[11px] ${muted}`}>
                      {new Date(email.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className={`rounded-xl border p-4 shadow-sm ${card}`}>
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <div className="flex-1">
            <div className="relative">
              <Search className={`absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${gold ? 'text-yellow-400' : 'text-gray-400'}`} />
              <input
                type="text"
                placeholder="Search campaigns..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className={`w-full rounded-lg border py-2 pl-10 pr-4 focus:border-transparent focus:outline-none focus:ring-2 ${
                  gold
                    ? 'border-yellow-400/30 bg-black/50 text-gray-200 placeholder-gray-500 focus:ring-yellow-400'
                    : 'border-gray-300 bg-white text-gray-900 focus:ring-blue-500'
                }`}
              />
            </div>
          </div>

          <select
            value={selectedStatus}
            onChange={(event) => setSelectedStatus(event.target.value)}
            className={`rounded-lg border px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 ${
              gold
                ? 'border-yellow-400/30 bg-black/50 text-gray-200 focus:ring-yellow-400'
                : 'border-gray-300 bg-white text-gray-900 focus:ring-blue-500'
            }`}
          >
            <option value="">All Statuses</option>
            {uniqueStatuses.map((status) => (
              <option key={status} value={status || ''}>
                {status ? status.charAt(0).toUpperCase() + status.slice(1) : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-4">
        {filteredPerformance.map((performance) => {
          const title = campaignTitle(performance.campaign);
          const selectedDaily = selectedKeys.map((date) => {
            const point = performance.dailyActivity.find((day) => day.date === date);
            return {
              date,
              total: Number(point?.total || 0),
              replies: Number(point?.replies || 0),
            };
          });
          const selectedReach = selectedDaily.reduce((sum, day) => sum + day.total, 0);
          const selectedReplies = selectedDaily.reduce((sum, day) => sum + day.replies, 0);
          const selectedReplyRate = selectedReach > 0 ? (selectedReplies / selectedReach) * 100 : 0;
          const maxSelectedReach = Math.max(...selectedDaily.map((day) => day.total), 1);
          const maxSelectedReplies = Math.max(...selectedDaily.map((day) => day.replies), 1);
          const offer = (performance.campaign.offer || '').trim();
          const showOffer = offer && offer !== title;

          return (
            <article
              key={performance.campaign.id}
              className={`rounded-xl border p-6 transition-all duration-300 ${card} ${
                gold ? 'hover:gold-shadow' : 'hover:shadow-lg'
              }`}
            >
              <div className="mb-6 flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center space-x-4">
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${gold ? 'gold-gradient' : 'bg-blue-100'}`}>
                    <Target className={`h-6 w-6 ${gold ? 'text-black' : 'text-blue-600'}`} />
                  </div>
                  <div className="min-w-0">
                    <h3 className={`truncate text-lg font-semibold ${gold ? 'text-gray-200' : 'text-gray-900'}`}>
                      {title}
                    </h3>
                    {showOffer && <p className={`truncate text-xs ${muted}`}>Offer: {offer}</p>}
                    <p className={`text-sm ${muted}`}>
                      Created {new Date(performance.campaign.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                    gold ? 'bg-white/5 text-gray-300' : 'bg-gray-100 text-gray-700'
                  }`}>
                    {performance.primaryChannel === 'email' ? 'Email' : performance.primaryChannel === 'mixed' ? 'Mixed' : 'Outreach'}
                  </span>
                  <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${getStatusColor(performance.campaign.status)}`}>
                    {performance.campaign.status || 'Draft'}
                  </span>
                </div>
              </div>

              <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
                {[
                  {
                    label: 'Campaign Leads',
                    value: performance.totalLeads.toLocaleString(),
                    Icon: Users,
                    color: gold ? 'text-yellow-400' : 'text-blue-600',
                    note: 'All-time list size',
                  },
                  {
                    label: 'Reach',
                    value: selectedReach.toLocaleString(),
                    Icon: Mail,
                    color: gold ? 'text-yellow-400' : 'text-green-600',
                    note: selectedRangeLabel,
                  },
                  {
                    label: 'Replies',
                    value: selectedReplies.toLocaleString(),
                    Icon: MessageSquare,
                    color: gold ? 'text-yellow-400' : 'text-purple-600',
                    note: selectedRangeLabel,
                  },
                  {
                    label: 'Reply Rate',
                    value: selectedReplyRate.toFixed(2) + '%',
                    Icon: Activity,
                    color: gold ? 'text-yellow-400' : 'text-green-600',
                    note: 'Replies ÷ reach · ' + selectedRangeLabel,
                  },
                ].map(({ label, value, Icon, color, note }) => (
                  <div key={label} className={`rounded-lg p-4 ${gold ? 'border border-yellow-400/20 bg-yellow-400/5' : 'bg-gray-50'}`}>
                    <div className="mb-2 flex items-center space-x-2">
                      <Icon className={`h-4 w-4 ${color}`} />
                      <span className={`text-xs font-medium ${muted}`}>{label}</span>
                    </div>
                    <p className={`text-xl font-bold ${color}`}>{value}</p>
                    <p className={`mt-1 truncate text-xs ${muted}`}>{note}</p>
                  </div>
                ))}
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className={`text-sm font-medium ${gold ? 'text-gray-300' : 'text-gray-700'}`}>
                    Selected timeline
                  </h4>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs ${muted}`}>{selectedRangeLabel}</span>
                    <span className={`flex items-center gap-1 text-[10px] ${muted}`}>
                      <span className={`h-2 w-2 rounded-sm ${gold ? 'bg-yellow-400' : 'bg-blue-500'}`} />
                      Reach
                    </span>
                    <span className={`flex items-center gap-1 text-[10px] ${muted}`}>
                      <span className="h-2 w-2 rounded-sm bg-purple-500" />
                      Replies
                    </span>
                  </div>
                </div>
                <div className="mt-3 overflow-x-auto pb-1">
                  <div
                    className="flex h-32 items-end gap-2 px-2"
                    style={{ minWidth: `${Math.max(100, selectedDaily.length * 42)}px` }}
                  >
                    {selectedDaily.map((day) => {
                      const reachHeight = day.total ? Math.max(5, (day.total / maxSelectedReach) * 100) : 2;
                      const replyHeight = day.replies ? Math.max(8, (day.replies / maxSelectedReplies) * 100) : 2;
                      const dayName = new Date(day.date + 'T00:00:00Z').toLocaleDateString('en-US', {
                        month: selectedDaily.length > 7 ? 'numeric' : undefined,
                        day: selectedDaily.length > 7 ? 'numeric' : undefined,
                        weekday: selectedDaily.length <= 7 ? 'short' : undefined,
                        timeZone: 'UTC',
                      });
                      return (
                        <div key={day.date} className="flex min-w-[34px] flex-1 flex-col items-center gap-1">
                          <div className="flex h-20 items-end gap-1">
                            <div
                              className={`w-4 rounded-t-sm ${gold ? 'bg-yellow-400' : 'bg-blue-500'}`}
                              style={{ height: `${reachHeight}%` }}
                              title={`${day.total} reach`}
                            />
                            <div
                              className="w-3 rounded-t-sm bg-purple-500"
                              style={{ height: `${replyHeight}%` }}
                              title={`${day.replies} replies`}
                            />
                          </div>
                          <div className="flex items-center gap-1 text-[10px]">
                            <span className={gold ? 'text-yellow-400' : 'text-blue-600'}>{day.total}</span>
                            <span className={gold ? 'text-gray-600' : 'text-gray-300'}>·</span>
                            <span className="text-purple-600">{day.replies}</span>
                          </div>
                          <span className={`text-[10px] ${muted}`}>{dayName}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="mt-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className={`text-sm font-medium ${gold ? 'text-gray-300' : 'text-gray-700'}`}>Current Sequence Progress</h4>
                  <span className={`text-xs ${muted}`}>Ready reflects rows marked ready / queued in the sequencer</span>
                </div>

                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <div className="text-center">
                    <div className={`text-lg font-bold ${gold ? 'text-yellow-400' : 'text-blue-600'}`}>
                      {performance.sequenceProgress.ready.toLocaleString()}
                    </div>
                    <div className={`text-xs ${muted}`}>Ready / Queued</div>
                  </div>
                  <div className="text-center">
                    <div className={`text-lg font-bold ${gold ? 'text-yellow-400' : 'text-orange-600'}`}>
                      {performance.sequenceProgress.running.toLocaleString()}
                    </div>
                    <div className={`text-xs ${muted}`}>Running</div>
                  </div>
                  <div className="text-center">
                    <div className={`text-lg font-bold ${gold ? 'text-yellow-400' : 'text-green-600'}`}>
                      {performance.sequenceProgress.reached.toLocaleString()}
                    </div>
                    <div className={`text-xs ${muted}`}>Reached Leads</div>
                  </div>
                  <div className="text-center">
                    <div className={`text-lg font-bold ${gold ? 'text-red-400' : 'text-red-600'}`}>
                      {performance.sequenceProgress.failed.toLocaleString()}
                    </div>
                    <div className={`text-xs ${muted}`}>Failed</div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className={muted}>Lead reach progress</span>
                    <span className={gold ? 'text-yellow-400' : 'text-blue-600'}>
                      Selected period: {selectedReplyRate.toFixed(2)}% reply rate
                    </span>
                  </div>
                  <div className={`h-2 w-full rounded-full ${gold ? 'bg-gray-700' : 'bg-gray-200'}`}>
                    <div
                      className={`h-2 rounded-full ${gold ? 'gold-gradient' : 'bg-blue-600'}`}
                      style={{
                        width: `${Math.min(
                          100,
                          performance.totalLeads > 0
                            ? (performance.sequenceProgress.reached / performance.totalLeads) * 100
                            : 0,
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </article>
          );
        })}

        {filteredPerformance.length === 0 && (
          <div className={`rounded-xl border py-12 text-center ${card}`}>
            <Activity className={`mx-auto mb-4 h-12 w-12 ${gold ? 'text-gray-600' : 'text-gray-400'}`} />
            <h3 className={`mb-2 text-lg font-medium ${gold ? 'text-gray-200' : 'text-gray-900'}`}>No campaigns found</h3>
            <p className={muted}>{searchTerm || selectedStatus ? 'Try adjusting your filters' : 'Create a campaign to start tracking performance'}</p>
          </div>
        )}
      </div>
    </div>
  );
}
