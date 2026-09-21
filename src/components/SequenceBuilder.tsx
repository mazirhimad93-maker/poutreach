import React, { useEffect, useMemo, useState } from 'react';
import { Brain, Clock, Mail, MessageSquare, Phone, Plus, Save, Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../lib/supabase';

type StepType = 'email' | 'sms' | 'whatsapp' | 'voice';

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
  delay_days: number;
  email_subject: string;
  email_template: string;
  ai_training: string;
  stop_on_reply: boolean;
}

interface SequenceBuilderProps {
  campaignId: string;
  onSave?: () => void;
}

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
  if (type === 'voice') return 'Voice';
  if (type === 'sms') return 'SMS';
  if (type === 'whatsapp') return 'WhatsApp';
  return 'Email';
}

function typeIcon(type: StepType) {
  if (type === 'voice') return Phone;
  if (type === 'email') return Mail;
  return MessageSquare;
}

export function SequenceBuilder({ campaignId, onSave }: SequenceBuilderProps) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [connectedChannels, setConnectedChannels] = useState<ConnectedChannel[]>([]);
  const [sequenceSteps, setSequenceSteps] = useState<SequenceStep[]>([]);
  const [originalStepIds, setOriginalStepIds] = useState<string[]>([]);
  const [campaignStatus, setCampaignStatus] = useState<string>('draft');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    if (!campaignId || !user) return;
    void load();
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

      setSequenceSteps(rows.map((row: any) => ({
        id: row.id,
        step_number: row.step_number,
        channel_type: uiType(row.type),
        delay_days: Number(((row.wait_seconds || 0) / 86400).toFixed(2)),
        email_subject: row.email_subject || '',
        email_template: row.email_template || '',
        ai_training: row.ai_training || row.prompt || '',
        stop_on_reply: row.stop_on_reply !== false
      })));
    } catch (error) {
      console.error('Error loading sequence builder:', error);
      setMessage('Could not load the sequence.');
    } finally {
      setLoading(false);
    }
  };

  const availableTypes = useMemo(() => {
    const types = new Set<StepType>();
    for (const channel of connectedChannels) {
      const type = uiType(channel.channel_type);
      if (['email', 'sms', 'whatsapp', 'voice'].includes(type)) types.add(type);
    }
    return Array.from(types);
  }, [connectedChannels]);

  const addStep = (type: StepType) => {
    const stepNumber = sequenceSteps.length + 1;
    setSequenceSteps(prev => [
      ...prev,
      {
        step_number: stepNumber,
        channel_type: type,
        delay_days: stepNumber === 1 ? 0 : 2,
        email_subject: type === 'email' ? 'Re: BUSINESS INQUIRIES' : '',
        email_template: '',
        ai_training: '',
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
    setSequenceSteps(prev => prev.map((step, i) =>
      i === index ? { ...step, [field]: value } : step
    ));
  };

  const removeStep = (index: number) => {
    const step = sequenceSteps[index];

    if (campaignStatus !== 'draft' && step.id) {
      setMessage('Existing steps are locked once a campaign has started. You can append new follow-ups without changing the historical sequence.');
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

    const invalidFollowup = sequenceSteps.find(
      step => step.channel_type === 'email' && step.step_number > 1 && !step.email_template.trim()
    );

    if (invalidFollowup) {
      setMessage(`Sequence ${invalidFollowup.step_number} needs email copy. The no-AI sender will never repeat the first email as a fallback follow-up.`);
      return;
    }

    setSaving(true);
    setMessage('');

    try {
      // Draft campaigns can remove steps. Active/paused campaigns preserve
      // historical steps and only allow safe appends/edits.
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
        const payload = {
          campaign_id: campaignId,
          user_id: user.id,
          step_number: step.step_number,
          type: dbType(step.channel_type),
          wait_seconds: Math.max(0, Math.round(Number(step.delay_days || 0) * 86400)),
          prompt: step.ai_training || null,
          ai_training: step.ai_training || null,
          email_subject: step.channel_type === 'email' ? (step.email_subject || null) : null,
          email_template: step.channel_type === 'email' ? (step.email_template || null) : null,
          stop_on_reply: step.stop_on_reply
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
          ? 'Sequence saved. New follow-ups were attached to every eligible lead in this active campaign automatically.'
          : 'Sequence saved. Leads will advance through these steps automatically and stop when they reply.'
      );
      onSave?.();
    } catch (error) {
      console.error('Error saving sequence:', error);
      setMessage(error instanceof Error ? error.message : 'Could not save the sequence.');
    } finally {
      setSaving(false);
    }
  };

  const fieldClass = theme === 'gold'
    ? 'border-yellow-400/30 bg-black/40 text-gray-200 focus:ring-yellow-400'
    : 'border-gray-300 bg-white text-gray-900 focus:ring-blue-500';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className={`text-lg font-semibold ${theme === 'gold' ? 'text-gray-200' : 'text-gray-900'}`}>
            Cold Outreach Sequence
          </h3>
          <p className={`mt-1 max-w-3xl text-sm ${theme === 'gold' ? 'text-gray-400' : 'text-gray-600'}`}>
            One campaign can now contain the full follow-up chain. Each step has its own delay,
            exact copy, and AI training. If a prospect replies, future steps stop automatically.
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

      <div className={`rounded-lg border p-4 ${theme === 'gold' ? 'border-yellow-400/20 bg-yellow-400/5' : 'border-blue-200 bg-blue-50'}`}>
        <div className="flex items-start gap-3">
          <Brain className={`mt-0.5 h-5 w-5 ${theme === 'gold' ? 'text-yellow-400' : 'text-blue-600'}`} />
          <div className="text-sm">
            <p className={`font-medium ${theme === 'gold' ? 'text-gray-200' : 'text-blue-900'}`}>
              Campaign training + sequence training work together
            </p>
            <p className={`mt-1 ${theme === 'gold' ? 'text-gray-400' : 'text-blue-700'}`}>
              The AI Training tab remains your campaign-wide business context. The training box inside each step
              is specific to that message only. The current no-AI email sender uses the exact email copy below;
              the step training is stored with the lead and is ready for AI generation whenever that mode is enabled.
            </p>
          </div>
        </div>
      </div>

      {message && (
        <div className={`rounded-lg border p-3 text-sm ${
          message.toLowerCase().includes('could not') || message.toLowerCase().includes('needs email')
            ? 'border-red-200 bg-red-50 text-red-800'
            : 'border-green-200 bg-green-50 text-green-800'
        }`}>
          {message}
        </div>
      )}

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h4 className={`font-semibold ${theme === 'gold' ? 'text-gray-200' : 'text-gray-900'}`}>
            Sequence Steps ({sequenceSteps.length})
          </h4>
          <span className={`text-xs ${theme === 'gold' ? 'text-gray-500' : 'text-gray-500'}`}>
            Campaign status: {campaignStatus}
          </span>
        </div>

        <div className="space-y-4">
          {sequenceSteps.map((step, index) => {
            const Icon = typeIcon(step.channel_type);
            const isExistingLiveStep = campaignStatus !== 'draft' && Boolean(step.id);

            return (
              <div
                key={step.id || `new-${index}`}
                className={`rounded-xl border p-4 sm:p-5 ${theme === 'gold' ? 'border-yellow-400/20 bg-black/20' : 'border-gray-200 bg-gray-50'}`}
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
                        {step.step_number === 1 ? 'Initial outreach' : `Follow-up ${step.step_number - 1}`} · {typeLabel(step.channel_type)}
                      </div>
                      <div className={`text-xs ${theme === 'gold' ? 'text-gray-500' : 'text-gray-500'}`}>
                        {step.step_number === 1
                          ? 'Starts when the lead enters the campaign.'
                          : `Only runs if the lead has not replied. Waits ${step.delay_days || 0} day(s) after the previous successful contact.`}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => removeStep(index)}
                    disabled={isExistingLiveStep}
                    title={isExistingLiveStep ? 'Historical steps are locked on started campaigns' : 'Delete step'}
                    className="rounded-lg p-2 text-red-500 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className={`mb-2 block text-sm font-medium ${theme === 'gold' ? 'text-gray-300' : 'text-gray-700'}`}>
                      Channel
                    </label>
                    <select
                      value={step.channel_type}
                      disabled={isExistingLiveStep}
                      onChange={e => updateStep(index, 'channel_type', e.target.value as StepType)}
                      className={`w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 disabled:opacity-60 ${fieldClass}`}
                    >
                      {availableTypes.map(type => (
                        <option key={type} value={type}>{typeLabel(type)}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className={`mb-2 block text-sm font-medium ${theme === 'gold' ? 'text-gray-300' : 'text-gray-700'}`}>
                      <Clock className="mr-1 inline h-4 w-4" />
                      Wait after previous step (days)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.25"
                      value={step.delay_days}
                      onChange={e => updateStep(index, 'delay_days', Math.max(0, Number(e.target.value) || 0))}
                      className={`w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 ${fieldClass}`}
                    />
                  </div>
                </div>

                {step.channel_type === 'email' && (
                  <div className="mt-4 space-y-4">
                    <div>
                      <label className={`mb-2 block text-sm font-medium ${theme === 'gold' ? 'text-gray-300' : 'text-gray-700'}`}>
                        Email subject
                      </label>
                      <input
                        type="text"
                        value={step.email_subject}
                        onChange={e => updateStep(index, 'email_subject', e.target.value)}
                        placeholder={step.step_number === 1 ? 'BUSINESS INQUIRIES' : 'Re: BUSINESS INQUIRIES'}
                        className={`w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 ${fieldClass}`}
                      />
                    </div>

                    <div>
                      <label className={`mb-2 block text-sm font-medium ${theme === 'gold' ? 'text-gray-300' : 'text-gray-700'}`}>
                        Exact email copy
                      </label>
                      <textarea
                        rows={10}
                        value={step.email_template}
                        onChange={e => updateStep(index, 'email_template', e.target.value)}
                        placeholder={step.step_number === 1 ? DEFAULT_FIRST_EMAIL : `Hey {first_name},

Just following up on my last email.

...

All the best,

Julian`}
                        className={`w-full resize-y rounded-lg border px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 ${fieldClass}`}
                      />
                      <p className={`mt-1 text-xs ${theme === 'gold' ? 'text-gray-500' : 'text-gray-500'}`}>
                        Variables: {'{first_name}'}, {'{opening}'}, {'{company_name}'}, {'{email}'}. Blank step 1 keeps your current locked first-email template.
                      </p>
                    </div>
                  </div>
                )}

                <div className="mt-4">
                  <label className={`mb-2 block text-sm font-medium ${theme === 'gold' ? 'text-gray-300' : 'text-gray-700'}`}>
                    <Brain className="mr-1 inline h-4 w-4" />
                    AI training / instructions for this sequence only
                  </label>
                  <textarea
                    rows={5}
                    value={step.ai_training}
                    onChange={e => updateStep(index, 'ai_training', e.target.value)}
                    placeholder="Example: This is follow-up #2. Keep it short, acknowledge the previous email without sounding automated, do not repeat the case studies, and end with one simple question."
                    className={`w-full resize-y rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${fieldClass}`}
                  />
                </div>

                <label className={`mt-4 flex items-center gap-2 text-sm ${theme === 'gold' ? 'text-gray-300' : 'text-gray-700'}`}>
                  <input
                    type="checkbox"
                    checked={step.stop_on_reply}
                    onChange={e => updateStep(index, 'stop_on_reply', e.target.checked)}
                  />
                  Stop this lead's remaining sequence as soon as a reply is received
                </label>
              </div>
            );
          })}
        </div>
      </div>

      <div className={`rounded-xl border-2 border-dashed p-4 ${theme === 'gold' ? 'border-yellow-400/30' : 'border-gray-300'}`}>
        <div className={`mb-3 text-sm font-medium ${theme === 'gold' ? 'text-gray-300' : 'text-gray-700'}`}>
          Add another sequence step
        </div>
        <div className="flex flex-wrap gap-2">
          {availableTypes.map(type => {
            const Icon = typeIcon(type);
            return (
              <button
                key={type}
                onClick={() => addStep(type)}
                className={`inline-flex items-center rounded-lg border px-3 py-2 text-sm font-medium ${
                  theme === 'gold'
                    ? 'border-yellow-400/30 text-yellow-400 hover:bg-yellow-400/10'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-100'
                }`}
              >
                <Plus className="mr-1 h-4 w-4" />
                <Icon className="mr-2 h-4 w-4" />
                Add {typeLabel(type)}
              </button>
            );
          })}
        </div>

        {availableTypes.length === 0 && (
          <p className="text-sm text-gray-500">Connect an active outreach channel in Settings first.</p>
        )}
      </div>
    </div>
  );
}
