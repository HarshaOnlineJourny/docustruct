import { useState, useEffect } from 'react';
import { NavLink, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import { ToastProvider } from './components/Toast.jsx';
import { ConfirmProvider } from './components/Confirm.jsx';
import { useAuth } from './AuthContext.jsx';
import {
  IconHome, IconLayers, IconSpark, IconEye, IconUpload, IconActivity, IconGrid, IconCpu, IconSettings, IconAlert,
} from './components/icons.jsx';
import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';
import GithubCallback from './pages/GithubCallback.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Templates from './pages/Templates.jsx';
import Training from './pages/Training.jsx';
import Review from './pages/Review.jsx';
import Import from './pages/Import.jsx';
import Status from './pages/Status.jsx';
import DataGrid from './pages/DataGrid.jsx';
import ReviewQueue from './pages/ReviewQueue.jsx';
import Settings from './pages/Settings.jsx';

const NAV = [
  { section: 'Overview', items: [
    { to: '/dashboard', label: 'Dashboard', icon: <IconHome /> },
  ]},
  { section: 'Setup', items: [
    { to: '/templates', label: 'Templates', icon: <IconLayers /> },
    { to: '/training',  label: 'Training',  icon: <IconSpark /> },
  ]},
  { section: 'Operate', items: [
    { to: '/review', label: 'Review',    icon: <IconEye /> },
    { to: '/import', label: 'Import',    icon: <IconUpload /> },
    { to: '/status', label: 'Status',    icon: <IconActivity /> },
    { to: '/data',   label: 'Data Grid', icon: <IconGrid /> },
    { to: '/review-queue', label: 'Review Queue', icon: <IconAlert /> },
  ]},
  { section: 'Account', items: [
    { to: '/settings', label: 'Settings', icon: <IconSettings /> },
  ]},
];

const TITLES = {
  '/dashboard': 'Dashboard',
  '/templates': 'Templates',
  '/training':  'Training',
  '/review':    'Review',
  '/import':    'Import',
  '/status':    'Status',
  '/data':      'Data Grid',
  '/review-queue': 'Review Queue',
  '/settings':  'Settings',
};

function Brand() {
  return (
    <div className="sidebar-brand">
      <BrandMark />
      <span className="sidebar-brand-text">DocuStruct</span>
    </div>
  );
}

function BrandMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="2" y="3" width="14" height="18" rx="2" stroke="#a5b4fc" strokeWidth="1.6" />
      <path d="M8 8h6M8 12h6M8 16h4" stroke="#a5b4fc" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M14 7l6 3v8a3 3 0 0 1-3 3" stroke="#4f46e5" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="20" cy="9" r="1.5" fill="#4f46e5" />
    </svg>
  );
}

function Sidebar() {
  return (
    <aside className="sidebar">
      <Brand />
      {NAV.map((group) => (
        <div key={group.section}>
          <div className="sidebar-section-label">{group.section}</div>
          <nav className="sidebar-nav">
            {group.items.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                className={({ isActive }) => 'sidebar-link' + (isActive ? ' active' : '')}
              >
                {it.icon}
                <span>{it.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      ))}
      <div className="sidebar-foot">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <IconCpu size={14} />
          <span>Local-first · v0.1</span>
        </div>
      </div>
    </aside>
  );
}

function Topbar() {
  const { pathname } = useLocation();
  const { user, organization, logout } = useAuth();
  const title = TITLES[pathname] || Object.entries(TITLES).find(([p]) => pathname.startsWith(p))?.[1] || 'DocuStruct';

  const handleLogout = () => {
    logout();
    window.location.href = '/';
  };

  return (
    <header className="topbar">
      <span className="topbar-title">{title}</span>
      <span className="topbar-spacer" />
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <div style={{ fontSize: '14px', textAlign: 'right' }}>
          <div style={{ color: '#64748b', fontSize: '12px' }}>{organization?.name}</div>
          <div style={{ color: '#0f172a', fontWeight: 500 }}>{user?.email}</div>
        </div>
        <button
          onClick={handleLogout}
          className="button button-text"
          style={{ padding: '4px 8px', fontSize: '14px' }}
        >
          Sign out
        </button>
      </div>
    </header>
  );
}

function ProtectedLayout() {
  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <Topbar />
        <div className="page">
          <Routes>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/templates" element={<Templates />} />
            <Route path="/training"  element={<Training />} />
            <Route path="/review"    element={<Review />} />
            <Route path="/import"    element={<Import />} />
            <Route path="/status"    element={<Status />} />
            <Route path="/data"      element={<DataGrid />} />
            <Route path="/review-queue" element={<ReviewQueue />} />
            <Route path="/settings"  element={<Settings />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

function AppRoutes() {
  const { isAuthenticated, isLoading } = useAuth();
  const { pathname } = useLocation();

  if (isLoading) {
    return null; // Loading
  }

  const isAuthPage = pathname === '/login' || pathname === '/signup';
  const isLandingPage = pathname === '/';

  // Redirect authenticated users away from auth pages
  if (isAuthenticated && isAuthPage) {
    return <Navigate to="/dashboard" replace />;
  }

  // Redirect unauthenticated users away from protected pages
  if (!isAuthenticated && !isAuthPage && !isLandingPage) {
    return <Navigate to="/" replace />;
  }

  return (
    <ToastProvider>
      <ConfirmProvider>
        {isAuthenticated ? (
          <ProtectedLayout />
        ) : (
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/auth/github/callback" element={<GithubCallback />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </ConfirmProvider>
    </ToastProvider>
  );
}

export default function App() {
  return <AppRoutes />;
}
