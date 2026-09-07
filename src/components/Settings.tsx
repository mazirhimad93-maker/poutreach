import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { useTheme } from '../contexts/ThemeContext';
import { DynamicChannelForm } from './DynamicChannelForm';
import { 
  User, 
  Bell, 
  Shield, 
  Palette, 
  MessageSquare,
  Check,
  Crown,
  Zap,
  Edit2,
  Plus,
  Phone,
  Mail,
  Trash2,
  X,
  ArrowLeft
} from 'lucide-react';

export function Settings() {
  const { user, isAdmin } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<'profile' | 'notifications' | 'security' | 'appearance' | 'channels'>('profile');

  const tabs = [
    { key: 'profile', label: 'Profile', icon: User },
    { key: 'notifications', label: 'Notifications', icon: Bell },
    { key: 'security', label: 'Security', icon: Shield },
    { key: 'appearance', label: 'Appearance', icon: Palette },
    { key: 'channels', label: 'Channels', icon: MessageSquare },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center space-x-3 mb-2">
          {theme === 'gold' ? (
            <Crown className="h-8 w-8 text-yellow-400" />
          ) : (
            <User className="h-8 w-8 text-blue-600" />
          )}
          <h1 className={`text-3xl font-bold ${
            theme === 'gold' ? 'gold-text-gradient' : 'text-gray-900'
          }`}>
            Settings
          </h1>
        </div>
        <p className={theme === 'gold' ? 'text-gray-400' : 'text-gray-600'}>
          Manage your account settings and preferences
        </p>
      </div>

      {/* Settings Container */}
      <div className={`rounded-xl shadow-sm border ${
        theme === 'gold' 
          ? 'black-card gold-border' 
          : 'bg-white border-gray-200'
      }`}>
        {/* Tabs */}
        <div className={`border-b ${
          theme === 'gold' ? 'border-yellow-400/20' : 'border-gray-200'
        }`}>
          <nav className="flex overflow-x-auto px-4 sm:px-6">
            {tabs.map((tab) => {
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
          {/* Profile Tab */}
          {activeTab === 'profile' && (
            <div className="space-y-6">
              <div>
                <h3 className={`text-lg font-semibold mb-4 ${
                  theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
                }`}>
                  Profile Information
                </h3>
                
                <div className="space-y-4">
                  <div>
                    <label className={`block text-sm font-medium mb-2 ${
                      theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
                    }`}>
                      Full Name
                    </label>
                    <input
                      type="text"
                      defaultValue={user?.user_metadata?.full_name || ''}
                      className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                        theme === 'gold'
                          ? 'border-yellow-400/30 bg-black/50 text-gray-200 focus:ring-yellow-400'
                          : 'border-gray-300 bg-white text-gray-900 focus:ring-blue-500'
                      }`}
                    />
                  </div>
                  
                  <div>
                    <label className={`block text-sm font-medium mb-2 ${
                      theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
                    }`}>
                      Email Address
                    </label>
                    <input
                      type="email"
                      defaultValue={user?.email || ''}
                      disabled
                      className={`w-full px-3 py-2 border rounded-lg ${
                        theme === 'gold'
                          ? 'border-yellow-400/30 bg-black/30 text-gray-400'
                          : 'border-gray-300 bg-gray-50 text-gray-500'
                      }`}
                    />
                    <p className={`text-xs mt-1 ${
                      theme === 'gold' ? 'text-gray-500' : 'text-gray-500'
                    }`}>
                      Email cannot be changed
                    </p>
                  </div>

                  <div className="flex justify-end">
                    <button className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                      theme === 'gold'
                        ? 'gold-gradient text-black hover-gold'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}>
                      Save Changes
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Notifications Tab */}
          {activeTab === 'notifications' && (
            <div className="space-y-6">
              <div>
                <h3 className={`text-lg font-semibold mb-4 ${
                  theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
                }`}>
                  Notification Preferences
                </h3>
                
                <div className="space-y-4">
                  {[
                    { label: 'Email notifications for new bookings', description: 'Get notified when leads book appointments' },
                    { label: 'Campaign performance updates', description: 'Weekly reports on campaign metrics' },
                    { label: 'System maintenance alerts', description: 'Important updates about platform maintenance' },
                    { label: 'Marketing communications', description: 'Product updates and feature announcements' },
                  ].map((item, index) => (
                    <div key={index} className={`flex items-start justify-between p-4 rounded-lg ${
                      theme === 'gold' ? 'bg-yellow-400/5 border border-yellow-400/20' : 'bg-gray-50'
                    }`}>
                      <div className="flex-1">
                        <div className={`font-medium ${
                          theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
                        }`}>
                          {item.label}
                        </div>
                        <div className={`text-sm ${
                          theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
                        }`}>
                          {item.description}
                        </div>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" defaultChecked className="sr-only peer" />
                        <div className={`relative w-11 h-6 rounded-full peer ${
                          theme === 'gold' 
                            ? 'bg-gray-700 peer-checked:bg-yellow-400' 
                            : 'bg-gray-200 peer-checked:bg-blue-600'
                        } peer-focus:outline-none peer-focus:ring-4 ${
                          theme === 'gold' 
                            ? 'peer-focus:ring-yellow-400/25' 
                            : 'peer-focus:ring-blue-300'
                        } peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all`}></div>
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Security Tab */}
          {activeTab === 'security' && (
            <div className="space-y-6">
              <div>
                <h3 className={`text-lg font-semibold mb-4 ${
                  theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
                }`}>
                  Security Settings
                </h3>
                
                <div className="space-y-4">
                  <div className={`p-4 rounded-lg ${
                    theme === 'gold' ? 'bg-yellow-400/5 border border-yellow-400/20' : 'bg-gray-50'
                  }`}>
                    <div className={`font-medium mb-2 ${
                      theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
                    }`}>
                      Change Password
                    </div>
                    <div className={`text-sm mb-4 ${
                      theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
                    }`}>
                      Update your password to keep your account secure
                    </div>
                    <button className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                      theme === 'gold'
                        ? 'gold-gradient text-black hover-gold'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}>
                      Change Password
                    </button>
                  </div>

                  <div className={`p-4 rounded-lg ${
                    theme === 'gold' ? 'bg-yellow-400/5 border border-yellow-400/20' : 'bg-gray-50'
                  }`}>
                    <div className={`font-medium mb-2 ${
                      theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
                    }`}>
                      Two-Factor Authentication
                    </div>
                    <div className={`text-sm mb-4 ${
                      theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
                    }`}>
                      Add an extra layer of security to your account
                    </div>
                    <button className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${
                      theme === 'gold'
                        ? 'border-yellow-400/30 text-yellow-400 hover:bg-yellow-400/10'
                        : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}>
                      Enable 2FA
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Appearance Tab */}
          {activeTab === 'appearance' && (
            <div className="space-y-6">
              <div>
                <h3 className={`text-lg font-semibold mb-4 ${
                  theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
                }`}>
                  Appearance Settings
                </h3>
                
                <div className="space-y-4">
                  <div className={`p-4 rounded-lg ${
                    theme === 'gold' ? 'bg-yellow-400/5 border border-yellow-400/20' : 'bg-gray-50'
                  }`}>
                    <div className={`font-medium mb-2 ${
                      theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
                    }`}>
                      Theme
                    </div>
                    <div className={`text-sm mb-4 ${
                      theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
                    }`}>
                      Choose your preferred theme
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <button
                        onClick={() => theme === 'gold' && toggleTheme()}
                        className={`p-4 rounded-lg border-2 transition-all ${
                          theme === 'blue'
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-300 hover:border-gray-400'
                        }`}
                      >
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                            <Zap className="h-4 w-4 text-white" />
                          </div>
                          <div className="text-left">
                            <div className="font-medium text-gray-900">Professional</div>
                            <div className="text-sm text-gray-600">Clean blue theme</div>
                          </div>
                          {theme === 'blue' && (
                            <Check className="h-5 w-5 text-blue-600 ml-auto" />
                          )}
                        </div>
                      </button>

                      <button
                        onClick={() => theme === 'blue' && toggleTheme()}
                        className={`p-4 rounded-lg border-2 transition-all ${
                          theme === 'gold'
                            ? 'border-yellow-400 bg-yellow-400/10'
                            : 'border-gray-300 hover:border-gray-400'
                        }`}
                      >
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 gold-gradient rounded-lg flex items-center justify-center">
                            <Crown className="h-4 w-4 text-black" />
                          </div>
                          <div className="text-left">
                            <div className={`font-medium ${
                              theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
                            }`}>
                              Elite
                            </div>
                            <div className={`text-sm ${
                              theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
                            }`}>
                              Premium gold theme
                            </div>
                          </div>
                          {theme === 'gold' && (
                            <Check className="h-5 w-5 text-yellow-400 ml-auto" />
                          )}
                        </div>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Channels Tab */}
          {activeTab === 'channels' && (
            <>
            <div className="space-y-6">
              <div className={`p-4 rounded-lg ${
                theme === 'gold'
                  ? 'bg-yellow-400/10 border border-yellow-400/20'
                  : 'bg-blue-50 border border-blue-200'
              }`}>
                <h4 className={`text-sm font-medium mb-2 ${
                  theme === 'gold' ? 'text-yellow-400' : 'text-blue-700'
                }`}>
                  Required for Campaign Publishing
                </h4>
                <p className={`text-sm ${
                  theme === 'gold' ? 'text-gray-400' : 'text-blue-600'
                }`}>
                  You must connect at least one communication channel before you can publish and run campaigns. 
                  Choose from VAPI for AI voice calls, Twilio for SMS/WhatsApp, or Instantly.ai for email outreach.
                </p>
              </div>
              
              <div>
                <h3 className={`text-lg font-semibold mb-4 ${
                  theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
                }`}>
                  Communication Channels
                </h3>
                <p className={`text-sm ${
                  theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
                }`}>
                  Configure your communication channels for calls, SMS, WhatsApp, and email
                </p>
              </div>

              <ChannelsManager />
            </div>
            </>
          )}
        </div>
        </div>
      </div>
  );
}

// New ChannelsManager component
function ChannelsManager() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [channels, setChannels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showChannelForm, setShowChannelForm] = useState(false);

  useEffect(() => {
    if (user) {
      fetchChannels();
    }
  }, [user]);

  const fetchChannels = async () => {
    if (!user) return;
    
    if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('channels')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setChannels(data || []);
    } catch (error) {
      console.error('Error fetching channels:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddChannel = () => {
    setShowChannelForm(true);
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

  const getStatusColor = (isActive: boolean) => {
    return isActive
      ? theme === 'gold'
        ? 'bg-green-500/20 text-green-400'
        : 'bg-green-100 text-green-800'
      : theme === 'gold'
        ? 'bg-red-500/20 text-red-400'
        : 'bg-red-100 text-red-800';
  };

  const deleteChannel = async (channelId: string) => {
    if (!confirm('Are you sure you want to delete this channel?')) return;
    
    if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
      alert('Database connection not available');
      return;
    }

    try {
      const { error } = await supabase
        .from('channels')
        .delete()
        .eq('id', channelId);

      if (error) throw error;
      fetchChannels();
    } catch (error) {
      console.error('Error deleting channel:', error);
    }
  };


  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className={`animate-spin rounded-full h-8 w-8 border-2 border-transparent ${
          theme === 'gold' ? 'border-t-yellow-400' : 'border-t-blue-600'
        }`}></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Add button */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className={`text-lg font-semibold ${
            theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
          }`}>
            Connected Channels ({channels.length})
          </h3>
          <p className={`text-sm ${
            theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
          }`}>
            Manage your communication channel integrations
          </p>
        </div>
        <button
          onClick={handleAddChannel}
          className={`inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            theme === 'gold'
              ? 'gold-gradient text-black hover-gold'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Channel
        </button>
      </div>

      {/* Channels List */}
      {channels.length === 0 ? (
        <div className={`text-center py-12 border-2 border-dashed rounded-lg ${
          theme === 'gold'
            ? 'border-yellow-400/30 text-gray-400'
            : 'border-gray-300 text-gray-500'
        }`}>
          <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <h3 className={`text-lg font-medium mb-2 ${
            theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
          }`}>
            No channels configured
          </h3>
          <p className="mb-4">Add your first communication channel to start outreach</p>
          <button
            onClick={handleAddChannel}
            className={`inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              theme === 'gold'
                ? 'gold-gradient text-black hover-gold'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add First Channel
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {channels.map((channel) => {
            const Icon = getChannelIcon(channel.channel_type);
            return (
              <div
                key={channel.id}
                className={`p-6 rounded-lg border ${
                  theme === 'gold'
                    ? 'border-yellow-400/20 bg-black/20'
                    : 'border-gray-200 bg-white'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className={`p-3 rounded-lg ${
                      theme === 'gold' ? 'bg-yellow-400/20' : 'bg-blue-100'
                    }`}>
                      <Icon className={`h-6 w-6 ${
                        theme === 'gold' ? 'text-yellow-400' : 'text-blue-600'
                      }`} />
                    </div>
                    <div>
                      <h4 className={`text-lg font-semibold ${
                        theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
                      }`}>
                        {channel.provider.charAt(0).toUpperCase() + channel.provider.slice(1)} {channel.channel_type.charAt(0).toUpperCase() + channel.channel_type.slice(1)}
                      </h4>
                      <p className={`text-sm ${
                        theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
                      }`}>
                        {channel.sender_id && `From: ${channel.sender_id}`}
                      </p>
                      <p className={`text-xs ${
                        theme === 'gold' ? 'text-gray-500' : 'text-gray-500'
                      }`}>
                        Added {new Date(channel.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-3">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(channel.is_active)}`}>
                      {channel.is_active ? 'Active' : 'Inactive'}
                    </span>
                    
                    <div className={`text-sm ${
                      theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
                    }`}>
                      {channel.usage_count || 0} / {channel.max_usage || 100} used
                    </div>

                    
                    <button
                      onClick={() => deleteChannel(channel.id)}
                      className={`p-2 rounded-lg transition-colors ${
                        theme === 'gold'
                          ? 'text-red-400 hover:bg-red-400/10'
                          : 'text-red-600 hover:bg-red-50'
                      }`}
                      title="Delete channel"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Dynamic Channel Form Modal */}
      {showChannelForm && (
        <DynamicChannelForm
          onClose={() => setShowChannelForm(false)}
          onSuccess={() => {
            fetchChannels();
            setShowChannelForm(false);
          }}
        />
      )}
    </div>
  );
}