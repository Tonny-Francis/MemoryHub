import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { confirmDraft, getDraft, getProject, rejectDraft, updateDraft, type DecisionFile } from '../api/client';

function EditDraftModal({
  slug,
  filename,
  onClose,
  onSaved,
}: {
  slug: string;
  filename: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getDraft(slug, filename)
      .then((d) => setContent(d.content))
      .finally(() => setLoading(false));
  }, [slug, filename]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await updateDraft(slug, filename, content);
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: '100%', maxWidth: 720, maxHeight: '85vh', display: 'flex', flexDirection: 'column', padding: 24 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Edit Draft</span>
            <span className="tag" style={{ marginLeft: 8, fontFamily: 'monospace', fontSize: 11 }}>{filename}</span>
          </div>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: '2px 8px', fontSize: 12 }}>✕ Close</button>
        </div>

        {loading ? (
          <p style={{ color: 'var(--text-2)', fontSize: 13 }}>Loading…</p>
        ) : (
          <>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              style={{
                flex: 1,
                minHeight: 380,
                fontFamily: 'monospace',
                fontSize: 12,
                lineHeight: 1.6,
                background: 'var(--surface-2)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: 12,
                resize: 'vertical',
                outline: 'none',
              }}
            />
            {error && <p style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>{error}</p>}
            <div className="flex gap-2 justify-end mt-3">
              <button className="btn btn-ghost" onClick={onClose} style={{ fontSize: 12 }}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ fontSize: 12 }}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function DraftsPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState<DecisionFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [editingFilename, setEditingFilename] = useState<string | null>(null);

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
      {editingFilename && (
        <EditDraftModal
          slug={slug!}
          filename={editingFilename}
          onClose={() => setEditingFilename(null)}
          onSaved={() => setEditingFilename(null)}
        />
      )}

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
                    className="btn btn-ghost"
                    onClick={() => setEditingFilename(d.filename)}
                    disabled={working === d.filename}
                    style={{ fontSize: 12 }}
                  >
                    Edit
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
