import React, { useState, useEffect } from 'react';
import { Plus, Save, FileText, Link, Tag, Trash2, TestTube, Phone, MessageSquare, Play, Target } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';

interface TrainingResource {
  id: string;
  campaign_id: string;
  type: string;
  content: string;
  created_at: string;
}

interface AITrainerProps {
  campaignId: string;
}

export function AITrainer({ campaignId }: AITrainerProps) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [resources, setResources] = useState<TrainingResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showTestModal, setShowTestModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testName, setTestName] = useState('');
  const [testCompany, setTestCompany] = useState('');
  const [testType, setTestType] = useState<'call' | 'sms' | 'whatsapp'>('call');
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [formData, setFormData] = useState({
    resource_type: 'note',
    content: '',
    link_url: '',
    tags: ''
  });

  useEffect(() => {
    fetchResources();
  }, [campaignId]);

  const fetchResources = async () => {
    try {
      const { data, error } = await supabase
        .from('training_resources')
        .select('*')
        .eq('campaign_id', campaignId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setResources(data || []);
    } catch (error) {
      console.error('Error fetching training resources:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const resourceData = {
        campaign_id: campaignId,
        user_id: user.id,
        type: formData.resource_type,
        content: formData.resource_type === 'url' ? formData.link_url : formData.content
      };

      const { error } = await supabase
        .from('training_resources')
        .insert([resourceData]);

      if (error) throw error;

      setFormData({
        resource_type: 'note',
        content: '',
        link_url: '',
        tags: ''
      });
      setShowAddForm(false);
      fetchResources();
    } catch (error) {
      console.error('Error saving training resource:', error);
    } finally {
      setSaving(false);
    }
  };

  const deleteResource = async (id: string) => {
    try {
      const { error } = await supabase
        .from('training_resources')
        .delete()
        .eq('id', id);

      if (error) throw error;
      fetchResources();
    } catch (error) {
      console.error('Error deleting training resource:', error);
    }
  };

  const handleTestCampaign = async () => {
    if (!testPhone.trim()) {
      setTestResult({
        success: false,
        message: 'Please enter a phone number to test'
      });
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      const response = await fetch('https://mazirhx.app.n8n.cloud/webhook/test-ai-outreach', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: user?.id,
          campaign_id: campaignId,
          channel: testType === 'call' ? 'voice' : testType,
          phone: testPhone,
          name: testName || undefined,
          company_name: testCompany || undefined,
        }),
      });

      if (response.ok) {
        setTestResult({
          success: true,
          message: `Test ${testType === 'call' ? 'voice call' : testType} initiated successfully! You should receive a ${testType === 'call' ? 'call' : 'message'} shortly.`
        });
        setShowTestModal(false);
        setTestPhone('');
        setTestName('');
        setTestCompany('');
      } else {
        throw new Error('Failed to initiate test');
      }
    } catch (error) {
      setTestResult({
        success: false,
        message: `Failed to initiate test ${testType}. Please try again.`
      });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
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
            AI Training Resources
          </h3>
          <p className={`text-sm ${
            theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
          }`}>
            Add notes, links, and files to train your AI assistant
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className={`inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            theme === 'gold'
              ? 'gold-gradient text-black hover-gold'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Resource
        </button>
      </div>
      
      {/* Test AI Button */}
      <div className={`p-4 rounded-lg border ${
        theme === 'gold'
          ? 'border-yellow-400/20 bg-yellow-400/5'
          : 'border-blue-200 bg-blue-50'
      }`}>
        <div className="flex items-center justify-between">
          <div>
            <h4 className={`text-sm font-medium ${
              theme === 'gold' ? 'text-yellow-400' : 'text-blue-700'
            }`}>
              Test Your AI Assistant
            </h4>
            <p className={`text-xs mt-1 ${
              theme === 'gold' ? 'text-gray-400' : 'text-blue-600'
            }`}>
              Test your AI caller with your training data before going live
            </p>
          </div>
          <button
            onClick={() => setShowTestModal(true)}
            className={`inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              theme === 'gold'
                ? 'gold-gradient text-black hover-gold'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            <TestTube className="h-4 w-4 mr-2" />
            Test AI
          </button>
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
                <TestTube className="h-5 w-5" />
              ) : (
                <TestTube className="h-5 w-5" />
              )}
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium">{testResult.message}</p>
            </div>
            <button
              onClick={() => setTestResult(null)}
              className="ml-auto text-current hover:opacity-70"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {resources.length === 0 ? (
        <div className={`text-center py-8 border-2 border-dashed rounded-lg ${
          theme === 'gold'
            ? 'border-yellow-400/30 text-gray-400'
            : 'border-gray-300 text-gray-500'
        }`}>
          <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No training resources added yet</p>
          <p className="text-sm mt-1">Add notes, links, or files to help train your AI</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {resources.map((resource) => (
            <div
              key={resource.id}
              className={`p-4 rounded-lg border ${
                theme === 'gold'
                  ? 'border-yellow-400/30 bg-black/50'
                  : 'border-gray-200 bg-white'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-2">
                    {resource.type === 'url' ? (
                      <Link className="h-4 w-4 text-blue-500" />
                    ) : (
                      <FileText className="h-4 w-4 text-gray-500" />
                    )}
                    <span className={`text-xs font-medium px-2 py-1 rounded ${
                      theme === 'gold'
                        ? 'bg-yellow-400/20 text-yellow-400'
                        : 'bg-gray-100 text-gray-700'
                    }`}>
                      {resource.type}
                    </span>
                  </div>
                  <div className={`text-sm ${
                    theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                    {resource.type === 'url' ? (
                      <a
                        href={resource.content}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500 hover:underline"
                      >
                        {resource.content}
                      </a>
                    ) : (
                      <p className="whitespace-pre-wrap">{resource.content}</p>
                    )}
                  </div>
                  <p className={`text-xs mt-2 ${
                    theme === 'gold' ? 'text-gray-500' : 'text-gray-400'
                  }`}>
                    Added {new Date(resource.created_at).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => deleteResource(resource.id)}
                  className={`p-2 rounded-lg transition-colors ${
                    theme === 'gold'
                      ? 'text-gray-400 hover:text-red-400 hover:bg-red-400/10'
                      : 'text-gray-400 hover:text-red-600 hover:bg-red-50'
                  }`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAddForm && (
        <div className={`p-6 rounded-lg border ${
          theme === 'gold'
            ? 'border-yellow-400/30 bg-black/50'
            : 'border-gray-200 bg-white'
        }`}>
          <h4 className={`text-lg font-medium mb-4 ${
            theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
          }`}>
            Add Training Resource
          </h4>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className={`block text-sm font-medium mb-2 ${
                theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
              }`}>
                Resource Type
              </label>
              <select
                value={formData.resource_type}
                onChange={(e) => setFormData({ ...formData, resource_type: e.target.value })}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                  theme === 'gold'
                    ? 'border-yellow-400/30 bg-black/50 text-gray-200 focus:ring-yellow-400'
                    : 'border-gray-300 bg-white text-gray-900 focus:ring-blue-500'
                }`}
              >
                <option value="note">Note</option>
                <option value="url">URL</option>
                <option value="file">File</option>
              </select>
            </div>

            {formData.resource_type === 'note' && (
              <div>
                <label className={`block text-sm font-medium mb-2 ${
                  theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
                }`}>
                  Content
                </label>
                <textarea
                  rows={4}
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                    theme === 'gold'
                      ? 'border-yellow-400/30 bg-black/50 text-gray-200 placeholder-gray-500 focus:ring-yellow-400'
                      : 'border-gray-300 bg-white text-gray-900 focus:ring-blue-500'
                  }`}
                  placeholder="Enter training content..."
                  required
                />
              </div>
            )}

            {formData.resource_type === 'url' && (
              <div>
                <label className={`block text-sm font-medium mb-2 ${
                  theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
                }`}>
                  URL
                </label>
                <input
                  type="url"
                  value={formData.link_url}
                  onChange={(e) => setFormData({ ...formData, link_url: e.target.value })}
                  className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                    theme === 'gold'
                      ? 'border-yellow-400/30 bg-black/50 text-gray-200 placeholder-gray-500 focus:ring-yellow-400'
                      : 'border-gray-300 bg-white text-gray-900 focus:ring-blue-500'
                  }`}
                  placeholder="https://..."
                  required
                />
              </div>
            )}

            <div>
              <label className={`block text-sm font-medium mb-2 ${
                theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
              }`}>
                Tags
              </label>
              <input
                type="text"
                value={formData.tags}
                onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                  theme === 'gold'
                    ? 'border-yellow-400/30 bg-black/50 text-gray-200 placeholder-gray-500 focus:ring-yellow-400'
                    : 'border-gray-300 bg-white text-gray-900 focus:ring-blue-500'
                }`}
                placeholder="Enter tags separated by commas..."
              />
            </div>

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                  theme === 'gold'
                    ? 'text-gray-400 bg-gray-800 hover:bg-gray-700'
                    : 'text-gray-700 bg-gray-200 hover:bg-gray-300'
                }`}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className={`inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  theme === 'gold'
                    ? 'gold-gradient text-black hover-gold'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                } disabled:opacity-50`}
              >
                {saving ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2"></div>
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Save Resource
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Test Modal */}
      {showTestModal && (
        <div className={`fixed inset-0 z-50 overflow-y-auto ${
          theme === 'gold' ? 'bg-black/75' : 'bg-gray-900/50'
        }`}>
          <div className="flex items-center justify-center min-h-screen p-4">
            <div className={`w-full max-w-md rounded-xl shadow-2xl ${
              theme === 'gold' ? 'black-card gold-border' : 'bg-white border border-gray-200'
            }`}>
              <div className={`p-6 border-b ${
                theme === 'gold' ? 'border-yellow-400/20' : 'border-gray-200'
              }`}>
                <div className="flex items-center justify-between">
                  <h3 className={`text-lg font-semibold ${
                    theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
                  }`}>
                    Test AI Assistant
                  </h3>
                  <button
                    onClick={() => setShowTestModal(false)}
                    className={`p-2 rounded-lg transition-colors ${
                      theme === 'gold'
                        ? 'text-gray-400 hover:bg-gray-800'
                        : 'text-gray-500 hover:bg-gray-100'
                    }`}
                  >
                    ×
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <label className={`block text-sm font-medium mb-2 ${
                    theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                    Test Phone Number
                  </label>
                  <input
                    type="tel"
                    value={testPhone}
                    onChange={(e) => setTestPhone(e.target.value)}
                    className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                      theme === 'gold'
                        ? 'border-yellow-400/30 bg-black/50 text-gray-200 placeholder-gray-500 focus:ring-yellow-400'
                        : 'border-gray-300 bg-white text-gray-900 focus:ring-blue-500'
                    }`}
                    placeholder="+1234567890"
                    required
                  />
                  <p className={`text-xs mt-1 ${
                    theme === 'gold' ? 'text-gray-500' : 'text-gray-500'
                  }`}>
                    Enter your phone number to receive a test (required)
                  </p>
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${
                    theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                    Contact Name (Optional)
                  </label>
                  <input
                    type="text"
                    value={testName}
                    onChange={(e) => setTestName(e.target.value)}
                    className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                      theme === 'gold'
                        ? 'border-yellow-400/30 bg-black/50 text-gray-200 placeholder-gray-500 focus:ring-yellow-400'
                        : 'border-gray-300 bg-white text-gray-900 focus:ring-blue-500'
                    }`}
                    placeholder="John Doe"
                  />
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${
                    theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                    Company Name (Optional)
                  </label>
                  <input
                    type="text"
                    value={testCompany}
                    onChange={(e) => setTestCompany(e.target.value)}
                    className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                      theme === 'gold'
                        ? 'border-yellow-400/30 bg-black/50 text-gray-200 placeholder-gray-500 focus:ring-yellow-400'
                        : 'border-gray-300 bg-white text-gray-900 focus:ring-blue-500'
                    }`}
                    placeholder="Acme Corp"
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-2 ${
                    theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                    Test Type
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { key: 'call', label: 'Call', icon: Phone },
                      { key: 'sms', label: 'SMS', icon: MessageSquare },
                      { key: 'whatsapp', label: 'WhatsApp', icon: MessageSquare }
                    ].map((type) => {
                      const Icon = type.icon;
                      return (
                        <button
                          key={type.key}
                          onClick={() => setTestType(type.key as any)}
                          className={`p-3 rounded-lg border-2 transition-all ${
                            testType === type.key
                              ? theme === 'gold'
                                ? 'border-yellow-400 bg-yellow-400/10'
                                : 'border-blue-500 bg-blue-50'
                              : theme === 'gold'
                                ? 'border-gray-600 hover:border-gray-500'
                                : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <div className="flex flex-col items-center space-y-1">
                            <Icon className={`h-4 w-4 ${
                              testType === type.key
                                ? theme === 'gold' ? 'text-yellow-400' : 'text-blue-600'
                                : theme === 'gold' ? 'text-gray-400' : 'text-gray-500'
                            }`} />
                            <span className={`text-xs font-medium ${
                              testType === type.key
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

                <div className="flex space-x-3 pt-4">
                  <button
                    onClick={() => setShowTestModal(false)}
                    className={`flex-1 px-4 py-2 text-sm rounded-lg transition-colors ${
                      theme === 'gold'
                        ? 'text-gray-400 bg-gray-800 border border-gray-600 hover:bg-gray-700'
                        : 'text-gray-700 bg-gray-200 hover:bg-gray-300'
                    }`}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleTestCampaign}
                    disabled={testing || !testPhone.trim()}
                    className={`flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                      theme === 'gold'
                        ? 'gold-gradient text-black hover-gold'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {testing ? (
                      <div className="flex items-center justify-center">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2"></div>
                        Testing...
                      </div>
                    ) : (
                      <div className="flex items-center justify-center">
                        <Play className="h-4 w-4 mr-2" />
                        Start Test
                      </div>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}