import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { getMe, logout, type User } from '../api/client';

export function Layout() {
  const [user, setUser] = useState<User | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    getMe().then(setUser).catch(() => navigate('/login'));
  }, [navigate]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const navItems = [
    { to: '/', label: 'Projects' },
    { to: '/search', label: 'Search' },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <header style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link to="/" style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16 }}>
              MemoryHub
            </Link>
            <nav className="flex items-center gap-1">
              {navItems.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 6,
                    fontSize: 13,
                    color: location.pathname === item.to ? 'var(--text)' : 'var(--text-2)',
                    background: location.pathname === item.to ? 'var(--surface-2)' : 'transparent',
                  }}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {user && (
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                {user.name}
                <span className="badge badge-blue ml-2">{user.role}</span>
              </span>
            )}
            <button className="btn btn-ghost" onClick={handleLogout} style={{ fontSize: 12, padding: '4px 10px' }}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
