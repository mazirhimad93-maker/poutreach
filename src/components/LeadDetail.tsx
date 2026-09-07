import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../lib/supabase';
import { MessageLogs } from './MessageLogs';
import { User, Phone, Mail, Building, Briefcase, Calendar, ExternalLink, X } from 'lucide-react';

interface Lead {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  company_name: string | null;
  job_title: string | null;
  status: string | null;
  created_at: string;
}

interface Booking {
  id: string;
  booking_type: 'calendar' | 'manual' | 'reply';
  booking_date: string | null;
  booking_url: string | null;
  notes: string | null;
  status: 'scheduled' | 'completed' | 'cancelled' | 'no_show';
  created_at: string;
}

interface LeadDetailProps {
  leadId: string;
  campaignId: string;
  onClose: () => void;
}

export function LeadDetail({ leadId, campaignId, onClose }: LeadDetailProps) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [lead, setLead] = useState<Lead | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (leadId) {
      fetchLeadData();
    }
  }, [leadId]);

  const fetchLeadData = async () => {
    try {
      // Fetch lead details
      const { data: leadData, error: leadError } = await supabase
        .from('uploaded_leads')
        .select('*')
        .eq('id', leadId)
        .single();

      if (leadError) throw leadError;

      // Fetch bookings
      const { data: bookingsData, error: bookingsError } = await supabase
        .from('bookings')
        .select('*')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false });

      if (bookingsError) throw bookingsError;

      setLead(leadData);
      setBookings(bookingsData || []);
    } catch (error) {
      console.error('Error fetching lead data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string | null) => {
    switch (status) {
      case 'scheduled':
        return theme === 'gold' ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-800';
      case 'completed':
        return theme === 'gold' ? 'bg-green-500/20 text-green-400' : 'bg-green-100 text-green-800';
      case 'cancelled':
        return theme === 'gold' ? 'bg-red-500/20 text-red-400' : 'bg-red-100 text-red-800';
      case 'no_show':
        return theme === 'gold' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-yellow-100 text-yellow-800';
      default:
        return theme === 'gold' ? 'bg-gray-500/20 text-gray-400' : 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className={`animate-spin rounded-full h-8 w-8 border-2 border-transparent ${
          theme === 'gold'
            ? 'border-t-yellow-400'
            : 'border-t-blue-600'
        }`}></div>
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="text-center py-8">
        <p className={theme === 'gold' ? 'text-gray-400' : 'text-gray-600'}>
          Lead not found
        </p>
      </div>
    );
  }

  return (
    <div className={`fixed inset-0 z-50 overflow-y-auto ${
      theme === 'gold' ? 'bg-black/75' : 'bg-gray-900/50'
    }`}>
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className={`w-full max-w-4xl rounded-xl shadow-2xl ${
          theme === 'gold' ? 'black-card gold-border' : 'bg-white border border-gray-200'
        }`}>
          {/* Header */}
          <div className={`flex items-center justify-between p-6 border-b ${
            theme === 'gold' ? 'border-yellow-400/20' : 'border-gray-200'
          }`}>
            <div className="flex items-center space-x-3">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                theme === 'gold' ? 'gold-gradient' : 'bg-blue-100'
              }`}>
                <User className={`h-6 w-6 ${
                  theme === 'gold' ? 'text-black' : 'text-blue-600'
                }`} />
              </div>
              <div>
                <h2 className={`text-xl font-bold ${
                  theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
                }`}>
                  {lead.name || 'Unknown Lead'}
                </h2>
                <p className={`text-sm ${
                  theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
                }`}>
                  Lead Details & History
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className={`p-2 rounded-lg transition-colors ${
                theme === 'gold'
                  ? 'text-gray-400 hover:bg-gray-800'
                  : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-6 space-y-6">
            {/* Lead Information */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className={`p-4 rounded-lg ${
                theme === 'gold' ? 'bg-yellow-400/5 border border-yellow-400/20' : 'bg-gray-50 border border-gray-200'
              }`}>
                <h3 className={`text-lg font-semibold mb-4 ${
                  theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
                }`}>
                  Contact Information
                </h3>
                <div className="space-y-3">
                  {lead.phone && (
                    <div className="flex items-center space-x-2">
                      <Phone className={`h-4 w-4 ${
                        theme === 'gold' ? 'text-yellow-400' : 'text-gray-500'
                      }`} />
                      <span className={`text-sm ${
                        theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
                      }`}>
                        {lead.phone}
                      </span>
                    </div>
                  )}
                  {lead.email && (
                    <div className="flex items-center space-x-2">
                      <Mail className={`h-4 w-4 ${
                        theme === 'gold' ? 'text-yellow-400' : 'text-gray-500'
                      }`} />
                      <span className={`text-sm ${
                        theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
                      }`}>
                        {lead.email}
                      </span>
                    </div>
                  )}
                  {lead.company_name && (
                    <div className="flex items-center space-x-2">
                      <Building className={`h-4 w-4 ${
                        theme === 'gold' ? 'text-yellow-400' : 'text-gray-500'
                      }`} />
                      <span className={`text-sm ${
                        theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
                      }`}>
                        {lead.company_name}
                      </span>
                    </div>
                  )}
                  {lead.job_title && (
                    <div className="flex items-center space-x-2">
                      <Briefcase className={`h-4 w-4 ${
                        theme === 'gold' ? 'text-yellow-400' : 'text-gray-500'
                      }`} />
                      <span className={`text-sm ${
                        theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
                      }`}>
                        {lead.job_title}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Bookings */}
              <div className={`p-4 rounded-lg ${
                theme === 'gold' ? 'bg-yellow-400/5 border border-yellow-400/20' : 'bg-gray-50 border border-gray-200'
              }`}>
                <h3 className={`text-lg font-semibold mb-4 ${
                  theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
                }`}>
                  Bookings ({bookings.length})
                </h3>
                {bookings.length === 0 ? (
                  <p className={`text-sm ${
                    theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                    No bookings yet
                  </p>
                ) : (
                  <div className="space-y-3">
                    {bookings.map((booking) => (
                      <div
                        key={booking.id}
                        className={`p-3 rounded-lg border ${
                          theme === 'gold'
                            ? 'border-yellow-400/10 bg-black/20'
                            : 'border-gray-200 bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center space-x-2">
                            <Calendar className={`h-4 w-4 ${
                              theme === 'gold' ? 'text-yellow-400' : 'text-blue-600'
                            }`} />
                            <span className={`text-sm font-medium capitalize ${
                              theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
                            }`}>
                              {booking.booking_type}
                            </span>
                          </div>
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(booking.status)}`}>
                            {booking.status.replace('_', ' ')}
                          </span>
                        </div>
                        
                        {booking.booking_date && (
                          <p className={`text-xs ${
                            theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
                          }`}>
                            {new Date(booking.booking_date).toLocaleDateString()} at {new Date(booking.booking_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        )}
                        
                        {booking.booking_url && (
                          <a
                            href={booking.booking_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`inline-flex items-center text-xs hover:underline mt-1 ${
                              theme === 'gold' ? 'text-yellow-400' : 'text-blue-600'
                            }`}
                          >
                            <ExternalLink className="h-3 w-3 mr-1" />
                            View Booking
                          </a>
                        )}
                        
                        {booking.notes && (
                          <p className={`text-xs mt-2 ${
                            theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
                          }`}>
                            {booking.notes}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Message Logs */}
            <div className={`p-4 rounded-lg ${
              theme === 'gold' ? 'bg-yellow-400/5 border border-yellow-400/20' : 'bg-gray-50 border border-gray-200'
            }`}>
              <MessageLogs leadId={leadId} campaignId={campaignId} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}