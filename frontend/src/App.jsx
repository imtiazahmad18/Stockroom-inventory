import { useEffect, useState } from 'react';
import Sidebar from './components/Sidebar.jsx';
import Login from './components/Login.jsx';
import Signup from './components/Signup.jsx';
import PasswordReset from './components/PasswordReset.jsx';
import { useAuth } from './AuthContext.jsx';
import Dashboard from './components/Dashboard.jsx';
import ProductsPage from './components/ProductsPage.jsx';
import CategoriesPage from './components/CategoriesPage.jsx';
import SalesPage from './components/SalesPage.jsx';
import NotificationBell from './components/NotificationBell.jsx';
import ChatWidget from './components/ChatWidget.jsx';
import ForecastPage from './components/ForecastPage.jsx';
import AnalyticsPage from './components/AnalyticsPage.jsx';
import BillingPage from './components/BillingPage.jsx';

function getInitialTheme() {
  const saved = localStorage.getItem('stockroom-theme');
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export default function App() {
  const { user, loading, billing, billingLoading } = useAuth();
  const [authView, setAuthView] = useState('login');
  const [page, setPage] = useState('dashboard');
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('stockroom-theme', theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }

  if (loading || (user && billingLoading)) {
    return <div className="auth-screen"><p>Loading...</p></div>;
  }

  if (!user) {
    if (authView === 'reset') return <PasswordReset onBack={() => setAuthView('login')} />;
    return authView === 'login'
      ? <Login onSwitch={() => setAuthView('signup')} onForgot={() => setAuthView('reset')} />
      : <Signup onSwitch={() => setAuthView('login')} />;
  }

  if (!billing?.active) return <BillingPage />;

  return (
    <div className="app-shell">
      <Sidebar page={page} setPage={setPage} theme={theme} toggleTheme={toggleTheme} />
      <NotificationBell />
      <ChatWidget />
      
      <main className="main">
        {page === 'dashboard' && <Dashboard />}
        {page === 'products' && <ProductsPage />}
        {page === 'sales' && <SalesPage />}
        {page === 'categories' && <CategoriesPage />}
        {page === 'forecast' && <ForecastPage />}
        {page === 'insights' && <AnalyticsPage />}
      </main>
    </div>
  );
}
