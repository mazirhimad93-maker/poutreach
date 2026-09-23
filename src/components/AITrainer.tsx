import React, { useState, useEffect } from 'react';
import { Plus, Save, FileText, Link, Trash2 } from 'lucide-react';
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
            Lead AI / Enrichment Notes
          </h3>
          <p className={`text-sm ${
            theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
          }`}>
            Optional notes for list research, qualification and personalization. Live outreach does not use these notes to generate messages; the Sequence Builder is the source of truth for every outbound copy/script.
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
      
      <div className={`p-4 rounded-lg border ${theme === 'gold' ? 'border-yellow-400/20 bg-yellow-400/5' : 'border-blue-200 bg-blue-50'}`}>
        <p className={`text-sm font-medium ${theme === 'gold' ? 'text-yellow-400' : 'text-blue-700'}`}>
          Deterministic sending is enabled
        </p>
        <p className={`mt-1 text-xs ${theme === 'gold' ? 'text-gray-400' : 'text-blue-600'}`}>
          AI can help prepare the lead list upstream, but n8n sends only the exact copy/script saved in Sequence Builder.
        </p>
      </div>

      {resources.length === 0 ? (
        <div className={`text-center py-8 border-2 border-dashed rounded-lg ${
          theme === 'gold'
            ? 'border-yellow-400/30 text-gray-400'
            : 'border-gray-300 text-gray-500'
        }`}>
          <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No enrichment notes added yet</p>
          <p className="text-sm mt-1">Add optional notes or links used when preparing and researching lead lists.</p>
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
            Add Enrichment Resource
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
                  placeholder="Enter research, qualification, ICP or personalization notes..."
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

    </div>
  );
}