import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { confirmDraft, getProject, rejectDraft, type DecisionFile } from '../api/client';

export function DraftsPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState<DecisionFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    getProject(slug)
      .then((p) => setDrafts(p.drafts))
      .finally(() => setLoading(false));
  }, [slug]);

  const handleConfirm = async (filename: string) => {
    setWorking(filename);
    try {
      await confirmDraft(slug!, filename);
      setDrafts((prev) => prev.filter((d) => d.filename !== filename));
    } finally {
      setWorking(null);
    }
  };

  const handleReject = async (filename: string) => {
    if (!confirm(`Reject and delete draft "${filename}"?`)) return;
    setWorking(filename);
    try {
      await rejectDraft(slug!, filename);
      setDrafts((prev) => prev.filter((d) => d.filename !== filename));
    } finally {
      setWorking(null);
    }
  };

  if (loading) return <p style={{ color: 'var(--text-2)' }}>Loading…</p>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Link to="/" style={{ fontSize: 13, color: 'var(--text-2)' }}>Projects</Link>
        <span style={{ color: 'var(--border)' }}>/</span>
        <Link to={`/projects/${slug}`} style={{ fontSize: 13, color: 'var(--text-2)' }}>{slug}</Link>
        <span style={{ color: 'var(--border)' }}>/</span>
        <span style={{ fontSize: 13, color: 'var(--text)' }}>Drafts</span>
      </div>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>
        Pending Drafts
        <span style={{ fontWeight: 400, color: 'var(--text-2)', fontSize: 14, marginLeft: 8 }}>
          ({drafts.length})
        </span>
      </h1>

      {drafts.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ color: 'var(--text-2)', fontSize: 14 }}>All caught up — no pending drafts.</p>
          <button className="btn btn-ghost mt-4" onClick={() => navigate(`/projects/${slug}`)}>
            Back to project
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {drafts.map((d) => (
            <div key={d.filename} className="card">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="tag">{d.date}</span>
                    <span className="badge badge-orange">AI draft</span>
                  </div>
                  <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>
                    {d.title}
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4, fontFamily: 'monospace' }}>
                    {d.filename}
                  </p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    className="btn btn-ghost"
                    onClick={() => handleReject(d.filename)}
                    disabled={working === d.filename}
                    style={{ fontSize: 12 }}
                  >
                    Reject
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={() => handleConfirm(d.filename)}
                    disabled={working === d.filename}
                    style={{ fontSize: 12 }}
                  >
                    {working === d.filename ? 'Saving…' : '✓ Confirm'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
