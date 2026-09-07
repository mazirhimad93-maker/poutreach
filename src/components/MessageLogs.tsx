import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../lib/supabase';
import { Phone, MessageSquare, Mail, ArrowUpRight, ArrowDownLeft, Play, Clock } from 'lucide-react';

interface ConversationHistory {
  id: string;
  message_type: 'call' | 'sms' | 'whatsapp' | 'email';
  direction: 'inbound' | 'outbound';
  content: string | null;
  response_received: boolean;
  call_duration: number | null;
  call_recording_url: string | null;
  created_at: string;
}

interface MessageLogsProps {
  leadId: string;
  campaignId: string;
}

export function MessageLogs({ leadId, campaignId }: MessageLogsProps) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [messages, setMessages] = useState<ConversationHistory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (leadId) {
      fetchMessages();
    }
  }, [leadId]);

  const fetchMessages = async () => {
    try {
      const { data, error } = await supabase
        .from('conversation_history')
        .select('*')
        .eq('lead_id', leadId)
        .eq('campaign_id', campaignId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setMessages(data || []);
    } catch (error) {
      console.error('Error fetching messages:', error);
    } finally {
      setLoading(false);
    }
  };

  const getMessageIcon = (type: string) => {
    switch (type) {
      case 'call':
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

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return 'N/A';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className={`animate-spin rounded-full h-8 w-8 border-2 border-transparent ${
          theme === 'gold'
            ? 'border-t-yellow-400'
            : 'border-t-blue-600'
        }`}></div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="text-center py-8">
        <MessageSquare className={`h-12 w-12 mx-auto mb-4 ${
          theme === 'gold' ? 'text-gray-600' : 'text-gray-400'
        }`} />
        <p className={`text-sm ${
          theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
        }`}>
          No message history yet
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h4 className={`text-sm font-medium ${
        theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
      }`}>
        Message History ({messages.length})
      </h4>
      
      <div className="space-y-3 max-h-96 overflow-y-auto">
        {messages.map((message) => {
          const Icon = getMessageIcon(message.message_type);
          const isOutbound = message.direction === 'outbound';
          
          return (
            <div
              key={message.id}
              className={`p-4 rounded-lg border ${
                theme === 'gold'
                  ? 'border-yellow-400/20 bg-black/10'
                  : 'border-gray-200 bg-gray-50'
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center space-x-2">
                  <div className={`p-1.5 rounded-lg ${
                    theme === 'gold'
                      ? isOutbound ? 'bg-yellow-400/20' : 'bg-blue-400/20'
                      : isOutbound ? 'bg-blue-100' : 'bg-green-100'
                  }`}>
                    <Icon className={`h-4 w-4 ${
                      theme === 'gold'
                        ? isOutbound ? 'text-yellow-400' : 'text-blue-400'
                        : isOutbound ? 'text-blue-600' : 'text-green-600'
                    }`} />
                  </div>
                  <span className={`text-sm font-medium capitalize ${
                    theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
                  }`}>
                    {message.message_type}
                  </span>
                  <div className="flex items-center">
                    {isOutbound ? (
                      <ArrowUpRight className={`h-3 w-3 ${
                        theme === 'gold' ? 'text-yellow-400' : 'text-blue-600'
                      }`} />
                    ) : (
                      <ArrowDownLeft className={`h-3 w-3 ${
                        theme === 'gold' ? 'text-blue-400' : 'text-green-600'
                      }`} />
                    )}
                    <span className={`text-xs ml-1 ${
                      theme === 'gold' ? 'text-gray-400' : 'text-gray-500'
                    }`}>
                      {isOutbound ? 'Sent' : 'Received'}
                    </span>
                  </div>
                </div>
                
                <div className="flex items-center space-x-2">
                  {message.message_type === 'call' && message.call_duration && (
                    <div className={`flex items-center text-xs ${
                      theme === 'gold' ? 'text-gray-400' : 'text-gray-500'
                    }`}>
                      <Clock className="h-3 w-3 mr-1" />
                      {formatDuration(message.call_duration)}
                    </div>
                  )}
                  
                  {message.call_recording_url && (
                    <a
                      href={message.call_recording_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`flex items-center text-xs hover:underline ${
                        theme === 'gold' ? 'text-yellow-400' : 'text-blue-600'
                      }`}
                    >
                      <Play className="h-3 w-3 mr-1" />
                      Recording
                    </a>
                  )}
                  
                  <span className={`text-xs ${
                    theme === 'gold' ? 'text-gray-500' : 'text-gray-400'
                  }`}>
                    {new Date(message.created_at).toLocaleDateString()} {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
              
              {message.content && (
                <p className={`text-sm ${
                  theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
                }`}>
                  {message.content}
                </p>
              )}
              
              {message.response_received && (
                <div className={`mt-2 inline-flex items-center px-2 py-1 rounded-full text-xs ${
                  theme === 'gold'
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-green-100 text-green-800'
                }`}>
                  ✓ Response received
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}