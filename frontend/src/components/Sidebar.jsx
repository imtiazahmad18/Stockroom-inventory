import { useAuth } from '../AuthContext.jsx';

export default function Sidebar({ page, setPage, theme, toggleTheme }) {
  const { user, logout } = useAuth();
  const items = [
    { id: 'dashboard', label: 'Dashboard', icon: 'ti-layout-dashboard' },
    { id: 'products', label: 'Products', icon: 'ti-box' },
    { id: 'sales', label: 'Sales', icon: 'ti-cash-register' },
    { id: 'categories', label: 'Categories', icon: 'ti-tags' },
    { id: 'forecast', label: 'Forecast', icon: 'ti-chart-line' },
    { id: 'insights', label: 'AI Insights', icon: 'ti-sparkles' },
  ];

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark"><i className="ti ti-building-warehouse" aria-hidden="true" /></span>
        Stockroom
      </div>
      <nav className="nav-list">
        {items.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${page === item.id ? 'active' : ''}`}
            onClick={() => setPage(item.id)}
          >
            <i className={`ti ${item.icon}`} aria-hidden="true" />
            {item.label}
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <button className="theme-toggle" onClick={toggleTheme}>
          <i className={theme === 'dark' ? 'ti ti-sun' : 'ti ti-moon'} aria-hidden="true" />
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
        {user && (
          <div className="sidebar-user">
            <span className="sidebar-user-email" title={user.email}>{user.email}</span>
            <button className="logout-btn" onClick={logout}>
              <i className="ti ti-logout" aria-hidden="true" />
              Log out
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
