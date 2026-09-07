import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../lib/supabase';
import { 
  Plus, 
  Trash2, 
  Phone, 
  MessageSquare, 
  Mail, 
  Clock, 
  Save, 
  Crown, 
  Zap,
  GripVertical,
  ArrowUp,
  ArrowDown
} from 'lucide-react';

interface ConnectedChannel {
  id: string;
  provider: string;
  channel_type: string;
  sender_id: string | null;
  is_active: boolean;
  usage_count: number;
  max_usage: number;
}

interface SequenceStep {
  id?: string;
  step_number: number;
  channel_id: string;
  channel_type: 'voice' | 'sms' | 'whatsapp' | 'email';
  provider: string;
  sender_id: string | null;
  delay_hours: number;
}

interface SequenceBuilderProps {
  campaignId: string;
  onSave?: () => void;
}

export function SequenceBuilder({ campaignId, onSave }: SequenceBuilderProps) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [connectedChannels, setConnectedChannels] = useState<ConnectedChannel[]>([]);
  const [sequenceSteps, setSequenceSteps] = useState<SequenceStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (campaignId && user) {
      fetchConnectedChannels();
      fetchExistingSequence();
    }
  }, [campaignId, user]);

  const fetchConnectedChannels = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('channels')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .order('created_at');

      if (error) throw error;
      setConnectedChannels(data || []);
    } catch (error) {
      console.error('Error fetching connected channels:', error);
    }
  };

  const fetchExistingSequence = async () => {
    try {
      const { data, error } = await supabase
        .from('campaign_sequences')
        .select('*')
        .eq('campaign_id', campaignId)
        .order('step_number');

      if (error) throw error;

      if (data && data.length > 0) {
        const steps = data.map(step => {
          const channel = connectedChannels.find(ch => 
            ch.channel_type === step.type || 
            (step.type === 'call' && ch.channel_type === 'voice')
          );
          
          return {
            id: step.id,
            step_number: step.step_number,
            channel_id: channel?.id || '',
            channel_type: step.type === 'call' ? 'voice' : step.type,
            provider: channel?.provider || 'unknown',
            sender_id: channel?.sender_id || null,
            delay_hours: Math.floor((step.wait_seconds || 0) / 3600),
          };
        });
        setSequenceSteps(steps);
      }
    } catch (error) {
      console.error('Error fetching sequence:', error);
    } finally {
      setLoading(false);
    }
  };

  const addSequenceStep = (channelId: string) => {
    const channel = connectedChannels.find(ch => ch.id === channelId);
    if (!channel) return;

    const newStep: SequenceStep = {
      step_number: sequenceSteps.length + 1,
      channel_id: channelId,
      channel_type: channel.channel_type as any,
      provider: channel.provider,
      sender_id: channel.sender_id,
      delay_hours: sequenceSteps.length === 0 ? 0 : 24,
    };

    setSequenceSteps([...sequenceSteps, newStep]);
  };

  const removeStep = (index: number) => {
    const newSteps = sequenceSteps.filter((_, i) => i !== index);
    const renumberedSteps = newSteps.map((step, i) => ({
      ...step,
      step_number: i + 1,
    }));
    setSequenceSteps(renumberedSteps);
  };

  const moveStep = (index: number, direction: 'up' | 'down') => {
    const newSteps = [...sequenceSteps];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    
    if (targetIndex < 0 || targetIndex >= newSteps.length) return;
    
    [newSteps[index], newSteps[targetIndex]] = [newSteps[targetIndex], newSteps[index]];
    
    const renumberedSteps = newSteps.map((step, i) => ({
      ...step,
      step_number: i + 1,
    }));
    
    setSequenceSteps(renumberedSteps);
  };

  const updateStep = (index: number, field: keyof SequenceStep, value: any) => {
    const newSteps = [...sequenceSteps];
    newSteps[index] = { ...newSteps[index], [field]: value };
    setSequenceSteps(newSteps);
  };

  const saveSequence = async () => {
    if (!user) return;

    setSaving(true);
    try {
      // Delete existing steps
      await supabase
        .from('campaign_sequences')
        .delete()
        .eq('campaign_id', campaignId);

      // Insert new steps
      const stepsToInsert = sequenceSteps.map(step => ({
        campaign_id: campaignId,
        user_id: user.id,
        step_number: step.step_number,
        type: step.channel_type === 'voice' ? 'call' : step.channel_type,
        wait_seconds: step.delay_hours * 3600,
        prompt: `You are an AI appointment setter. Contact leads via ${step.channel_type} and book qualified appointments.`,
      }));

      const { error } = await supabase
        .from('campaign_sequences')
        .insert(stepsToInsert);

      if (error) throw error;

      // Show success message
      alert('Sequence saved successfully! When you publish the campaign, all steps will be pre-scheduled for each lead.');
      onSave?.();
    } catch (error) {
      console.error('Error saving sequence:', error);
      alert('Error saving sequence. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const getChannelIcon = (type: string) => {
    switch (type) {
      case 'voice':
        return Phone;
      case 'sms':
      case 'whatsapp':
        return MessageSquare;
      case 'email':
        return Mail;
      default:
        return MessageSquare;
    }
  };

  const getChannelColor = (type: string) => {
    switch (type) {
      case 'voice':
        return theme === 'gold' ? 'text-yellow-400' : 'text-blue-600';
      case 'sms':
        return theme === 'gold' ? 'text-yellow-400' : 'text-green-600';
      case 'whatsapp':
        return theme === 'gold' ? 'text-yellow-400' : 'text-emerald-600';
      case 'email':
        return theme === 'gold' ? 'text-yellow-400' : 'text-purple-600';
      default:
        return theme === 'gold' ? 'text-gray-400' : 'text-gray-600';
    }
  };

  const getAvailableChannels = () => {
    const usedChannelIds = sequenceSteps.map(step => step.channel_id);
    return connectedChannels.filter(channel => !usedChannelIds.includes(channel.id));
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
            <Zap className="absolute inset-0 m-auto h-4 w-4 text-blue-600" />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className={`text-lg font-semibold ${
            theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
          }`}>
            Campaign Sequence Builder
          </h3>
          <p className={`text-sm ${
            theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
          }`}>
            Design your automated outreach sequence using your connected channels
          </p>
        </div>
        <button
          onClick={saveSequence}
          disabled={saving || sequenceSteps.length === 0}
          className={`inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            theme === 'gold'
              ? 'gold-gradient text-black hover-gold'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          } disabled:opacity-50`}
        >
          {saving ? (
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2"></div>
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Save Sequence
        </button>
      </div>

      {/* Connected Channels Overview */}
      <div className={`p-4 rounded-lg border ${
        theme === 'gold'
          ? 'border-yellow-400/20 bg-black/10'
          : 'border-gray-200 bg-gray-50'
      }`}>
        <h4 className={`text-sm font-medium mb-3 ${
          theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
        }`}>
          Connected Channels ({connectedChannels.length})
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {connectedChannels.map((channel) => {
            const Icon = getChannelIcon(channel.channel_type);
            const isUsed = sequenceSteps.some(step => step.channel_id === channel.id);
            
            return (
              <div
                key={channel.id}
                className={`p-3 rounded-lg border transition-all ${
                  isUsed
                    ? theme === 'gold'
                      ? 'border-yellow-400/30 bg-yellow-400/10'
                      : 'border-blue-200 bg-blue-50'
                    : theme === 'gold'
                      ? 'border-gray-600 bg-black/20'
                      : 'border-gray-200 bg-white'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Icon className={`h-4 w-4 ${getChannelColor(channel.channel_type)}`} />
                    <div>
                      <div className={`text-sm font-medium ${
                        theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
                      }`}>
                        {channel.provider.charAt(0).toUpperCase() + channel.provider.slice(1)} {channel.channel_type.charAt(0).toUpperCase() + channel.channel_type.slice(1)}
                      </div>
                      <div className={`text-xs ${
                        theme === 'gold' ? 'text-gray-500' : 'text-gray-500'
                      }`}>
                        {channel.sender_id && `From: ${channel.sender_id.substring(0, 15)}...`}
                      </div>
                    </div>
                  </div>
                  {!isUsed && (
                    <button
                      onClick={() => addSequenceStep(channel.id)}
                      className={`p-1 rounded transition-colors ${
                        theme === 'gold'
                          ? 'text-yellow-400 hover:bg-yellow-400/10'
                          : 'text-blue-600 hover:bg-blue-100'
                      }`}
                      title="Add to sequence"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Sequence Steps */}
      <div className="space-y-4">
        <h4 className={`text-md font-semibold ${
          theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
        }`}>
          Sequence Steps ({sequenceSteps.length})
        </h4>

        {sequenceSteps.length === 0 ? (
          <div className={`text-center py-12 border-2 border-dashed rounded-lg ${
            theme === 'gold'
              ? 'border-yellow-400/30 text-gray-400'
              : 'border-gray-300 text-gray-500'
          }`}>
            <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <h3 className={`text-lg font-medium mb-2 ${
              theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
            }`}>
              No sequence steps yet
            </h3>
            <p className="mb-4">Add channels from above to build your outreach sequence</p>
          </div>
        ) : (
          <div className="space-y-4">
            {sequenceSteps.map((step, index) => {
              const Icon = getChannelIcon(step.channel_type);
              const channel = connectedChannels.find(ch => ch.id === step.channel_id);
              
              return (
                <div
                  key={index}
                  className={`p-6 rounded-lg border ${
                    theme === 'gold'
                      ? 'border-yellow-400/20 bg-black/20'
                      : 'border-gray-200 bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        theme === 'gold' ? 'gold-gradient text-black' : 'bg-blue-100 text-blue-600'
                      }`}>
                        {step.step_number}
                      </div>
                      <div className={`p-2 rounded-lg ${
                        theme === 'gold' ? 'bg-yellow-400/10' : 'bg-white'
                      }`}>
                        <Icon className={`h-4 w-4 ${getChannelColor(step.channel_type)}`} />
                      </div>
                      <div>
                        <span className={`font-medium ${
                          theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
                        }`}>
                          {channel?.provider.charAt(0).toUpperCase() + channel?.provider.slice(1)} {step.channel_type.charAt(0).toUpperCase() + step.channel_type.slice(1)}
                        </span>
                        <p className={`text-sm ${
                          theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
                        }`}>
                          {step.sender_id && `From: ${step.sender_id}`}
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => moveStep(index, 'up')}
                        disabled={index === 0}
                        className={`p-2 rounded-lg transition-colors disabled:opacity-50 ${
                          theme === 'gold'
                            ? 'text-gray-400 hover:bg-gray-800'
                            : 'text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        <ArrowUp className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => moveStep(index, 'down')}
                        disabled={index === sequenceSteps.length - 1}
                        className={`p-2 rounded-lg transition-colors disabled:opacity-50 ${
                          theme === 'gold'
                            ? 'text-gray-400 hover:bg-gray-800'
                            : 'text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => removeStep(index)}
                        className={`p-2 rounded-lg transition-colors ${
                          theme === 'gold'
                            ? 'text-red-400 hover:bg-red-400/10'
                            : 'text-red-600 hover:bg-red-50'
                        }`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className={`block text-sm font-medium mb-2 ${
                        theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
                      }`}>
                        Delay (Hours)
                      </label>
                      <div className="relative">
                        <Clock className={`absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 ${
                          theme === 'gold' ? 'text-yellow-400' : 'text-gray-400'
                        }`} />
                        <input
                          type="number"
                          min="0"
                          value={step.delay_hours}
                          onChange={(e) => updateStep(index, 'delay_hours', parseInt(e.target.value) || 0)}
                          className={`w-full pl-10 pr-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                            theme === 'gold'
                              ? 'border-yellow-400/30 bg-black/50 text-gray-200 focus:ring-yellow-400'
                              : 'border-gray-300 bg-white text-gray-900 focus:ring-blue-500'
                          }`}
                          placeholder="24"
                        />
                      </div>
                      <p className={`text-xs mt-1 ${
                        theme === 'gold' ? 'text-gray-500' : 'text-gray-500'
                      }`}>
                        {index === 0 ? 'First step (usually 0)' : 'Hours after previous step'}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add More Channels */}
      {getAvailableChannels().length > 0 && (
        <div className={`p-4 rounded-lg border-2 border-dashed ${
          theme === 'gold'
            ? 'border-yellow-400/30 bg-yellow-400/5'
            : 'border-gray-300 bg-gray-50'
        }`}>
          <h4 className={`text-sm font-medium mb-3 ${
            theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
          }`}>
            Add More Channels
          </h4>
          <div className="flex flex-wrap gap-2">
            {getAvailableChannels().map((channel) => {
              const Icon = getChannelIcon(channel.channel_type);
              
              return (
                <button
                  key={channel.id}
                  onClick={() => addSequenceStep(channel.id)}
                  className={`inline-flex items-center px-3 py-2 text-sm rounded-lg border transition-colors ${
                    theme === 'gold'
                      ? 'border-yellow-400/30 text-yellow-400 hover:bg-yellow-400/10'
                      : 'border-gray-300 text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <Icon className="h-4 w-4 mr-2" />
                  {channel.provider.charAt(0).toUpperCase() + channel.provider.slice(1)} {channel.channel_type.charAt(0).toUpperCase() + channel.channel_type.slice(1)}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}