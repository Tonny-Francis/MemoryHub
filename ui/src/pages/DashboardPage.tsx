import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { createProject, getMe, getProjects, type Project, type User } from '../api/client';

function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Project) => void }) {
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [stack, setStack] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const p = await createProject({ slug, name, description, stack, owner: '' });
      onCreated(p);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div className="card" style={{ width: 420, padding: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>New Project</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-2)' }}>Slug *</label>
            <input className="input" value={slug} onChange={e => setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'))} placeholder="my-project" required style={{ width: '100%', marginTop: 4 }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-2)' }}>Name *</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="My Project" required style={{ width: '100%', marginTop: 4 }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-2)' }}>Description</label>
            <input className="input" value={description} onChange={e => setDescription(e.target.value)} placeholder="Short description" style={{ width: '100%', marginTop: 4 }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-2)' }}>Stack</label>
            <input className="input" value={stack} onChange={e => setStack(e.target.value)} placeholder="Node.js, PostgreSQL, K8s" style={{ width: '100%', marginTop: 4 }} />
          </div>
          {error && <p style={{ color: 'var(--red)', fontSize: 12 }}>{error}</p>}
          <div className="flex gap-2 justify-end mt-2">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Creating…' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    Promise.all([getProjects(), getMe()])
      .then(([p, u]) => { setProjects(p); setUser(u); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const canCreate = user?.role === 'ADMIN' || user?.role === 'WRITER';

  if (loading) return <p style={{ color: 'var(--text-2)' }}>Loading…</p>;
  if (error) return <p style={{ color: 'var(--red)' }}>{error}</p>;

  return (
    <div>
      {showModal && (
        <NewProjectModal
          onClose={() => setShowModal(false)}
          onCreated={(p) => { setProjects((prev) => [...prev, p]); setShowModal(false); }}
        />
      )}

      <div className="flex items-center justify-between mb-6">
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Projects</h1>
        <div className="flex items-center gap-3">
          <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{projects.length} project(s)</span>
          {canCreate && (
            <button className="btn btn-primary" style={{ fontSize: 13 }} onClick={() => setShowModal(true)}>
              + New Project
            </button>
          )}
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="card text-center" style={{ padding: 40 }}>
          <p style={{ color: 'var(--text-2)', fontSize: 14, marginBottom: 16 }}>
            No projects yet.
          </p>
          {canCreate && (
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>Create your first project</button>
          )}
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
                {p.description && (
                  <p style={{ fontSize: 12, color: 'var(--text-2)' }}>{p.description}</p>
                )}
                {p.owner && (
                  <span className="badge badge-blue" style={{ fontSize: 10, marginTop: 6, display: 'inline-block' }}>{p.owner}</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
