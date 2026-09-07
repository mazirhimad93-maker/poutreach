import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../lib/supabase';
import { 
  BarChart3, 
  Phone, 
  MessageSquare, 
  Target, 
  TrendingUp, 
  Calendar,
  Crown,
  Zap,
  Users,
  CheckCircle,
  ChevronDown,
  Filter,
  BarChart,
  LineChart
} from 'lucide-react';

interface CampaignAnalyticsProps {
  campaignId: string;
}

interface AnalyticsData {
  totalLeads: number;
  callsMade: number;
  smssSent: number;
  whatsappSent: number;
  bookings: number;
  responseRate: number;
  dailyActivity: Array<{
    date: string;
    calls: number;
    sms: number;
    whatsapp: number;
  }>;
}

export function CampaignAnalytics({ campaignId }: CampaignAnalyticsProps) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [analytics, setAnalytics] = useState<AnalyticsData>({
    totalLeads: 0,
    callsMade: 0,
    smssSent: 0,
    whatsappSent: 0,
    bookings: 0,
    responseRate: 0,
    dailyActivity: []
  });
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | 'all'>('7d');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [chartType, setChartType] = useState<'bar' | 'line'>('bar');

  useEffect(() => {
    if (campaignId) {
      fetchAnalytics();
    }
  }, [campaignId, timeRange]);

  const fetchAnalytics = async () => {
    try {
      // Calculate date range
      const now = new Date();
      let queryStartDate = new Date();
      
      if (timeRange === '7d') {
        queryStartDate.setDate(now.getDate() - 7);
      } else if (timeRange === '30d') {
        queryStartDate.setDate(now.getDate() - 30);
      } else if (timeRange === 'custom' && startDate && endDate) {
        queryStartDate = new Date(startDate);
      } else {
        queryStartDate = new Date('2020-01-01'); // All time
      }

      const queryEndDate = timeRange === 'custom' && endDate ? new Date(endDate) : now;

      // Fetch total leads for this campaign
      const { data: leadsData, error: leadsError } = await supabase
        .from('uploaded_leads')
        .select('id')
        .eq('campaign_id', campaignId);

      if (leadsError) throw leadsError;

      // Fetch conversation history for analytics
      const { data: conversationData, error: conversationError } = await supabase
        .from('conversation_history')
        .select('*')
        .eq('campaign_id', campaignId)
        .gte('timestamp', queryStartDate.toISOString())
        .lte('timestamp', queryEndDate.toISOString());

      if (conversationError) throw conversationError;

      // Fetch bookings
      const { data: bookingsData, error: bookingsError } = await supabase
        .from('bookings')
        .select('*')
        .eq('campaign_id', campaignId)
        .gte('created_at', queryStartDate.toISOString())
        .lte('created_at', queryEndDate.toISOString());

      if (bookingsError) throw bookingsError;

      // Process data
      const callsMade = conversationData?.filter(c => c.channel === 'vapi' && c.from_role === 'ai').length || 0;
      const smssSent = conversationData?.filter(c => c.channel === 'sms' && c.from_role === 'ai').length || 0;
      const whatsappSent = conversationData?.filter(c => c.channel === 'whatsapp' && c.from_role === 'ai').length || 0;
      const responsesReceived = conversationData?.filter(c => c.from_role === 'lead').length || 0;
      const totalOutbound = callsMade + smssSent + whatsappSent;
      const responseRate = totalOutbound > 0 ? (responsesReceived / totalOutbound) * 100 : 0;

      // Generate daily activity data
      let daysToShow = 7;
      if (timeRange === '30d') {
        daysToShow = 30;
      } else if (timeRange === 'custom' && startDate && endDate) {
        daysToShow = Math.min(Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1, 90);
      } else if (timeRange === 'all') {
        daysToShow = 30; // Limit to last 30 days for performance
      }
      
      const dailyActivity = [];
      const baseDate = timeRange === 'custom' && startDate ? new Date(startDate) : now;
      
      for (let i = daysToShow - 1; i >= 0; i--) {
        const date = new Date();
        if (timeRange === 'custom' && startDate) {
          date.setTime(baseDate.getTime() + (daysToShow - 1 - i) * 24 * 60 * 60 * 1000);
        } else {
        date.setDate(date.getDate() - i);
        }
        const dateStr = date.toISOString().split('T')[0];
        
        const dayConversations = conversationData?.filter(c => 
          c.timestamp.startsWith(dateStr) && c.from_role === 'ai'
        ) || [];

        dailyActivity.push({
          date: dateStr,
          calls: dayConversations.filter(c => c.channel === 'vapi').length,
          sms: dayConversations.filter(c => c.channel === 'sms').length,
          whatsapp: dayConversations.filter(c => c.channel === 'whatsapp').length,
        });
      }

      setAnalytics({
        totalLeads: leadsData?.length || 0,
        callsMade,
        smssSent,
        whatsappSent,
        bookings: bookingsData?.length || 0,
        responseRate,
        dailyActivity
      });
    } catch (error) {
      console.error('Error fetching analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const maxDailyValue = Math.max(
    ...analytics.dailyActivity.map(day => 
      Math.max(day.calls, day.sms, day.whatsapp)
    ),
    1
  );

  if (loading) {
    return (
      <div className={`p-6 rounded-lg border ${
        theme === 'gold'
          ? 'border-yellow-400/20 bg-black/20'
          : 'border-gray-200 bg-gray-50'
      }`}>
        <div className="animate-pulse">
          <div className={`h-4 rounded mb-4 ${
            theme === 'gold' ? 'bg-gray-700' : 'bg-gray-300'
          }`} />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className={`h-20 rounded ${
                theme === 'gold' ? 'bg-gray-700' : 'bg-gray-300'
              }`} />
            ))}
          </div>
          <div className={`h-64 rounded ${
            theme === 'gold' ? 'bg-gray-700' : 'bg-gray-300'
          }`} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Total Leads */}
        <div className={`p-4 rounded-lg border ${
          theme === 'gold'
            ? 'border-yellow-400/20 bg-black/20'
            : 'border-gray-200 bg-white'
        }`}>
          <div className="flex items-center">
            <Users className={`h-5 w-5 mr-2 ${
              theme === 'gold' ? 'text-yellow-400' : 'text-blue-600'
            }`} />
            <span className={`text-sm font-medium ${
              theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
            }`}>
              Total Leads
            </span>
          </div>
          <p className={`text-2xl font-bold mt-1 ${
            theme === 'gold' ? 'text-yellow-400' : 'text-blue-600'
          }`}>
            {analytics.totalLeads}
          </p>
        </div>

        {/* Calls Made */}
        <div className={`p-4 rounded-lg border ${
          theme === 'gold'
            ? 'border-yellow-400/20 bg-black/20'
            : 'border-gray-200 bg-white'
        }`}>
          <div className="flex items-center">
            <Phone className={`h-5 w-5 mr-2 ${
              theme === 'gold' ? 'text-yellow-400' : 'text-green-600'
            }`} />
            <span className={`text-sm font-medium ${
              theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
            }`}>
              Calls Made
            </span>
          </div>
          <p className={`text-2xl font-bold mt-1 ${
            theme === 'gold' ? 'text-yellow-400' : 'text-green-600'
          }`}>
            {analytics.callsMade}
          </p>
        </div>

        {/* SMS Sent */}
        <div className={`p-4 rounded-lg border ${
          theme === 'gold'
            ? 'border-yellow-400/20 bg-black/20'
            : 'border-gray-200 bg-white'
        }`}>
          <div className="flex items-center">
            <MessageSquare className={`h-5 w-5 mr-2 ${
              theme === 'gold' ? 'text-yellow-400' : 'text-purple-600'
            }`} />
            <span className={`text-sm font-medium ${
              theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
            }`}>
              SMS + WhatsApp
            </span>
          </div>
          <p className={`text-2xl font-bold mt-1 ${
            theme === 'gold' ? 'text-yellow-400' : 'text-purple-600'
          }`}>
            {analytics.smssSent + analytics.whatsappSent}
          </p>
        </div>

        {/* Bookings */}
        <div className={`p-4 rounded-lg border ${
          theme === 'gold'
            ? 'border-yellow-400/20 bg-black/20'
            : 'border-gray-200 bg-white'
        }`}>
          <div className="flex items-center">
            <Calendar className={`h-5 w-5 mr-2 ${
              theme === 'gold' ? 'text-yellow-400' : 'text-orange-600'
            }`} />
            <span className={`text-sm font-medium ${
              theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
            }`}>
              Bookings
            </span>
          </div>
          <p className={`text-2xl font-bold mt-1 ${
            theme === 'gold' ? 'text-yellow-400' : 'text-orange-600'
          }`}>
            {analytics.bookings}
          </p>
        </div>
      </div>

      {/* Activity Chart */}
      <div className={`p-6 rounded-lg border ${
        theme === 'gold'
          ? 'border-yellow-400/20 bg-black/20'
          : 'border-gray-200 bg-gray-50'
      }`}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6">
          <h4 className={`text-md font-semibold mb-4 sm:mb-0 ${
            theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
          }`}>
            Daily Activity
          </h4>
          
          <div className="flex flex-col sm:flex-row gap-2">
            {/* Time Range Selector */}
            <div className="flex rounded-lg overflow-hidden border">
              {(['7d', '30d', 'all'] as const).map((range) => (
                <button
                  key={range}
                  onClick={() => setTimeRange(range)}
                  className={`px-3 py-1 text-xs font-medium transition-colors ${
                    timeRange === range
                      ? theme === 'gold'
                        ? 'gold-gradient text-black'
                        : 'bg-blue-600 text-white'
                      : theme === 'gold'
                        ? 'text-gray-400 hover:bg-gray-800'
                        : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {range === '7d' ? '7 Days' : range === '30d' ? '30 Days' : 'All Time'}
                </button>
              ))}
            </div>
            
            {/* Chart Type Selector */}
            <div className="flex rounded-lg overflow-hidden border">
              <button
                onClick={() => setChartType('bar')}
                className={`px-3 py-1 text-xs font-medium transition-colors ${
                  chartType === 'bar'
                    ? theme === 'gold'
                      ? 'gold-gradient text-black'
                      : 'bg-blue-600 text-white'
                    : theme === 'gold'
                      ? 'text-gray-400 hover:bg-gray-800'
                      : 'text-gray-600 hover:bg-gray-100'
                }`}
                title="Bar Chart"
              >
                <BarChart className="h-4 w-4" />
              </button>
              <button
                onClick={() => setChartType('line')}
                className={`px-3 py-1 text-xs font-medium transition-colors ${
                  chartType === 'line'
                    ? theme === 'gold'
                      ? 'gold-gradient text-black'
                      : 'bg-blue-600 text-white'
                    : theme === 'gold'
                      ? 'text-gray-400 hover:bg-gray-800'
                      : 'text-gray-600 hover:bg-gray-100'
                }`}
                title="Line Chart"
              >
                <LineChart className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
        
        {/* Chart Container */}
        <div className="relative">
          {chartType === 'bar' ? (
            /* Bar Chart */
            <div className="space-y-1">
              <div className="flex justify-between items-end h-64 px-2">
                {analytics.dailyActivity.map((day, index) => {
                  const total = day.calls + day.sms + day.whatsapp;
                  const date = new Date(day.date);
                  const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
                  const dayDate = date.toLocaleDateString('en-US', { day: 'numeric' });
                  const maxHeight = 200; // Max height in pixels
                  
                  return (
                    <div key={index} className="flex flex-col items-center space-y-2 flex-1 max-w-16">
                      {/* Bar */}
                      <div className="relative flex flex-col justify-end h-48 w-8">
                        {/* Calls */}
                        {day.calls > 0 && (
                          <div
                            className={`w-full rounded-t-sm ${
                              theme === 'gold' ? 'bg-yellow-400' : 'bg-blue-500'
                            } transition-all duration-300 hover:opacity-80`}
                            style={{
                              height: `${(day.calls / maxDailyValue) * maxHeight}px`,
                              minHeight: day.calls > 0 ? '2px' : '0'
                            }}
                            title={`${day.calls} calls`}
                          />
                        )}
                        
                        {/* SMS */}
                        {day.sms > 0 && (
                          <div
                            className={`w-full ${
                              day.calls === 0 ? 'rounded-t-sm' : ''
                            } ${day.whatsapp === 0 ? 'rounded-b-sm' : ''} ${
                              theme === 'gold' ? 'bg-yellow-600' : 'bg-green-500'
                            } transition-all duration-300 hover:opacity-80`}
                            style={{
                              height: `${(day.sms / maxDailyValue) * maxHeight}px`,
                              minHeight: day.sms > 0 ? '2px' : '0'
                            }}
                            title={`${day.sms} SMS`}
                          />
                        )}
                        
                        {/* WhatsApp */}
                        {day.whatsapp > 0 && (
                          <div
                            className={`w-full rounded-b-sm ${
                              theme === 'gold' ? 'bg-orange-400' : 'bg-purple-500'
                            } transition-all duration-300 hover:opacity-80`}
                            style={{
                              height: `${(day.whatsapp / maxDailyValue) * maxHeight}px`,
                              minHeight: day.whatsapp > 0 ? '2px' : '0'
                            }}
                            title={`${day.whatsapp} WhatsApp`}
                          />
                        )}
                        
                        {/* Empty state */}
                        {total === 0 && (
                          <div className={`w-full h-1 rounded-sm ${
                            theme === 'gold' ? 'bg-gray-700' : 'bg-gray-200'
                          }`} />
                        )}
                        
                        {/* Total count label */}
                        {total > 0 && (
                          <div className={`absolute -top-6 left-1/2 transform -translate-x-1/2 text-xs font-medium ${
                            theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
                          }`}>
                            {total}
                          </div>
                        )}
                      </div>
                      
                      {/* Date label */}
                      <div className="text-center">
                        <div className={`text-xs font-medium ${
                          theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
                        }`}>
                          {dayName}
                        </div>
                        <div className={`text-xs ${
                          theme === 'gold' ? 'text-gray-500' : 'text-gray-500'
                        }`}>
                          {dayDate}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Line Chart */
            <div className="relative h-64">
              <svg className="w-full h-full" viewBox="0 0 800 200">
                {/* Grid lines */}
                {[0, 1, 2, 3, 4].map((i) => (
                  <line
                    key={i}
                    x1="40"
                    y1={40 + (i * 32)}
                    x2="760"
                    y2={40 + (i * 32)}
                    stroke={theme === 'gold' ? '#374151' : '#e5e7eb'}
                    strokeWidth="1"
                    opacity="0.5"
                  />
                ))}
                
                {/* Y-axis labels */}
                {[0, 1, 2, 3, 4].map((i) => (
                  <text
                    key={i}
                    x="35"
                    y={45 + (i * 32)}
                    textAnchor="end"
                    className={`text-xs ${theme === 'gold' ? 'fill-gray-400' : 'fill-gray-600'}`}
                  >
                    {Math.round((maxDailyValue / 4) * (4 - i))}
                  </text>
                ))}
                
                {/* Data lines */}
                {analytics.dailyActivity.length > 1 && (
                  <>
                    {/* Calls line */}
                    <polyline
                      fill="none"
                      stroke={theme === 'gold' ? '#facc15' : '#3b82f6'}
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={analytics.dailyActivity.map((day, index) => {
                        const x = 40 + (index * (720 / (analytics.dailyActivity.length - 1)));
                        const y = 168 - ((day.calls / maxDailyValue) * 128);
                        return `${x},${y}`;
                      }).join(' ')}
                    />
                    
                    {/* SMS line */}
                    <polyline
                      fill="none"
                      stroke={theme === 'gold' ? '#ca8a04' : '#22c55e'}
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={analytics.dailyActivity.map((day, index) => {
                        const x = 40 + (index * (720 / (analytics.dailyActivity.length - 1)));
                        const y = 168 - ((day.sms / maxDailyValue) * 128);
                        return `${x},${y}`;
                      }).join(' ')}
                    />
                    
                    {/* WhatsApp line */}
                    <polyline
                      fill="none"
                      stroke={theme === 'gold' ? '#fb923c' : '#a855f7'}
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={analytics.dailyActivity.map((day, index) => {
                        const x = 40 + (index * (720 / (analytics.dailyActivity.length - 1)));
                        const y = 168 - ((day.whatsapp / maxDailyValue) * 128);
                        return `${x},${y}`;
                      }).join(' ')}
                    />
                    
                    {/* Data points */}
                    {analytics.dailyActivity.map((day, index) => {
                      const x = 40 + (index * (720 / (analytics.dailyActivity.length - 1)));
                      const total = day.calls + day.sms + day.whatsapp;
                      
                      return (
                        <g key={index}>
                          {/* Calls point */}
                          {day.calls > 0 && (
                            <circle
                              cx={x}
                              cy={168 - ((day.calls / maxDailyValue) * 128)}
                              r="4"
                              fill={theme === 'gold' ? '#facc15' : '#3b82f6'}
                              className="hover:r-6 transition-all cursor-pointer"
                            >
                              <title>{`${day.calls} calls`}</title>
                            </circle>
                          )}
                          
                          {/* SMS point */}
                          {day.sms > 0 && (
                            <circle
                              cx={x}
                              cy={168 - ((day.sms / maxDailyValue) * 128)}
                              r="4"
                              fill={theme === 'gold' ? '#ca8a04' : '#22c55e'}
                              className="hover:r-6 transition-all cursor-pointer"
                            >
                              <title>{`${day.sms} SMS`}</title>
                            </circle>
                          )}
                          
                          {/* WhatsApp point */}
                          {day.whatsapp > 0 && (
                            <circle
                              cx={x}
                              cy={168 - ((day.whatsapp / maxDailyValue) * 128)}
                              r="4"
                              fill={theme === 'gold' ? '#fb923c' : '#a855f7'}
                              className="hover:r-6 transition-all cursor-pointer"
                            >
                              <title>{`${day.whatsapp} WhatsApp`}</title>
                            </circle>
                          )}
                        </g>
                      );
                    })}
                  </>
                )}
                
                {/* X-axis labels */}
                {analytics.dailyActivity.map((day, index) => {
                  const x = 40 + (index * (720 / Math.max(analytics.dailyActivity.length - 1, 1)));
                  const date = new Date(day.date);
                  const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
                  const dayDate = date.toLocaleDateString('en-US', { day: 'numeric' });
                  
                  return (
                    <g key={index}>
                      <text
                        x={x}
                        y="190"
                        textAnchor="middle"
                        className={`text-xs ${theme === 'gold' ? 'fill-gray-400' : 'fill-gray-600'}`}
                      >
                        {dayName}
                      </text>
                      <text
                        x={x}
                        y="200"
                        textAnchor="middle"
                        className={`text-xs ${theme === 'gold' ? 'fill-gray-500' : 'fill-gray-500'}`}
                      >
                        {dayDate}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
          
          {/* Legend */}
          <div className="flex justify-center space-x-6 mt-4">
            <div className={`flex items-center text-xs ${
              theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
            }`}>
              <div className={`w-3 h-3 rounded-full mr-2 ${
                theme === 'gold' ? 'bg-yellow-400' : 'bg-blue-500'
              }`} />
              Calls
            </div>
            <div className={`flex items-center text-xs ${
              theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
            }`}>
              <div className={`w-3 h-3 rounded-full mr-2 ${
                theme === 'gold' ? 'bg-yellow-600' : 'bg-green-500'
              }`} />
              SMS
            </div>
            <div className={`flex items-center text-xs ${
              theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
            }`}>
              <div className={`w-3 h-3 rounded-full mr-2 ${
                theme === 'gold' ? 'bg-orange-400' : 'bg-purple-500'
              }`} />
              WhatsApp
            </div>
          </div>
        </div>
      </div>

      {/* Campaign Progress */}
      <div className={`p-6 rounded-lg border ${
        theme === 'gold'
          ? 'border-yellow-400/20 bg-black/20'
          : 'border-gray-200 bg-gray-50'
      }`}>
        <h4 className={`text-md font-semibold mb-4 ${
          theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
        }`}>
          Campaign Progress
        </h4>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className={`text-sm ${
              theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
            }`}>
              Leads Contacted
            </span>
            <span className={`text-sm font-medium ${
              theme === 'gold' ? 'text-yellow-400' : 'text-blue-600'
            }`}>
              {analytics.callsMade + analytics.smssSent + analytics.whatsappSent} / {analytics.totalLeads}
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
                width: `${analytics.totalLeads > 0 
                  ? ((analytics.callsMade + analytics.smssSent + analytics.whatsappSent) / analytics.totalLeads) * 100 
                  : 0}%`
              }}
            />
          </div>

          <div className="flex items-center justify-between">
            <span className={`text-sm ${
              theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
            }`}>
              Conversion to Bookings
            </span>
            <span className={`text-sm font-medium ${
              theme === 'gold' ? 'text-yellow-400' : 'text-green-600'
            }`}>
              {analytics.totalLeads > 0 ? ((analytics.bookings / analytics.totalLeads) * 100).toFixed(1) : 0}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}