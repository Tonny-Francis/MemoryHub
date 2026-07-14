import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getProjects, type Project } from '../api/client';

export function DashboardPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    getProjects()
      .then(setProjects)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p style={{ color: 'var(--text-2)' }}>Loading…</p>;
  if (error) return <p style={{ color: 'var(--red)' }}>{error}</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Projects</h1>
        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{projects.length} project(s)</span>
      </div>

      {projects.length === 0 ? (
        <div className="card text-center" style={{ padding: 40 }}>
          <p style={{ color: 'var(--text-2)', fontSize: 14 }}>
            No projects yet. Ask an admin to create one, or use the{' '}
            <span className="tag">log_decision</span> MCP tool to get started.
          </p>
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
          {projects.map((p) => (
            <Link key={p.slug} to={`/projects/${p.slug}`} style={{ textDecoration: 'none' }}>
              <div
                className="card"
                style={{ transition: 'border-color .15s', cursor: 'pointer' }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)')}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.borderColor = 'var(--border)')}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{p.name}</h2>
                  <span className="tag" style={{ flexShrink: 0 }}>{p.slug}</span>
                </div>
                {p.stack && (
                  <p style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 6 }}>{p.stack}</p>
                )}
                {p.owner && (
                  <span className="badge badge-blue" style={{ fontSize: 10 }}>{p.owner}</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
