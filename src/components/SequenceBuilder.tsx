import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Mail,
  MessageCircle,
  MessageSquare,
  Phone,
  Plus,
  Save,
  Trash2,
  XCircle
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../lib/supabase';

type StepType = 'email' | 'sms' | 'whatsapp' | 'voice';
type DelayUnit = 'minutes' | 'hours' | 'days';

interface ConnectedChannel {
  id: string;
  provider: string;
  channel_type: string;
  sender_id: string | null;
  is_active: boolean;
}

interface SequenceStep {
  id?: string;
  step_number: number;
  channel_type: StepType;
  delay_value: number;
  delay_unit: DelayUnit;
  email_subject: string;
  message_template: string;
  stop_on_reply: boolean;
}

interface SequenceBuilderProps {
  campaignId: string;
  onSave?: () => void;
}

const CHANNEL_ORDER: StepType[] = ['email', 'voice', 'sms', 'whatsapp'];

const DEFAULT_FIRST_EMAIL = `Hey {first_name},

{opening}

I help creators and experts turn YouTube into an 8-figure funnel through high-ticket coaching, masterminds and courses.

Right now, the biggest creators are starting to understand how important clips are. We’re generating over 100,000 organic views a day from the same content on brand-new channels.

Then we connect that attention to the sales side through the right offer, funnel, lead capture and follow-up.

We’ve helped scale one funnel from $18k to $100k/month, built another that’s done $1.2M in sales, and worked on campaigns with names like McGregor FAST, Mindvalley and Jason Kalambay.

I have a few ideas for how we could do something similar with your content.

Would you be open to seeing them?

All the best,

Julian`;

function dbType(type: StepType) {
  return type === 'voice' ? 'call' : type;
}

function uiType(type: string): StepType {
  return type === 'call' ? 'voice' : (type as StepType);
}

function typeLabel(type: StepType) {
  if (type === 'voice') return 'Call';
  if (type === 'sms') return 'SMS';
  if (type === 'whatsapp') return 'WhatsApp';
  return 'Email';
}

function typeIcon(type: StepType) {
  if (type === 'voice') return Phone;
  if (type === 'email') return Mail;
  if (type === 'whatsapp') return MessageCircle;
  return MessageSquare;
}

function channelMatches(channelType: string, type: StepType) {
  const normalized = uiType(channelType);
  return normalized === type;
}

function secondsFromDelay(value: number, unit: DelayUnit) {
  const safe = Math.max(0, Number(value) || 0);
  if (unit === 'minutes') return Math.round(safe * 60);
  if (unit === 'hours') return Math.round(safe * 3600);
  return Math.round(safe * 86400);
}

function delayFromSeconds(seconds: number): { value: number; unit: DelayUnit } {
  const safe = Math.max(0, Number(seconds) || 0);
  if (safe === 0) return { value: 0, unit: 'days' };
  if (safe % 86400 === 0) return { value: safe / 86400, unit: 'days' };
  if (safe % 3600 === 0) return { value: safe / 3600, unit: 'hours' };
  return { value: Math.max(1, Math.round(safe / 60)), unit: 'minutes' };
}

function contentPlaceholder(type: StepType, stepNumber: number) {
  if (type === 'email') {
    if (stepNumber === 1) return DEFAULT_FIRST_EMAIL;
    return `Hey {first_name},

Just following up on my last email.

Would it make sense for me to send over the ideas I had in mind?

All the best,

Julian`;
  }

  if (type === 'sms') {
    return 'Hey {first_name}, Julian here. Just following up on the email I sent — open to me sending the ideas over?';
  }

  if (type === 'whatsapp') {
    return 'Hey {first_name}, Julian here. I sent you an email recently and wanted to follow up here as well. Open to seeing the ideas?';
  }

  return `Goal: follow up on the previous outreach.

Opening:
"Hey {first_name}, this is Julian."

Context:
They previously received our outreach about helping creators turn content into more traffic, leads and sales.

Call objective:
Confirm this is a relevant conversation, briefly explain why we reached out, and ask whether they are open to hearing the ideas.

Do not pretend they replied if they did not.
Do not pressure them.
If they are not interested, end politely.`;
}

function normalizeStoredContent(row: any) {
  if (row.type === 'email') return row.email_template || row.message_template || '';
  return row.message_template || row.prompt || row.ai_training || '';
}

export function SequenceBuilder({ campaignId, onSave }: SequenceBuilderProps) {
  const { user } = useAuth();
  const { theme } = useTheme();

  const [connectedChannels, setConnectedChannels] = useState<ConnectedChannel[]>([]);
  const [sequenceSteps, setSequenceSteps] = useState<SequenceStep[]>([]);
  const [originalStepIds, setOriginalStepIds] = useState<string[]>([]);
  const [campaignStatus, setCampaignStatus] = useState('draft');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (campaignId && user) void load();
  }, [campaignId, user]);

  const load = async () => {
    if (!user) return;
    setLoading(true);

    try {
      const [channelResult, sequenceResult, campaignResult] = await Promise.all([
        supabase
          .from('channels')
          .select('id,provider,channel_type,sender_id,is_active')
          .eq('user_id', user.id)
          .eq('is_active', true),
        supabase
          .from('campaign_sequences')
          .select('*')
          .eq('campaign_id', campaignId)
          .order('step_number', { ascending: true }),
        supabase
          .from('campaigns')
          .select('status')
          .eq('id', campaignId)
          .maybeSingle()
      ]);

      if (channelResult.error) throw channelResult.error;
      if (sequenceResult.error) throw sequenceResult.error;
      if (campaignResult.error) throw campaignResult.error;

      setConnectedChannels(channelResult.data || []);
      setCampaignStatus(campaignResult.data?.status || 'draft');

      const rows = sequenceResult.data || [];
      setOriginalStepIds(rows.map((row: any) => row.id));
      setSequenceSteps(
        rows.map((row: any) => {
          const delay = delayFromSeconds(row.wait_seconds || 0);
          return {
            id: row.id,
            step_number: row.step_number,
            channel_type: uiType(row.type),
            delay_value: delay.value,
            delay_unit: delay.unit,
            email_subject: row.email_subject || '',
            message_template: normalizeStoredContent(row),
            stop_on_reply: row.stop_on_reply !== false
          };
        })
      );
    } catch (error) {
      console.error('Error loading sequence builder:', error);
      setMessage('Could not load this campaign sequence.');
    } finally {
      setLoading(false);
    }
  };

  const channelInventory = useMemo(() => {
    return CHANNEL_ORDER.map(type => {
      const matches = connectedChannels.filter(channel => channelMatches(channel.channel_type, type));
      const providers = Array.from(new Set(matches.map(channel => channel.provider).filter(Boolean)));
      return {
        type,
        connected: matches.length > 0,
        count: matches.length,
        providers
      };
    });
  }, [connectedChannels]);

  const connectedTypes = useMemo(
    () => channelInventory.filter(item => item.connected).map(item => item.type),
    [channelInventory]
  );

  const addStep = (type: StepType) => {
    if (!connectedTypes.includes(type)) return;

    const stepNumber = sequenceSteps.length + 1;

    setSequenceSteps(prev => [
      ...prev,
      {
        step_number: stepNumber,
        channel_type: type,
        delay_value: stepNumber === 1 ? 0 : type === 'voice' ? 1 : 2,
        delay_unit: 'days',
        email_subject: type === 'email' && stepNumber === 1 ? 'BUSINESS INQUIRIES' : '',
        message_template: '',
        stop_on_reply: true
      }
    ]);
    setMessage('');
  };

  const updateStep = <K extends keyof SequenceStep>(
    index: number,
    field: K,
    value: SequenceStep[K]
  ) => {
    setSequenceSteps(prev =>
      prev.map((step, i) => (i === index ? { ...step, [field]: value } : step))
    );
  };

  const removeStep = (index: number) => {
    const step = sequenceSteps[index];

    if (campaignStatus !== 'draft' && step.id) {
      setMessage(
        'Existing historical steps stay locked on a started campaign. You can safely append new follow-ups.'
      );
      return;
    }

    setSequenceSteps(prev =>
      prev
        .filter((_, i) => i !== index)
        .map((item, i) => ({ ...item, step_number: i + 1 }))
    );
  };

  const saveSequence = async () => {
    if (!user || sequenceSteps.length === 0) return;

    const missingContent = sequenceSteps.find(
      step => step.step_number > 1 && !step.message_template.trim()
    );

    if (missingContent) {
      setMessage(
        `Step ${missingContent.step_number} needs its own ${missingContent.channel_type === 'voice' ? 'call script' : 'message copy'} before saving.`
      );
      return;
    }

    const unavailableChannel = sequenceSteps.find(
      step => !connectedTypes.includes(step.channel_type)
    );

    if (unavailableChannel) {
      setMessage(
        `${typeLabel(unavailableChannel.channel_type)} is not connected in Settings, so Step ${unavailableChannel.step_number} cannot run yet.`
      );
      return;
    }

    setSaving(true);
    setMessage('');

    try {
      if (campaignStatus === 'draft') {
        const keptIds = new Set(sequenceSteps.map(step => step.id).filter(Boolean));
        const removedIds = originalStepIds.filter(id => !keptIds.has(id));

        if (removedIds.length) {
          const { error } = await supabase
            .from('campaign_sequences')
            .delete()
            .in('id', removedIds);
          if (error) throw error;
        }
      }

      for (const step of sequenceSteps) {
        const exactContent = step.message_template.trim();
        const isEmail = step.channel_type === 'email';

        const payload: any = {
          campaign_id: campaignId,
          user_id: user.id,
          step_number: step.step_number,
          type: dbType(step.channel_type),
          wait_seconds: secondsFromDelay(step.delay_value, step.delay_unit),
          stop_on_reply: step.stop_on_reply,

          // Deterministic sequence content. We keep prompt mirrored for the
          // legacy call/SMS/WhatsApp workflow so the primary n8n routing stays intact.
          message_template: exactContent || null,
          prompt: !isEmail ? (exactContent || null) : null,
          ai_training: null,

          email_subject: isEmail ? (step.email_subject.trim() || null) : null,
          email_template: isEmail ? (exactContent || null) : null
        };

        if (step.id) {
          const { error } = await supabase
            .from('campaign_sequences')
            .update(payload)
            .eq('id', step.id)
            .eq('campaign_id', campaignId);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from('campaign_sequences')
            .insert(payload);
          if (error) throw error;
        }
      }

      await load();
      setMessage(
        campaignStatus === 'active'
          ? 'Sequence saved. New steps were attached to eligible non-replied leads automatically.'
          : 'Sequence saved. Each lead will move through these exact steps on its own schedule.'
      );
      onSave?.();
    } catch (error) {
      console.error('Error saving sequence:', error);
      setMessage(error instanceof Error ? error.message : 'Could not save this sequence.');
    } finally {
      setSaving(false);
    }
  };

  const fieldClass =
    theme === 'gold'
      ? 'border-yellow-400/30 bg-black/40 text-gray-200 focus:ring-yellow-400'
      : 'border-gray-300 bg-white text-gray-900 focus:ring-blue-500';

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className={`text-lg font-semibold ${theme === 'gold' ? 'text-gray-200' : 'text-gray-900'}`}>
            Multi-channel Sequence
          </h3>
          <p className={`mt-1 max-w-4xl text-sm ${theme === 'gold' ? 'text-gray-400' : 'text-gray-600'}`}>
            Build the campaign exactly like a cold outreach sequencer: choose the channel, set the wait time,
            write the exact copy or call script, then add the next step. Sender inboxes are selected by the
            delivery engine — they are not sequence steps.
          </p>
        </div>

        <button
          onClick={saveSequence}
          disabled={saving || sequenceSteps.length === 0}
          className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 ${
            theme === 'gold'
              ? 'gold-gradient text-black'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          <Save className="mr-2 h-4 w-4" />
          {saving ? 'Saving…' : 'Save Sequence'}
        </button>
      </div>

      <div>
        <div className="mb-3">
          <h4 className={`font-semibold ${theme === 'gold' ? 'text-gray-200' : 'text-gray-900'}`}>
            Available outreach channels
          </h4>
          <p className={`mt-1 text-xs ${theme === 'gold' ? 'text-gray-500' : 'text-gray-500'}`}>
            One card per capability. Your individual sender inboxes stay hidden here.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {channelInventory.map(item => {
            const Icon = typeIcon(item.type);

            return (
              <div
                key={item.type}
                className={`rounded-xl border p-4 ${
                  item.connected
                    ? theme === 'gold'
                      ? 'border-yellow-400/30 bg-yellow-400/5'
                      : 'border-blue-200 bg-blue-50'
                    : theme === 'gold'
                      ? 'border-gray-700 bg-black/20'
                      : 'border-gray-200 bg-gray-50'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={`rounded-lg p-2 ${
                      item.connected
                        ? theme === 'gold'
                          ? 'bg-yellow-400/10 text-yellow-400'
                          : 'bg-blue-100 text-blue-700'
                        : 'bg-gray-100 text-gray-400'
                    }`}>
                      <Icon className="h-5 w-5" />
                    </div>

                    <div>
                      <div className={`font-medium ${theme === 'gold' ? 'text-gray-200' : 'text-gray-900'}`}>
                        {typeLabel(item.type)}
                      </div>
                      <div className={`mt-0.5 flex items-center gap-1 text-xs ${
                        item.connected ? 'text-green-600' : 'text-gray-500'
                      }`}>
                        {item.connected ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5" />
                        )}
                        {item.connected
                          ? item.type === 'email'
                            ? `Connected · ${item.count} sender${item.count === 1 ? '' : 's'}`
                            : 'Connected'
                          : 'Not connected'}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => addStep(item.type)}
                    disabled={!item.connected}
                    className={`rounded-lg p-2 transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
                      theme === 'gold'
                        ? 'text-yellow-400 hover:bg-yellow-400/10'
                        : 'text-blue-600 hover:bg-blue-100'
                    }`}
                    title={item.connected ? `Add ${typeLabel(item.type)} step` : `Connect ${typeLabel(item.type)} first`}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>

                {item.providers.length > 0 && (
                  <div className={`mt-3 text-xs ${theme === 'gold' ? 'text-gray-500' : 'text-gray-500'}`}>
                    {item.providers.join(', ')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {message && (
        <div className={`rounded-lg border p-3 text-sm ${
          /could not|needs|not connected|cannot/i.test(message)
            ? 'border-red-200 bg-red-50 text-red-800'
            : 'border-green-200 bg-green-50 text-green-800'
        }`}>
          {message}
        </div>
      )}

      <div>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h4 className={`font-semibold ${theme === 'gold' ? 'text-gray-200' : 'text-gray-900'}`}>
              Sequence
            </h4>
            <p className={`mt-1 text-xs ${theme === 'gold' ? 'text-gray-500' : 'text-gray-500'}`}>
              Each step runs only if the lead has not replied.
            </p>
          </div>
          <span className="text-xs text-gray-500">Campaign: {campaignStatus}</span>
        </div>

        {sequenceSteps.length === 0 ? (
          <div className={`rounded-xl border-2 border-dashed p-10 text-center ${
            theme === 'gold' ? 'border-yellow-400/30 text-gray-400' : 'border-gray-300 text-gray-500'
          }`}>
            Add the first Email, Call, SMS or WhatsApp step above.
          </div>
        ) : (
          <div className="space-y-4">
            {sequenceSteps.map((step, index) => {
              const Icon = typeIcon(step.channel_type);
              const isHistorical = campaignStatus !== 'draft' && Boolean(step.id);
              const isFirst = step.step_number === 1;

              return (
                <div
                  key={step.id || `new-${index}`}
                  className={`rounded-xl border p-4 sm:p-5 ${
                    theme === 'gold'
                      ? 'border-yellow-400/20 bg-black/20'
                      : 'border-gray-200 bg-white'
                  }`}
                >
                  <div className="mb-5 flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                        theme === 'gold' ? 'gold-gradient text-black' : 'bg-blue-100 text-blue-700'
                      }`}>
                        {step.step_number}
                      </div>

                      <Icon className={`h-5 w-5 ${theme === 'gold' ? 'text-yellow-400' : 'text-blue-600'}`} />

                      <div>
                        <div className={`font-semibold ${theme === 'gold' ? 'text-gray-200' : 'text-gray-900'}`}>
                          {isFirst ? 'Initial outreach' : `Follow-up ${step.step_number - 1}`} · {typeLabel(step.channel_type)}
                        </div>
                        <div className="mt-0.5 text-xs text-gray-500">
                          {isFirst
                            ? 'First touch for each lead.'
                            : 'Runs only if there is still no reply.'}
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => removeStep(index)}
                      disabled={isHistorical}
                      title={isHistorical ? 'Historical steps are locked after campaign start' : 'Delete step'}
                      className="rounded-lg p-2 text-red-500 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr_1fr]">
                    <div>
                      <label className={`mb-2 block text-sm font-medium ${theme === 'gold' ? 'text-gray-300' : 'text-gray-700'}`}>
                        Channel
                      </label>
                      <select
                        value={step.channel_type}
                        disabled={isHistorical}
                        onChange={e => {
                          const nextType = e.target.value as StepType;
                          updateStep(index, 'channel_type', nextType);
                          updateStep(index, 'message_template', '');
                          updateStep(index, 'email_subject', nextType === 'email' && isFirst ? 'BUSINESS INQUIRIES' : '');
                        }}
                        className={`w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 disabled:opacity-60 ${fieldClass}`}
                      >
                        {connectedTypes.map(type => (
                          <option key={type} value={type}>{typeLabel(type)}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className={`mb-2 block text-sm font-medium ${theme === 'gold' ? 'text-gray-300' : 'text-gray-700'}`}>
                        <Clock className="mr-1 inline h-4 w-4" />
                        {isFirst ? 'Start delay' : 'Wait after previous step'}
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={step.delay_value}
                        onChange={e => updateStep(index, 'delay_value', Math.max(0, Number(e.target.value) || 0))}
                        className={`w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 ${fieldClass}`}
                      />
                    </div>

                    <div>
                      <label className={`mb-2 block text-sm font-medium ${theme === 'gold' ? 'text-gray-300' : 'text-gray-700'}`}>
                        Time unit
                      </label>
                      <select
                        value={step.delay_unit}
                        onChange={e => updateStep(index, 'delay_unit', e.target.value as DelayUnit)}
                        className={`w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 ${fieldClass}`}
                      >
                        <option value="minutes">Minutes</option>
                        <option value="hours">Hours</option>
                        <option value="days">Days</option>
                      </select>
                    </div>
                  </div>

                  {step.channel_type === 'email' && (
                    <div className="mt-4">
                      <label className={`mb-2 block text-sm font-medium ${theme === 'gold' ? 'text-gray-300' : 'text-gray-700'}`}>
                        Subject
                      </label>
                      <input
                        type="text"
                        value={step.email_subject}
                        onChange={e => updateStep(index, 'email_subject', e.target.value)}
                        placeholder={isFirst ? 'BUSINESS INQUIRIES' : 'Leave blank to keep the previous subject/thread'}
                        className={`w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 ${fieldClass}`}
                      />
                    </div>
                  )}

                  <div className="mt-4">
                    <label className={`mb-2 block text-sm font-medium ${theme === 'gold' ? 'text-gray-300' : 'text-gray-700'}`}>
                      {step.channel_type === 'email'
                        ? 'Email copy'
                        : step.channel_type === 'voice'
                          ? 'Call script / agent instructions'
                          : step.channel_type === 'sms'
                            ? 'SMS copy'
                            : 'WhatsApp copy'}
                    </label>

                    <textarea
                      rows={step.channel_type === 'voice' ? 10 : step.channel_type === 'email' ? 10 : 6}
                      value={step.message_template}
                      onChange={e => updateStep(index, 'message_template', e.target.value)}
                      placeholder={contentPlaceholder(step.channel_type, step.step_number)}
                      className={`w-full resize-y rounded-lg border px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 ${fieldClass}`}
                    />

                    <p className="mt-1 text-xs text-gray-500">
                      The system sends this content deterministically. Variables come from the enriched lead list:
                      {' {first_name}'}, {'{opening}'}, {'{company_name}'}, {'{email}'}, {'{phone}'}.
                    </p>
                  </div>

                  <label className={`mt-4 flex items-center gap-2 text-sm ${theme === 'gold' ? 'text-gray-300' : 'text-gray-700'}`}>
                    <input
                      type="checkbox"
                      checked={step.stop_on_reply}
                      onChange={e => updateStep(index, 'stop_on_reply', e.target.checked)}
                    />
                    Stop all remaining follow-ups when this lead replies
                  </label>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className={`rounded-xl border-2 border-dashed p-4 ${theme === 'gold' ? 'border-yellow-400/30' : 'border-gray-300'}`}>
        <div className={`mb-3 text-sm font-medium ${theme === 'gold' ? 'text-gray-300' : 'text-gray-700'}`}>
          Add next step
        </div>

        <div className="flex flex-wrap gap-2">
          {channelInventory.map(item => {
            const Icon = typeIcon(item.type);
            return (
              <button
                key={item.type}
                onClick={() => addStep(item.type)}
                disabled={!item.connected}
                className={`inline-flex items-center rounded-lg border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-30 ${
                  theme === 'gold'
                    ? 'border-yellow-400/30 text-yellow-400 hover:bg-yellow-400/10'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-100'
                }`}
              >
                <Plus className="mr-1 h-4 w-4" />
                <Icon className="mr-2 h-4 w-4" />
                {typeLabel(item.type)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
