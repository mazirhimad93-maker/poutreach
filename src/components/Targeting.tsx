import React from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { 
  Search, 
  Target, 
  Linkedin, 
  Users, 
  Briefcase, 
  TrendingUp, 
  Zap, 
  Crown, 
  Star,
  Calendar,
  ExternalLink,
  CheckCircle,
  Clock,
  Sparkles
} from 'lucide-react';

export function Targeting() {
  const { theme } = useTheme();

  const platforms = [
    {
      name: 'LinkedIn',
      icon: Linkedin,
      description: 'Find decision makers and professionals actively posting about their needs',
      features: ['Job postings analysis', 'Company growth signals', 'Hiring intent detection']
    },
    {
      name: 'Facebook Groups',
      icon: Users,
      description: 'Discover prospects in industry groups asking for solutions',
      features: ['Group member analysis', 'Post engagement tracking', 'Pain point identification']
    },
    {
      name: 'Indeed & Job Boards',
      icon: Briefcase,
      description: 'Target companies actively hiring for roles related to your services',
      features: ['Hiring pattern analysis', 'Company expansion signals', 'Budget availability indicators']
    },
    {
      name: 'Industry Forums',
      icon: TrendingUp,
      description: 'Monitor discussions and identify prospects with immediate needs',
      features: ['Real-time monitoring', 'Intent scoring', 'Conversation context analysis']
    }
  ];

  const features = [
    {
      title: 'Intent-Based Targeting',
      description: 'AI analyzes millions of data points to identify prospects showing buying intent',
      icon: Target
    },
    {
      title: 'Real-Time Monitoring',
      description: 'Get notified instantly when prospects express needs matching your services',
      icon: Clock
    },
    {
      title: 'Smart Scoring',
      description: 'Each prospect gets an intent score based on their digital behavior',
      icon: Star
    },
    {
      title: 'Automated Enrichment',
      description: 'Complete contact information and company data automatically added',
      icon: Sparkles
    }
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center">
        <div className="flex items-center justify-center space-x-3 mb-4">
          {theme === 'gold' ? (
            <Crown className="h-10 w-10 text-yellow-400" />
          ) : (
            <Search className="h-10 w-10 text-blue-600" />
          )}
          <h1 className={`text-4xl font-bold ${
            theme === 'gold' ? 'gold-text-gradient' : 'text-gray-900'
          }`}>
            {theme === 'gold' ? 'Elite New Leads' : 'Smart New Leads'}
          </h1>
        </div>
        <p className={`text-xl max-w-3xl mx-auto ${
          theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
        }`}>
          Revolutionary AI-powered lead discovery that finds prospects with immediate buying intent 
          across LinkedIn, Facebook, job boards, and industry platforms.
        </p>
      </div>

      {/* Coming Soon Badge */}
      <div className="flex justify-center">
        <div className={`inline-flex items-center px-6 py-3 rounded-full border-2 ${
          theme === 'gold'
            ? 'border-yellow-400/30 bg-yellow-400/10 text-yellow-400'
            : 'border-blue-200 bg-blue-50 text-blue-700'
        }`}>
          <Clock className="h-5 w-5 mr-2" />
          <span className="font-semibold">Coming Soon</span>
        </div>
      </div>

      {/* Main Features Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {features.map((feature, index) => {
          const Icon = feature.icon;
          return (
            <div
              key={index}
              className={`p-6 rounded-xl border transition-all duration-300 ${
                theme === 'gold'
                  ? 'black-card gold-border hover:gold-shadow'
                  : 'bg-white border-gray-200 hover:shadow-lg'
              }`}
            >
              <div className="flex items-start space-x-4">
                <div className={`p-3 rounded-lg ${
                  theme === 'gold' ? 'gold-gradient' : 'bg-blue-100'
                }`}>
                  <Icon className={`h-6 w-6 ${
                    theme === 'gold' ? 'text-black' : 'text-blue-600'
                  }`} />
                </div>
                <div>
                  <h3 className={`text-lg font-semibold mb-2 ${
                    theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
                  }`}>
                    {feature.title}
                  </h3>
                  <p className={`text-sm ${
                    theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                    {feature.description}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Platform Coverage */}
      <div className={`rounded-xl border p-8 ${
        theme === 'gold' 
          ? 'black-card gold-border' 
          : 'bg-white border-gray-200'
      }`}>
        <div className="text-center mb-8">
          <h2 className={`text-2xl font-bold mb-4 ${
            theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
          }`}>
            Multi-Platform Intelligence
          </h2>
          <p className={`text-lg ${
            theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
          }`}>
            Our AI monitors these platforms 24/7 to find prospects with immediate buying intent
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {platforms.map((platform, index) => {
            const Icon = platform.icon;
            return (
              <div
                key={index}
                className={`p-6 rounded-lg border ${
                  theme === 'gold'
                    ? 'border-yellow-400/20 bg-yellow-400/5'
                    : 'border-gray-200 bg-gray-50'
                }`}
              >
                <div className="flex items-center space-x-3 mb-4">
                  <Icon className={`h-8 w-8 ${
                    theme === 'gold' ? 'text-yellow-400' : 'text-blue-600'
                  }`} />
                  <h3 className={`text-lg font-semibold ${
                    theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
                  }`}>
                    {platform.name}
                  </h3>
                </div>
                <p className={`text-sm mb-4 ${
                  theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
                }`}>
                  {platform.description}
                </p>
                <ul className="space-y-2">
                  {platform.features.map((feature, featureIndex) => (
                    <li key={featureIndex} className={`flex items-center text-sm ${
                      theme === 'gold' ? 'text-gray-300' : 'text-gray-700'
                    }`}>
                      <CheckCircle className={`h-4 w-4 mr-2 ${
                        theme === 'gold' ? 'text-yellow-400' : 'text-green-500'
                      }`} />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      {/* How It Works */}
      <div className={`rounded-xl border p-8 ${
        theme === 'gold' 
          ? 'black-card gold-border' 
          : 'bg-white border-gray-200'
      }`}>
        <h2 className={`text-2xl font-bold text-center mb-8 ${
          theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
        }`}>
          How Elite New Leads Works
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="text-center">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${
              theme === 'gold' ? 'gold-gradient' : 'bg-blue-100'
            }`}>
              <span className={`text-2xl font-bold ${
                theme === 'gold' ? 'text-black' : 'text-blue-600'
              }`}>
                1
              </span>
            </div>
            <h3 className={`text-lg font-semibold mb-2 ${
              theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
            }`}>
              Define Your ICP
            </h3>
            <p className={`text-sm ${
              theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
            }`}>
              Tell our AI about your ideal customer profile and the problems you solve
            </p>
          </div>

          <div className="text-center">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${
              theme === 'gold' ? 'gold-gradient' : 'bg-blue-100'
            }`}>
              <span className={`text-2xl font-bold ${
                theme === 'gold' ? 'text-black' : 'text-blue-600'
              }`}>
                2
              </span>
            </div>
            <h3 className={`text-lg font-semibold mb-2 ${
              theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
            }`}>
              AI Monitors & Analyzes
            </h3>
            <p className={`text-sm ${
              theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
            }`}>
              Our AI scans millions of posts, job listings, and conversations for buying signals
            </p>
          </div>

          <div className="text-center">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${
              theme === 'gold' ? 'gold-gradient' : 'bg-blue-100'
            }`}>
              <span className={`text-2xl font-bold ${
                theme === 'gold' ? 'text-black' : 'text-blue-600'
              }`}>
                3
              </span>
            </div>
            <h3 className={`text-lg font-semibold mb-2 ${
              theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
            }`}>
              Hot Leads Delivered
            </h3>
            <p className={`text-sm ${
              theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
            }`}>
              Get qualified prospects with high intent scores delivered to your dashboard
            </p>
          </div>
        </div>
      </div>

      {/* Early Access CTA */}
      <div className={`rounded-xl border-2 border-dashed p-8 text-center ${
        theme === 'gold'
          ? 'border-yellow-400/30 bg-yellow-400/5'
          : 'border-blue-300 bg-blue-50'
      }`}>
        <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 ${
          theme === 'gold' ? 'gold-gradient' : 'bg-blue-100'
        }`}>
          {theme === 'gold' ? (
            <Crown className="h-10 w-10 text-black" />
          ) : (
            <Zap className="h-10 w-10 text-blue-600" />
          )}
        </div>
        
        <h2 className={`text-2xl font-bold mb-4 ${
          theme === 'gold' ? 'gold-text-gradient' : 'text-gray-900'
        }`}>
          {theme === 'gold' ? 'Join the Elite Early Access' : 'Get Early Access'}
        </h2>
        
        <p className={`text-lg mb-6 max-w-2xl mx-auto ${
          theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
        }`}>
          Be among the first to experience revolutionary AI-powered targeting. 
          Early access members get exclusive pricing and priority onboarding.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <a
            href="https://calendly.com/your-team/targeting-demo"
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center px-8 py-4 text-lg font-bold rounded-lg transition-all duration-200 shadow-lg ${
              theme === 'gold'
                ? 'gold-gradient text-black hover-gold'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            <Calendar className="h-5 w-5 mr-2" />
            Book Demo & Early Access
            <ExternalLink className="h-5 w-5 ml-2" />
          </a>
          
          <div className={`text-sm ${
            theme === 'gold' ? 'text-gray-400' : 'text-gray-600'
          }`}>
            Limited spots available
          </div>
        </div>

        <div className={`mt-6 p-4 rounded-lg ${
          theme === 'gold'
            ? 'bg-black/20 border border-yellow-400/20'
            : 'bg-white border border-blue-200'
        }`}>
          <p className={`text-sm font-medium ${
            theme === 'gold' ? 'text-yellow-400' : 'text-blue-700'
          }`}>
            🎯 Early Access Benefits: 50% off first 3 months + Priority support + Custom training
          </p>
        </div>
      </div>
    </div>
  );
}