import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getDecision, getProject, updateDecision, type DecisionFile, type ProjectDetail } from '../api/client';

function miniMd(raw: string): string {
  return raw
    .split('\n')
    .map((line) => {
      const inline = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      if (/^### /.test(line)) return `<p style="font-size:11px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.05em;margin:10px 0 2px">${inline(line.slice(4))}</p>`;
      if (/^## /.test(line))  return `<p style="font-size:12px;font-weight:700;color:var(--text);margin:10px 0 2px">${inline(line.slice(3))}</p>`;
      if (/^# /.test(line))   return `<p style="font-size:13px;font-weight:700;color:var(--text);margin:0 0 6px">${inline(line.slice(2))}</p>`;
      if (line.trim() === '') return '<div style="height:4px"></div>';
      return `<p style="font-size:12px;color:var(--text-2);margin:1px 0;line-height:1.5">${inline(line)}</p>`;
    })
    .join('');
}

function DecisionModal({ slug, filename, onClose }: { slug: string; filename: string; onClose: () => void }) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getDecision(slug, filename)
      .then((d) => setContent(d.content))
      .finally(() => setLoading(false));
  }, [slug, filename]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await updateDecision(slug, filename, content);
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,.7)', zIndex: 50 }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: '100%', maxWidth: 720, maxHeight: '85vh', display: 'flex', flexDirection: 'column', position: 'relative' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <span className="tag">{filename}</span>
          <div className="flex gap-2 items-center">
            {!loading && !editing && (
              <button className="btn btn-ghost" onClick={() => setEditing(true)} style={{ padding: '2px 8px', fontSize: 12 }}>
                Edit
              </button>
            )}
            <button className="btn btn-ghost" onClick={onClose} style={{ padding: '2px 8px', fontSize: 12 }}>
              ✕ Close
            </button>
          </div>
        </div>
        {loading ? (
          <p style={{ color: 'var(--text-2)' }}>Loading…</p>
        ) : editing ? (
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
              <button className="btn btn-ghost" onClick={() => setEditing(false)} style={{ fontSize: 12 }}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ fontSize: 12 }}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </>
        ) : (
          <div style={{ overflow: 'auto', flex: 1 }} dangerouslySetInnerHTML={{ __html: miniMd(content) }} />
        )}
      </div>
    </div>
  );
}

function DecisionRow({ d, slug }: { d: DecisionFile; slug: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div
        className="flex items-center gap-3 py-2.5 px-3 rounded cursor-pointer"
        style={{ borderBottom: '1px solid var(--border)' }}
        onClick={() => setOpen(true)}
        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--surface-2)')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
      >
        <span className="tag" style={{ flexShrink: 0 }}>{d.date}</span>
        <span style={{ fontSize: 13, color: 'var(--text)', flex: 1 }}>{d.title}</span>
        <span style={{ fontSize: 11, color: 'var(--accent)' }}>view →</span>
      </div>
      {open && <DecisionModal slug={slug} filename={d.filename} onClose={() => setOpen(false)} />}
    </>
  );
}

export function ProjectPage() {
  const { slug } = useParams<{ slug: string }>();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!slug) return;
    getProject(slug)
      .then(setProject)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) return <p style={{ color: 'var(--text-2)' }}>Loading…</p>;
  if (error || !project) return <p style={{ color: 'var(--red)' }}>{error || 'Not found'}</p>;

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link to="/" style={{ fontSize: 13, color: 'var(--text-2)' }}>Projects</Link>
            <span style={{ color: 'var(--border)' }}>/</span>
            <span style={{ fontSize: 13, color: 'var(--text)' }}>{project.name}</span>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>{project.name}</h1>
          <div className="flex items-center gap-2 mt-1">
            {project.stack && <span className="tag">{project.stack}</span>}
            {project.owner && <span className="badge badge-blue">{project.owner}</span>}
          </div>
        </div>
        {project.drafts.length > 0 && (
          <Link
            to={`/projects/${slug}/drafts`}
            className="btn"
            style={{ background: 'var(--orange-dim)', color: 'var(--orange)', border: '1px solid var(--orange)', flexShrink: 0 }}
          >
            {project.drafts.length} draft{project.drafts.length > 1 ? 's' : ''} pending
          </Link>
        )}
      </div>

      <div className="grid gap-6" style={{ gridTemplateColumns: '1fr 300px' }}>
        {/* Decisions list */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 style={{ fontSize: 15, fontWeight: 600 }}>
              Decisions
              <span style={{ fontWeight: 400, color: 'var(--text-2)', fontSize: 13, marginLeft: 6 }}>
                ({project.decisions.length})
              </span>
            </h2>
          </div>

          {project.decisions.length === 0 ? (
            <div className="card" style={{ padding: 24, textAlign: 'center' }}>
              <p style={{ color: 'var(--text-2)', fontSize: 13 }}>
                No decisions yet. Use the <span className="tag">log_decision</span> MCP tool to add one.
              </p>
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {project.decisions.map((d) => (
                <DecisionRow key={d.filename} d={d} slug={slug!} />
              ))}
            </div>
          )}
        </div>

        {/* Sidebar: overview */}
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Overview</h2>
          <div className="card">
            {project.overview
              ? <div dangerouslySetInnerHTML={{ __html: miniMd(project.overview) }} />
              : <p style={{ fontSize: 12, color: 'var(--text-2)' }}>No overview yet.</p>
            }
          </div>
        </div>
      </div>
    </div>
  );
}
