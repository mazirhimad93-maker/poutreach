import React from 'react';
import { Navigate, Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import {
  LayoutDashboard,
  Target,
  Users,
  Calendar,
  Settings,
  LogOut,
  Menu,
  X,
  Crown,
  Search,
  Activity,
  Zap,
} from 'lucide-react';

const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/dashboard' },
  { icon: Target, label: 'Campaigns', path: '/campaigns' },
  { icon: Activity, label: 'Performance', path: '/leads' },
  { icon: Calendar, label: 'Inbox', path: '/booked' },
  { icon: Search, label: 'New Leads', path: '/targeting' },
  { icon: Settings, label: 'Settings', path: '/settings' },
];

const adminNavItems = [
  { icon: Settings, label: 'Admin Panel', path: '/admin' },
];

export function Layout() {
  const { user, signOut, isAdmin, loading } = useAuth();
  const { theme } = useTheme();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

  if (loading) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${
        theme === 'gold' 
          ? 'bg-gradient-to-br from-black via-gray-900 to-black' 
          : 'bg-gray-50'
      }`}>
        <div className="relative">
          <div className={`animate-spin rounded-full h-32 w-32 border-4 border-transparent ${
            theme === 'gold'
              ? 'border-t-yellow-400 border-r-yellow-500 border-b-yellow-600'
              : 'border-t-blue-600 border-r-blue-500 border-b-blue-400'
          }`}></div>
          {theme === 'gold' ? (
            <>
              <Activity className="h-6 w-6 text-yellow-400" />
              <h1 className="text-xl font-bold gold-text-gradient">Outreach Pro</h1>
            </>
          ) : (
            <>
              <Activity className="h-6 w-6 text-blue-600" />
              <h1 className="text-xl font-bold text-gray-900">Outreach Pro</h1>
            </>
          )}
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const allNavItems = [...navItems, ...(isAdmin ? adminNavItems : [])];

  return (
    <div className={`min-h-screen flex ${
      theme === 'gold' 
        ? 'bg-gradient-to-br from-black via-gray-900 to-black' 
        : 'bg-gray-50'
    }`}>
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className={`fixed inset-0 z-40 lg:hidden ${
            theme === 'gold' ? 'bg-black bg-opacity-75' : 'bg-gray-900 bg-opacity-50'
          }`}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-64 shadow-xl transform transition-transform duration-200 ease-in-out lg:translate-x-0 lg:static lg:inset-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } ${
          theme === 'gold' 
            ? 'black-card shadow-2xl' 
            : 'bg-white shadow-xl'
        }`}
      >
        <div className={`flex items-center justify-between h-16 px-6 border-b ${
          theme === 'gold' ? 'border-yellow-400/20' : 'border-gray-200'
        }`}>
          <div className="flex items-center space-x-2">
            {theme === 'gold' ? (
              <Activity className="h-6 w-6 text-yellow-400" />
            ) : (
              <Activity className="h-6 w-6 text-blue-600" />
            )}
          </div>
          <button
            className={`lg:hidden ${
              theme === 'gold' 
                ? 'text-yellow-400 hover:text-yellow-300' 
                : 'text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-2">
          {allNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center px-4 py-3 text-sm font-medium rounded-lg transition-all duration-200 ${
                  isActive
                    ? theme === 'gold'
                      ? 'gold-gradient text-black shadow-lg'
                      : 'bg-blue-50 text-blue-700 border-r-2 border-blue-700'
                    : theme === 'gold'
                      ? 'text-gray-300 hover:bg-yellow-400/10 hover:text-yellow-400 hover:border-yellow-400/30 border border-transparent'
                      : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                }`}
                onClick={() => setSidebarOpen(false)}
              >
                <Icon className="mr-3 h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className={`p-4 border-t ${
          theme === 'gold' ? 'border-yellow-400/20' : 'border-gray-200'
        }`}>
          <div className={`flex items-center mb-4 p-3 rounded-lg ${
            theme === 'gold' 
              ? 'bg-yellow-400/5 border border-yellow-400/20' 
              : 'bg-gray-50'
          }`}>
            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shadow-lg ${
              theme === 'gold' 
                ? 'gold-gradient text-black' 
                : 'bg-blue-600 text-white'
            }`}>
              {user.email?.charAt(0).toUpperCase()}
            </div>
            <div className="ml-3">
              <p className={`text-sm font-medium ${
                theme === 'gold' ? 'text-gray-200' : 'text-gray-900'
              }`}>
                {user.user_metadata?.full_name || user.email}
              </p>
              <div className="flex items-center">
                {isAdmin && theme === 'gold' && <Crown className="h-3 w-3 text-yellow-400 mr-1" />}
                <p className={`text-xs ${
                  theme === 'gold' 
                    ? isAdmin ? 'text-yellow-400' : 'text-gray-400'
                    : isAdmin ? 'text-blue-600' : 'text-gray-500'
                }`}>
                  {isAdmin 
                    ? theme === 'gold' ? 'Elite Admin' : 'Admin'
                    : theme === 'gold' ? 'Premium Member' : 'Member'
                  }
                </p>
              </div>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className={`flex items-center w-full px-4 py-2 text-sm rounded-lg transition-colors border border-transparent ${
              theme === 'gold'
                ? 'text-gray-300 hover:bg-red-500/10 hover:text-red-400 hover:border-red-400/30'
                : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
            }`}
          >
            <LogOut className="mr-3 h-4 w-4" />
            Sign Out
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col lg:ml-0">
        {/* Top bar */}
        <header className={`shadow-sm border-b lg:hidden ${
          theme === 'gold' 
            ? 'black-card shadow-lg border-yellow-400/20' 
            : 'bg-white border-gray-200'
        }`}>
          <div className="flex items-center justify-between h-16 px-4">
            <button
              className={theme === 'gold' 
                ? 'text-yellow-400 hover:text-yellow-300' 
                : 'text-gray-500 hover:text-gray-900'
              }
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="h-6 w-6" />
            </button>
            <div className="flex items-center space-x-2">
              {theme === 'gold' ? (
                <Activity className="h-6 w-6 text-yellow-400" />
              ) : (
                <Activity className="h-6 w-6 text-blue-600" />
              )}
            </div>
            <div className="w-6"></div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}