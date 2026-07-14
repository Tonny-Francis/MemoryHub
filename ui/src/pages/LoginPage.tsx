import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login } from '../api/client';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div style={{ width: '100%', maxWidth: 360 }}>
        <div className="text-center mb-8">
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)' }}>MemoryHub</h1>
          <p style={{ color: 'var(--text-2)', fontSize: 14, marginTop: 6 }}>
            Engineering knowledge base
          </p>
        </div>

        <div className="card">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label style={{ fontSize: 13, color: 'var(--text-2)' }}>Email</label>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label style={{ fontSize: 13, color: 'var(--text-2)' }}>Password</label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>

            {error && (
              <p style={{ fontSize: 13, color: 'var(--red)', background: 'rgba(224,85,85,.1)', padding: '8px 12px', borderRadius: 6 }}>
                {error}
              </p>
            )}

            <button className="btn btn-primary w-full justify-center" type="submit" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
