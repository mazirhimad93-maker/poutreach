import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';

type Period = '7d' | '14d' | '30d' | 'all';
type CampaignMetric = {
  campaign_id: string;
  campaign_name: string;
  sent_messages: number;
  contacted_leads: number;
  inbound_replies: number;
  unique_replied_leads: number;
  conversation_threads: number;
  reply_rate: number | string;
  booked_appointments: number;
  booked_people: number;
  latest_reply_at: string | null;
};
type GlobalTotals = {
  sent_messages: number;
  contacted_leads: number;
  inbound_replies: number;
  unique_replied_leads: number;
  conversation_threads: number;
  booked_appointments: number;
  booked_people: number;
  reply_rate: number | string;
};
type RecentReply = {
  id: string;
  campaign_id: string;
  email_from: string | null;
  email_subject: string | null;
  email_body: string | null;
  message: string | null;
  timestamp: string;
};

const number = (value: number) => value.toLocaleString();
const valueOf = (row: CampaignMetric, key: keyof CampaignMetric) => Number(row[key] || 0);
const dateText = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function OutreachEngagement() {
  const [period, setPeriod] = useState<Period>('14d');
  const [metrics, setMetrics] = useState<CampaignMetric[]>([]);
  const [globalTotals, setGlobalTotals] = useState<GlobalTotals | null>(null);
  const [recent, setRecent] = useState<RecentReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError('');
      const today = new Date();
      const days = period === 'all' ? null : Number(period.slice(0, -1));
      const from = days == null
        ? null
        : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - days + 1)).toISOString();
      try {
        // All counts are calculated by PostgreSQL, not by a 1,000-row browser query.
        const [campaignResult, globalResult] = await Promise.all([
          supabase.rpc('poutreach_campaign_engagement', { p_start: from, p_end: null }),
          supabase.rpc('poutreach_engagement_totals', { p_start: from, p_end: null }),
        ]);
        const { data, error: metricError } = campaignResult;
        if (metricError) throw metricError;
        if (globalResult.error) throw globalResult.error;
        if (!active) return;
        const rows = (data || []) as CampaignMetric[];
        setMetrics(rows);
        setGlobalTotals(((globalResult.data || [])[0] || null) as GlobalTotals | null);
        let query = supabase.from('conversation_history')
          .select('id,campaign_id,email_from,email_subject,email_body,message,timestamp')
          .eq('channel', 'email')
          .eq('from_role', 'lead')
          .order('timestamp', { ascending: false })
          .limit(15);
        if (from) query = query.gte('timestamp', from);
        const { data: messages, error: messagesError } = await query;
        if (messagesError) throw messagesError;
        if (active) setRecent((messages || []) as RecentReply[]);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : 'Unable to load engagement metrics');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [period]);

  const campaignTotals = useMemo(() => metrics.reduce((acc, row) => {
    acc.sent += valueOf(row, 'sent_messages');
    acc.contacted += valueOf(row, 'contacted_leads');
    acc.repliers += valueOf(row, 'unique_replied_leads');
    acc.threads += valueOf(row, 'conversation_threads');
    acc.messages += valueOf(row, 'inbound_replies');
    acc.bookings += valueOf(row, 'booked_appointments');
    acc.bookedPeople += valueOf(row, 'booked_people');
    return acc;
  }, { sent: 0, contacted: 0, repliers: 0, threads: 0, messages: 0, bookings: 0, bookedPeople: 0 }), [metrics]);

  const totals = globalTotals ? {
    sent: Number(globalTotals.sent_messages),
    contacted: Number(globalTotals.contacted_leads),
    repliers: Number(globalTotals.unique_replied_leads),
    threads: Number(globalTotals.conversation_threads),
    messages: Number(globalTotals.inbound_replies),
    bookings: Number(globalTotals.booked_appointments),
    bookedPeople: Number(globalTotals.booked_people),
  } : campaignTotals;

  const names = useMemo(() => Object.fromEntries(metrics.map(row => [row.campaign_id, row.campaign_name])), [metrics]);
  const ranked = useMemo(() => metrics.filter(row =>
    Number(row.sent_messages) + Number(row.inbound_replies) + Number(row.booked_appointments) > 0
  ).sort((a,b) => Number(b.inbound_replies) - Number(a.inbound_replies)), [metrics]);

  return (
    <section className="rounded-2xl bg-white border border-gray-200 p-4 sm:p-6 shadow-sm space-y-5 text-gray-900">
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold">Reach & Conversations</h2>
          <p className="text-sm text-gray-500">Unique replying leads, email threads and booked appointments by campaign.</p>
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Analytics date range">
          {(['7d', '14d', '30d', 'all'] as const).map(item => (
            <button key={item} type="button" onClick={() => setPeriod(item)}
              aria-pressed={period === item}
              className={`px-3 py-2 rounded-lg text-sm font-medium ${period === item ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}>
              {item === 'all' ? 'All time' : item.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      {error && <p role="alert" className="text-red-700 bg-red-50 rounded-lg p-3">{error}</p>}
      {loading ? <p className="text-gray-500">Loading engagement metrics…</p> : <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {([
            ['Unique replied leads', totals.repliers, 'Each person counted once across campaigns'],
            ['Conversations', totals.threads, 'Distinct email threads'],
            ['Inbound replies', totals.messages, 'Includes back-and-forth'],
            ['Booked people', totals.bookedPeople, 'Distinct people booked'],
            ['Booked appointments', totals.bookings, 'Deduplicated calendar events'],
            ['Emails sent', totals.sent, 'Successful outbound messages'],
            ['Contacted leads', totals.contacted, 'Distinct people across campaigns'],
          ] as [string, number, string][]).map(([label, count, hint]) => (
            <div key={label} className="rounded-xl bg-gray-50 p-3 border border-gray-100">
              <p className="text-xs text-gray-500">{label}</p>
              <p className="text-2xl font-bold mt-1">{number(count)}</p>
              <p className="text-xs text-gray-400 mt-1">{hint}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500">
          Overall counts deduplicate people across campaigns. Campaign rows count unique leads within each campaign.
          Reply rates below measure prospects both contacted and replying within the selected period.
        </p>
        <div className="space-y-3">
          <h3 className="text-lg font-semibold">Campaign contribution</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-sm text-left">
              <thead className="bg-gray-50 text-gray-600">
                <tr><th className="p-3">Campaign</th><th className="p-3 text-right">Reached leads</th>
                  <th className="p-3 text-right">Unique repliers</th><th className="p-3 text-right">Conversations</th>
                  <th className="p-3 text-right">Replies</th><th className="p-3 text-right">Reply rate</th>
                  <th className="p-3 text-right">Appointments</th><th className="p-3 text-right">Booked people</th></tr>
              </thead>
              <tbody>
                {(showAll ? ranked : ranked.slice(0, 12)).map(row => (
                  <tr key={row.campaign_id} className="border-t border-gray-100">
                    <td className="p-3 font-medium">{row.campaign_name}</td>
                    <td className="p-3 text-right">{number(valueOf(row,'contacted_leads'))}</td>
                    <td className="p-3 text-right font-semibold">{number(valueOf(row,'unique_replied_leads'))}</td>
                    <td className="p-3 text-right">{number(valueOf(row,'conversation_threads'))}</td>
                    <td className="p-3 text-right">{number(valueOf(row,'inbound_replies'))}</td>
                    <td className="p-3 text-right">{Number(row.reply_rate || 0).toFixed(2)}%</td>
                    <td className="p-3 text-right font-semibold">{number(valueOf(row,'booked_appointments'))}</td>
                    <td className="p-3 text-right">{number(valueOf(row,'booked_people'))}</td>
                  </tr>
                ))}
                {!ranked.length && <tr><td colSpan={8} className="p-4 text-gray-500">No campaign activity in this period.</td></tr>}
              </tbody>
            </table>
          </div>
          {ranked.length > 12 && <button type="button" className="text-blue-600 text-sm" onClick={() => setShowAll(x => !x)}>{showAll ? 'Show less' : `Show all ${ranked.length} active campaigns`}</button>}
        </div>
        <div className="space-y-3">
          <div className="flex flex-wrap justify-between gap-2 items-center">
            <h3 className="text-lg font-semibold">Latest replies</h3>
            <Link to="/booked" className="text-blue-600 text-sm font-medium">Open inbox</Link>
          </div>
          <p className="text-xs text-gray-500">Every incoming message is shown here, including repeat replies from the same lead. Newest first.</p>
          <div className="space-y-2">
            {recent.map(reply => (
              <div key={reply.id} className="rounded-lg border border-gray-100 p-3">
                <div className="flex flex-wrap gap-2 justify-between">
                  <p className="font-medium text-sm">{reply.email_from || 'Lead reply'}</p>
                  <span className="text-xs text-gray-500">{dateText(reply.timestamp)}</span>
                </div>
                <p className="text-xs text-gray-500">{names[reply.campaign_id] || 'Campaign'} · {reply.email_subject || 'No subject'}</p>
                <p className="text-sm text-gray-700 mt-1 line-clamp-2">{(reply.email_body || reply.message || '').slice(0,240)}</p>
              </div>
            ))}
            {!recent.length && <p className="text-sm text-gray-500">No incoming replies for this period.</p>}
          </div>
        </div>
      </>}
    </section>
  );
}
