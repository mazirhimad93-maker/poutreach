import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Phone, MessageSquare, Play, TestTube, Crown, Zap, AlertCircle, CheckCircle } from 'lucide-react';

interface CampaignReviewProps {
  campaignId: string;
}

export function CampaignReview({ campaignId }: CampaignReviewProps) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [testPhone, setTestPhone] = useState('');
  const [testType, setTestType] = useState<'call' | 'sms'>('call');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

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
      const response = await fetch('https://mazirhx.app.n8n.cloud/webhook/test-campaign', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: user?.id,
          campaign_id: campaignId,
          test_phone: testPhone,
          test_type: testType,
          trigger_type: 'manual_test',
        }),
      });

      if (response.ok) {
        setTestResult({
          success: true,
          message: `Test ${testType} initiated successfully! You should receive a ${testType} shortly.`
        });
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

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <div className={`p-2 rounded-lg ${
          theme === 'gold' ? 'gold-gradient' : 'bg-blue-100'
        }`}>
          <TestTube className={`h-6 w-6 ${
            theme === 'gold' ? 'text-black' : 'text-blue-600'
          }`} />
        </div>
        <div>
          <h3 className={`text-lg font-semibold ${
            theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
          }`}>
            Campaign Review & Testing
          </h3>
          <p className={`text-sm ${
            theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
          }`}>
            Test your AI caller and messaging before launching your campaign
          </p>
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

      {/* Test Configuration */}
      <div className={`p-6 rounded-lg border ${
        theme === 'gold'
          ? 'border-yellow-400/20 bg-black/20'
          : 'border-gray-200 bg-gray-50'
      }`}>
        <h4 className={`text-md font-semibold mb-4 ${
          theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
        }`}>
          Test Your Campaign
        </h4>

        <div className="space-y-4">
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
            />
            <p className={`text-xs mt-1 ${
              theme === 'gold' ? 'text-gray-500' : 'text-gray-500'
            }`}>
              Enter your phone number to receive a test call or SMS
            </p>
          </div>

          <div>
            <label className={`block text-sm font-medium mb-2 ${
              theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
            }`}>
              Test Type
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setTestType('call')}
                className={`p-3 rounded-lg border-2 transition-all ${
                  testType === 'call'
                    ? theme === 'gold'
                      ? 'border-yellow-400 bg-yellow-400/10'
                      : 'border-blue-500 bg-blue-50'
                    : theme === 'gold'
                      ? 'border-gray-600 hover:border-gray-500'
                      : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <Phone className={`h-5 w-5 ${
                    testType === 'call'
                      ? theme === 'gold' ? 'text-yellow-400' : 'text-blue-600'
                      : theme === 'gold' ? 'text-gray-400' : 'text-gray-500'
                  }`} />
                  <span className={`font-medium ${
                    testType === 'call'
                      ? theme === 'gold' ? 'text-yellow-400' : 'text-blue-600'
                      : theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                    Test Call
                  </span>
                </div>
                <p className={`text-xs mt-1 ${
                  theme === 'gold' ? 'text-gray-500' : 'text-gray-500'
                }`}>
                  Receive an AI call
                </p>
              </button>

              <button
                onClick={() => setTestType('sms')}
                className={`p-3 rounded-lg border-2 transition-all ${
                  testType === 'sms'
                    ? theme === 'gold'
                      ? 'border-yellow-400 bg-yellow-400/10'
                      : 'border-blue-500 bg-blue-50'
                    : theme === 'gold'
                      ? 'border-gray-600 hover:border-gray-500'
                      : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <MessageSquare className={`h-5 w-5 ${
                    testType === 'sms'
                      ? theme === 'gold' ? 'text-yellow-400' : 'text-blue-600'
                      : theme === 'gold' ? 'text-gray-400' : 'text-gray-500'
                  }`} />
                  <span className={`font-medium ${
                    testType === 'sms'
                      ? theme === 'gold' ? 'text-yellow-400' : 'text-blue-600'
                      : theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                    Test SMS
                  </span>
                </div>
                <p className={`text-xs mt-1 ${
                  theme === 'gold' ? 'text-gray-500' : 'text-gray-500'
                }`}>
                  Receive a text message
                </p>
              </button>
            </div>
          </div>

          <button
            onClick={handleTestCampaign}
            disabled={testing || !testPhone.trim()}
            className={`w-full py-3 px-4 rounded-lg font-medium transition-all ${
              theme === 'gold'
                ? 'gold-gradient text-black hover-gold'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {testing ? (
              <div className="flex items-center justify-center">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2"></div>
                Initiating Test {testType}...
              </div>
            ) : (
              <div className="flex items-center justify-center">
                <Play className="h-4 w-4 mr-2" />
                Start Test {testType === 'call' ? 'Call' : 'SMS'}
              </div>
            )}
          </button>
        </div>
      </div>

      {/* Testing Guidelines */}
      <div className={`p-4 rounded-lg ${
        theme === 'gold'
          ? 'bg-yellow-400/10 border border-yellow-400/20'
          : 'bg-blue-50 border border-blue-200'
      }`}>
        <h4 className={`text-sm font-medium mb-2 ${
          theme === 'gold' ? 'text-yellow-400' : 'text-blue-700'
        }`}>
          Testing Guidelines
        </h4>
        <ul className={`text-sm space-y-1 ${
          theme === 'gold' ? 'text-gray-400' : 'text-blue-600'
        }`}>
          <li>• Test calls will use your AI training resources for context</li>
          <li>• SMS tests will send a sample message from your campaign</li>
          <li>• Make sure your phone can receive calls/texts from unknown numbers</li>
          <li>• Test results help you refine your AI training before going live</li>
        </ul>
      </div>
    </div>
  );
}