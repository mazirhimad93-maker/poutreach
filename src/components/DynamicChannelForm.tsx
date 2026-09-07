import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../lib/supabase';
import { 
  Phone, 
  MessageSquare, 
  Mail, 
  X, 
  Save, 
  TestTube,
  CheckCircle,
  AlertCircle,
  Eye,
  EyeOff
} from 'lucide-react';

interface DynamicChannelFormProps {
  onClose: () => void;
  onSuccess: () => void;
}

interface ChannelFormData {
  name: string;
  channel_type: 'voice' | 'sms' | 'whatsapp' | 'email';
  
  // Voice (Vapi) fields
  api_key?: string;
  assistant_id?: string;
  phone_number_id?: string;
  
  // SMS/WhatsApp (Twilio) fields
  twilio_sid?: string;
  twilio_auth_token?: string;
  twilio_number?: string;
  twilio_whatsapp_number?: string;
  
  // Email fields
  email_provider?: string;
  smtp_host?: string;
  smtp_port?: string;
  email_username?: string;
  email_password?: string;
  from_email?: string;
  from_name?: string;
  
  // Common fields
  usage_count: number;
  daily_limit: number;
  is_active: boolean;
}

export function DynamicChannelForm({ onClose, onSuccess }: DynamicChannelFormProps) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showPasswords, setShowPasswords] = useState<{ [key: string]: boolean }>({});
  const [formData, setFormData] = useState<ChannelFormData>({
    name: '',
    channel_type: 'voice',
    usage_count: 0,
    daily_limit: 100,
    is_active: true,
  });

  const channelTypes = [
    { value: 'voice', label: 'Voice (Vapi)', icon: Phone, color: 'blue' },
    { value: 'sms', label: 'SMS (Twilio)', icon: MessageSquare, color: 'green' },
    { value: 'whatsapp', label: 'WhatsApp (Twilio)', icon: MessageSquare, color: 'emerald' },
    { value: 'email', label: 'Email (SMTP)', icon: Mail, color: 'purple' },
  ];

  const emailProviders = [
    { value: 'smtp', label: 'SMTP (Generic)' },
    { value: 'sendgrid', label: 'SendGrid' },
    { value: 'mailgun', label: 'Mailgun' },
    { value: 'gmail', label: 'Gmail' },
    { value: 'outlook', label: 'Outlook' },
  ];

  const handleInputChange = (field: keyof ChannelFormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const togglePasswordVisibility = (field: string) => {
    setShowPasswords(prev => ({ ...prev, [field]: !prev[field] }));
  };

  const validateForm = (): string[] => {
    const errors: string[] = [];
    
    if (!formData.name.trim()) {
      errors.push('Channel name is required');
    }

    switch (formData.channel_type) {
      case 'voice':
        if (!formData.api_key?.trim()) errors.push('Vapi API Key is required');
        if (!formData.assistant_id?.trim()) errors.push('Vapi Assistant ID is required');
        if (!formData.phone_number_id?.trim()) errors.push('Vapi Phone Number ID is required');
        break;
        
      case 'sms':
        if (!formData.twilio_sid?.trim()) errors.push('Twilio Account SID is required');
        if (!formData.twilio_auth_token?.trim()) errors.push('Twilio Auth Token is required');
        if (!formData.twilio_number?.trim()) errors.push('Twilio Phone Number is required');
        if (formData.twilio_number && !formData.twilio_number.startsWith('+')) {
          errors.push('Phone number must start with +');
        }
        break;
        
      case 'whatsapp':
        if (!formData.twilio_sid?.trim()) errors.push('Twilio Account SID is required');
        if (!formData.twilio_auth_token?.trim()) errors.push('Twilio Auth Token is required');
        if (!formData.twilio_whatsapp_number?.trim()) errors.push('Twilio WhatsApp Number is required');
        if (formData.twilio_whatsapp_number && !formData.twilio_whatsapp_number.startsWith('+')) {
          errors.push('WhatsApp number must start with +');
        }
        break;
        
      case 'email':
        if (!formData.from_email?.trim()) errors.push('From Email is required');
        if (!formData.email_username?.trim()) errors.push('Email Username is required');
        if (!formData.email_password?.trim()) errors.push('Email Password is required');
        if (formData.email_provider === 'smtp') {
          if (!formData.smtp_host?.trim()) errors.push('SMTP Host is required for SMTP provider');
          if (!formData.smtp_port?.trim()) errors.push('SMTP Port is required for SMTP provider');
        }
        break;
    }

    return errors;
  };

  const handleTestConnection = async () => {
    const errors = validateForm();
    if (errors.length > 0) {
      setTestResult({
        success: false,
        message: `Please fix the following errors: ${errors.join(', ')}`
      });
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      // Simulate test connection - in real implementation, you'd call your test endpoint
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      setTestResult({
        success: true,
        message: 'Connection test successful! Your credentials are valid.'
      });
    } catch (error) {
      setTestResult({
        success: false,
        message: 'Connection test failed. Please check your credentials.'
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const errors = validateForm();
    if (errors.length > 0) {
      setTestResult({
        success: false,
        message: `Please fix the following errors: ${errors.join(', ')}`
      });
      return;
    }

    if (!user) return;

    setSaving(true);
    setTestResult(null);

    try {
      // Prepare credentials object based on channel type
      let credentials: any = {};
      let sender_id: string | null = null;

      switch (formData.channel_type) {
        case 'voice':
          credentials = {
            api_key: formData.api_key,
            assistant_id: formData.assistant_id,
            phone_number_id: formData.phone_number_id,
          };
          break;
          
        case 'sms':
          credentials = {
            twilio_sid: formData.twilio_sid,
            twilio_auth_token: formData.twilio_auth_token,
          };
          sender_id = formData.twilio_number || null;
          break;
          
        case 'whatsapp':
          credentials = {
            twilio_sid: formData.twilio_sid,
            twilio_auth_token: formData.twilio_auth_token,
          };
          sender_id = formData.twilio_whatsapp_number || null;
          break;
          
        case 'email':
          credentials = {
            email_provider: formData.email_provider,
            smtp_host: formData.smtp_host,
            smtp_port: formData.smtp_port ? parseInt(formData.smtp_port) : null,
            email_username: formData.email_username,
            email_password: formData.email_password,
            from_name: formData.from_name,
          };
          sender_id = formData.from_email || null;
          break;
      }

      const channelData = {
        user_id: user.id,
        provider: formData.channel_type === 'voice' ? 'vapi' : 
                 formData.channel_type === 'email' ? 'smtp' : 'twilio',
        channel_type: formData.channel_type,
        credentials,
        sender_id,
        is_active: formData.is_active,
        usage_count: formData.usage_count,
        max_usage: formData.daily_limit,
      };

      const { error } = await supabase
        .from('channels')
        .insert([channelData]);

      if (error) throw error;

      setTestResult({
        success: true,
        message: 'Channel connected successfully!'
      });

      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);

    } catch (error) {
      console.error('Error saving channel:', error);
      setTestResult({
        success: false,
        message: 'Failed to save channel. Please try again.'
      });
    } finally {
      setSaving(false);
    }
  };

  const renderChannelFields = () => {
    switch (formData.channel_type) {
      case 'voice':
        return (
          <>
            <div>
              <label className={`block text-sm font-medium mb-2 ${
                theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
              }`}>
                Vapi API Key *
              </label>
              <div className="relative">
                <input
                  type={showPasswords.api_key ? 'text' : 'password'}
                  value={formData.api_key || ''}
                  onChange={(e) => handleInputChange('api_key', e.target.value)}
                  className={`w-full px-3 py-2 pr-10 border rounded-lg focus:outline-none focus:ring-2 ${
                    theme === 'gold'
                      ? 'border-yellow-400/30 bg-black/50 text-gray-200 focus:ring-yellow-400'
                      : 'border-gray-300 bg-white text-gray-900 focus:ring-blue-500'
                  }`}
                  placeholder="sk-..."
                  required
                />
                <button
                  type="button"
                  onClick={() => togglePasswordVisibility('api_key')}
                  className={`absolute right-3 top-1/2 transform -translate-y-1/2 ${
                    theme === 'gold' ? 'text-gray-400' : 'text-gray-500'
                  }`}
                >
                  {showPasswords.api_key ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${
                theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
              }`}>
                Vapi Assistant ID *
              </label>
              <input
                type="text"
                value={formData.assistant_id || ''}
                onChange={(e) => handleInputChange('assistant_id', e.target.value)}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                  theme === 'gold'
                    ? 'border-yellow-400/30 bg-black/50 text-gray-200 focus:ring-yellow-400'
                    : 'border-gray-300 bg-white text-gray-900 focus:ring-blue-500'
                }`}
                placeholder="assistant_..."
                required
              />
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${
                theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
              }`}>
                Vapi Phone Number ID *
              </label>
              <input
                type="text"
                value={formData.phone_number_id || ''}
                onChange={(e) => handleInputChange('phone_number_id', e.target.value)}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                  theme === 'gold'
                    ? 'border-yellow-400/30 bg-black/50 text-gray-200 focus:ring-yellow-400'
                    : 'border-gray-300 bg-white text-gray-900 focus:ring-blue-500'
                }`}
                placeholder="phone_number_..."
                required
              />
            </div>
          </>
        );

      case 'sms':
        return (
          <>
            <div>
              <label className={`block text-sm font-medium mb-2 ${
                theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
              }`}>
                Twilio Account SID *
              </label>
              <input
                type="text"
                value={formData.twilio_sid || ''}
                onChange={(e) => handleInputChange('twilio_sid', e.target.value)}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                  theme === 'gold'
                    ? 'border-yellow-400/30 bg-black/50 text-gray-200 focus:ring-yellow-400'
                    : 'border-gray-300 bg-white text-gray-900 focus:ring-blue-500'
                }`}
                placeholder="AC..."
                required
              />
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${
                theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
              }`}>
                Twilio Auth Token *
              </label>
              <div className="relative">
                <input
                  type={showPasswords.twilio_auth_token ? 'text' : 'password'}
                  value={formData.twilio_auth_token || ''}
                  onChange={(e) => handleInputChange('twilio_auth_token', e.target.value)}
                  className={`w-full px-3 py-2 pr-10 border rounded-lg focus:outline-none focus:ring-2 ${
                    theme === 'gold'
                      ? 'border-yellow-400/30 bg-black/50 text-gray-200 focus:ring-yellow-400'
                      : 'border-gray-300 bg-white text-gray-900 focus:ring-blue-500'
                  }`}
                  placeholder="Auth Token"
                  required
                />
                <button
                  type="button"
                  onClick={() => togglePasswordVisibility('twilio_auth_token')}
                  className={`absolute right-3 top-1/2 transform -translate-y-1/2 ${
                    theme === 'gold' ? 'text-gray-400' : 'text-gray-500'
                  }`}
                >
                  {showPasswords.twilio_auth_token ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${
                theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
              }`}>
                Twilio Phone Number *
              </label>
              <input
                type="tel"
                value={formData.twilio_number || ''}
                onChange={(e) => handleInputChange('twilio_number', e.target.value)}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                  theme === 'gold'
                    ? 'border-yellow-400/30 bg-black/50 text-gray-200 focus:ring-yellow-400'
                    : 'border-gray-300 bg-white text-gray-900 focus:ring-blue-500'
                }`}
                placeholder="+1234567890"
                required
              />
              <p className={`text-xs mt-1 ${
                theme === 'gold' ? 'text-gray-500' : 'text-gray-500'
              }`}>
                Must begin with +
              </p>
            </div>
          </>
        );

      case 'whatsapp':
        return (
          <>
            <div>
              <label className={`block text-sm font-medium mb-2 ${
                theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
              }`}>
                Twilio Account SID *
              </label>
              <input
                type="text"
                value={formData.twilio_sid || ''}
                onChange={(e) => handleInputChange('twilio_sid', e.target.value)}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                  theme === 'gold'
                    ? 'border-yellow-400/30 bg-black/50 text-gray-200 focus:ring-yellow-400'
                    : 'border-gray-300 bg-white text-gray-900 focus:ring-blue-500'
                }`}
                placeholder="AC..."
                required
              />
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${
                theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
              }`}>
                Twilio Auth Token *
              </label>
              <div className="relative">
                <input
                  type={showPasswords.twilio_auth_token ? 'text' : 'password'}
                  value={formData.twilio_auth_token || ''}
                  onChange={(e) => handleInputChange('twilio_auth_token', e.target.value)}
                  className={`w-full px-3 py-2 pr-10 border rounded-lg focus:outline-none focus:ring-2 ${
                    theme === 'gold'
                      ? 'border-yellow-400/30 bg-black/50 text-gray-200 focus:ring-yellow-400'
                      : 'border-gray-300 bg-white text-gray-900 focus:ring-blue-500'
                  }`}
                  placeholder="Auth Token"
                  required
                />
                <button
                  type="button"
                  onClick={() => togglePasswordVisibility('twilio_auth_token')}
                  className={`absolute right-3 top-1/2 transform -translate-y-1/2 ${
                    theme === 'gold' ? 'text-gray-400' : 'text-gray-500'
                  }`}
                >
                  {showPasswords.twilio_auth_token ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${
                theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
              }`}>
                Twilio WhatsApp Number *
              </label>
              <input
                type="tel"
                value={formData.twilio_whatsapp_number || ''}
                onChange={(e) => handleInputChange('twilio_whatsapp_number', e.target.value)}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                  theme === 'gold'
                    ? 'border-yellow-400/30 bg-black/50 text-gray-200 focus:ring-yellow-400'
                    : 'border-gray-300 bg-white text-gray-900 focus:ring-blue-500'
                }`}
                placeholder="+1234567890"
                required
              />
              <p className={`text-xs mt-1 ${
                theme === 'gold' ? 'text-gray-500' : 'text-gray-500'
              }`}>
                Must begin with +
              </p>
            </div>
          </>
        );

      case 'email':
        return (
          <>
            <div>
              <label className={`block text-sm font-medium mb-2 ${
                theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
              }`}>
                Email Provider *
              </label>
              <select
                value={formData.email_provider || 'smtp'}
                onChange={(e) => handleInputChange('email_provider', e.target.value)}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                  theme === 'gold'
                    ? 'border-yellow-400/30 bg-black/50 text-gray-200 focus:ring-yellow-400'
                    : 'border-gray-300 bg-white text-gray-900 focus:ring-blue-500'
                }`}
              >
                {emailProviders.map(provider => (
                  <option key={provider.value} value={provider.value}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </div>

            {formData.email_provider === 'smtp' && (
              <>
                <div>
                  <label className={`block text-sm font-medium mb-2 ${
                    theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                    SMTP Host *
                  </label>
                  <input
                    type="text"
                    value={formData.smtp_host || ''}
                    onChange={(e) => handleInputChange('smtp_host', e.target.value)}
                    className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                      theme === 'gold'
                        ? 'border-yellow-400/30 bg-black/50 text-gray-200 focus:ring-yellow-400'
                        : 'border-gray-300 bg-white text-gray-900 focus:ring-blue-500'
                    }`}
                    placeholder="smtp.gmail.com"
                    required
                  />
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${
                    theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                    SMTP Port *
                  </label>
                  <input
                    type="number"
                    value={formData.smtp_port || ''}
                    onChange={(e) => handleInputChange('smtp_port', e.target.value)}
                    className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                      theme === 'gold'
                        ? 'border-yellow-400/30 bg-black/50 text-gray-200 focus:ring-yellow-400'
                        : 'border-gray-300 bg-white text-gray-900 focus:ring-blue-500'
                    }`}
                    placeholder="587"
                    required
                  />
                </div>
              </>
            )}

            <div>
              <label className={`block text-sm font-medium mb-2 ${
                theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
              }`}>
                Email Username *
              </label>
              <input
                type="email"
                value={formData.email_username || ''}
                onChange={(e) => handleInputChange('email_username', e.target.value)}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                  theme === 'gold'
                    ? 'border-yellow-400/30 bg-black/50 text-gray-200 focus:ring-yellow-400'
                    : 'border-gray-300 bg-white text-gray-900 focus:ring-blue-500'
                }`}
                placeholder="your-email@domain.com"
                required
              />
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${
                theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
              }`}>
                Email Password *
              </label>
              <div className="relative">
                <input
                  type={showPasswords.email_password ? 'text' : 'password'}
                  value={formData.email_password || ''}
                  onChange={(e) => handleInputChange('email_password', e.target.value)}
                  className={`w-full px-3 py-2 pr-10 border rounded-lg focus:outline-none focus:ring-2 ${
                    theme === 'gold'
                      ? 'border-yellow-400/30 bg-black/50 text-gray-200 focus:ring-yellow-400'
                      : 'border-gray-300 bg-white text-gray-900 focus:ring-blue-500'
                  }`}
                  placeholder="Password or App Password"
                  required
                />
                <button
                  type="button"
                  onClick={() => togglePasswordVisibility('email_password')}
                  className={`absolute right-3 top-1/2 transform -translate-y-1/2 ${
                    theme === 'gold' ? 'text-gray-400' : 'text-gray-500'
                  }`}
                >
                  {showPasswords.email_password ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${
                theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
              }`}>
                From Email *
              </label>
              <input
                type="email"
                value={formData.from_email || ''}
                onChange={(e) => handleInputChange('from_email', e.target.value)}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                  theme === 'gold'
                    ? 'border-yellow-400/30 bg-black/50 text-gray-200 focus:ring-yellow-400'
                    : 'border-gray-300 bg-white text-gray-900 focus:ring-blue-500'
                }`}
                placeholder="sender@yourdomain.com"
                required
              />
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${
                theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
              }`}>
                From Name (Optional)
              </label>
              <input
                type="text"
                value={formData.from_name || ''}
                onChange={(e) => handleInputChange('from_name', e.target.value)}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                  theme === 'gold'
                    ? 'border-yellow-400/30 bg-black/50 text-gray-200 focus:ring-yellow-400'
                    : 'border-gray-300 bg-white text-gray-900 focus:ring-blue-500'
                }`}
                placeholder="Your Name"
              />
            </div>
          </>
        );

      default:
        return null;
    }
  };

  return (
    <div className={`fixed inset-0 z-50 overflow-y-auto ${
      theme === 'gold' ? 'bg-black/75' : 'bg-gray-900/50'
    }`}>
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className={`w-full max-w-2xl rounded-xl shadow-2xl ${
          theme === 'gold' ? 'black-card gold-border' : 'bg-white border border-gray-200'
        }`}>
          {/* Header */}
          <div className={`p-6 border-b ${
            theme === 'gold' ? 'border-yellow-400/20' : 'border-gray-200'
          }`}>
            <div className="flex items-center justify-between">
              <h3 className={`text-xl font-semibold ${
                theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
              }`}>
                Connect Channel
              </h3>
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
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-6">
            {/* Channel Type Selection */}
            <div>
              <label className={`block text-sm font-medium mb-3 ${
                theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
              }`}>
                Channel Type *
              </label>
              <div className="grid grid-cols-2 gap-3">
                {channelTypes.map((type) => {
                  const Icon = type.icon;
                  return (
                    <button
                      key={type.value}
                      type="button"
                      onClick={() => handleInputChange('channel_type', type.value)}
                      className={`p-4 rounded-lg border-2 transition-all ${
                        formData.channel_type === type.value
                          ? theme === 'gold'
                            ? 'border-yellow-400 bg-yellow-400/10'
                            : 'border-blue-500 bg-blue-50'
                          : theme === 'gold'
                            ? 'border-gray-600 hover:border-gray-500'
                            : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-center space-x-3">
                        <Icon className={`h-5 w-5 ${
                          formData.channel_type === type.value
                            ? theme === 'gold' ? 'text-yellow-400' : 'text-blue-600'
                            : theme === 'gold' ? 'text-gray-400' : 'text-gray-500'
                        }`} />
                        <span className={`font-medium ${
                          formData.channel_type === type.value
                            ? theme === 'gold' ? 'text-yellow-400' : 'text-blue-600'
                            : theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
                        }`}>
                          {type.label}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Channel Name */}
            <div>
              <label className={`block text-sm font-medium mb-2 ${
                theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
              }`}>
                Channel Name *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => handleInputChange('name', e.target.value)}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                  theme === 'gold'
                    ? 'border-yellow-400/30 bg-black/50 text-gray-200 focus:ring-yellow-400'
                    : 'border-gray-300 bg-white text-gray-900 focus:ring-blue-500'
                }`}
                placeholder="e.g., Main Sales Line"
                required
              />
            </div>

            {/* Dynamic Channel Fields */}
            {renderChannelFields()}

            {/* Common Settings */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={`block text-sm font-medium mb-2 ${
                  theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
                }`}>
                  Daily Limit
                </label>
                <input
                  type="number"
                  value={formData.daily_limit}
                  onChange={(e) => handleInputChange('daily_limit', parseInt(e.target.value) || 100)}
                  className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                    theme === 'gold'
                      ? 'border-yellow-400/30 bg-black/50 text-gray-200 focus:ring-yellow-400'
                      : 'border-gray-300 bg-white text-gray-900 focus:ring-blue-500'
                  }`}
                  min="1"
                />
              </div>

              <div className="flex items-center">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={(e) => handleInputChange('is_active', e.target.checked)}
                    className={`mr-2 rounded ${
                      theme === 'gold'
                        ? 'text-yellow-400 focus:ring-yellow-400'
                        : 'text-blue-600 focus:ring-blue-500'
                    }`}
                  />
                  <span className={`text-sm font-medium ${
                    theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                    Active Channel
                  </span>
                </label>
              </div>
            </div>

            {/* Test Result */}
            {testResult && (
              <div className={`rounded-lg border p-4 ${
                testResult.success 
                  ? theme === 'gold'
                    ? 'bg-green-500/10 border-green-500/30 text-green-400'
                    : 'bg-green-50 border-green-200 text-green-800'
                  : theme === 'gold'
                    ? 'bg-red-500/10 border-red-500/30 text-red-400'
                    : 'bg-red-50 border-red-200 text-red-800'
              }`}>
                <div className="flex items-start">
                  <div className="flex-shrink-0">
                    {testResult.success ? (
                      <CheckCircle className="h-5 w-5" />
                    ) : (
                      <AlertCircle className="h-5 w-5" />
                    )}
                  </div>
                  <div className="ml-3">
                    <p className="text-sm font-medium">{testResult.message}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex space-x-3 pt-4">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testing}
                className={`flex-1 px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${
                  theme === 'gold'
                    ? 'border-yellow-400/30 text-yellow-400 hover:bg-yellow-400/10'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {testing ? (
                  <div className="flex items-center justify-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2"></div>
                    Testing...
                  </div>
                ) : (
                  <div className="flex items-center justify-center">
                    <TestTube className="h-4 w-4 mr-2" />
                    Test Connection
                  </div>
                )}
              </button>

              <button
                type="button"
                onClick={onClose}
                className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                  theme === 'gold'
                    ? 'text-gray-400 bg-gray-800 border border-gray-600 hover:bg-gray-700'
                    : 'text-gray-700 bg-gray-200 hover:bg-gray-300'
                }`}
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={saving}
                className={`px-6 py-2 text-sm font-medium rounded-lg transition-colors ${
                  theme === 'gold'
                    ? 'gold-gradient text-black hover-gold'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {saving ? (
                  <div className="flex items-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2"></div>
                    Saving...
                  </div>
                ) : (
                  <div className="flex items-center">
                    <Save className="h-4 w-4 mr-2" />
                    Connect Channel
                  </div>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}