import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getGraph, getProjects, type GraphEdge, type GraphNode, type Project } from '../api/client';

// ── Colors ────────────────────────────────────────────────────────────────────
const PALETTE = [
  '#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6',
  '#ec4899','#06b6d4','#84cc16','#f97316','#a78bfa',
];
function projectColor(slug: string, projects: string[]): string {
  return PALETTE[projects.indexOf(slug) % PALETTE.length] ?? '#94a3b8';
}

// ── Force simulation ──────────────────────────────────────────────────────────
interface SimNode extends GraphNode { x: number; y: number; vx: number; vy: number; }

function initPositions(nodes: GraphNode[], projects: string[], w: number, h: number): SimNode[] {
  const cx = w / 2, cy = h / 2;
  return nodes.map((n) => {
    const pi = projects.indexOf(n.project);
    const angle = (pi / Math.max(projects.length, 1)) * Math.PI * 2;
    const r = Math.min(w, h) * 0.28;
    return {
      ...n,
      x: cx + Math.cos(angle) * r + (Math.random() - 0.5) * 80,
      y: cy + Math.sin(angle) * r + (Math.random() - 0.5) * 80,
      vx: 0, vy: 0,
    };
  });
}

function runTick(nodes: SimNode[], edges: GraphEdge[], w: number, h: number, alpha: number): void {
  const cx = w / 2, cy = h / 2;
  const REPULSION = 2800, LINK_DIST = 180, GRAVITY = 0.04, DAMPING = 0.82;

  // Repulsion
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i].x - nodes[j].x || 0.1;
      const dy = nodes[i].y - nodes[j].y || 0.1;
      const d2 = dx * dx + dy * dy;
      const f = (REPULSION / d2) * alpha;
      const d = Math.sqrt(d2);
      nodes[i].vx += (dx / d) * f;
      nodes[i].vy += (dy / d) * f;
      nodes[j].vx -= (dx / d) * f;
      nodes[j].vy -= (dy / d) * f;
    }
  }

  // Attraction along edges
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  for (const e of edges) {
    const a = nodes[idx.get(e.source) ?? -1];
    const b = nodes[idx.get(e.target) ?? -1];
    if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const f = ((d - LINK_DIST) / d) * 0.06 * Math.min(e.weight, 6) * alpha;
    a.vx += dx * f; a.vy += dy * f;
    b.vx -= dx * f; b.vy -= dy * f;
  }

  // Gravity + integrate
  for (const n of nodes) {
    n.vx += (cx - n.x) * GRAVITY * alpha;
    n.vy += (cy - n.y) * GRAVITY * alpha;
    n.vx *= DAMPING; n.vy *= DAMPING;
    n.x += n.vx; n.y += n.vy;
    n.x = Math.max(40, Math.min(w - 40, n.x));
    n.y = Math.max(40, Math.min(h - 40, n.y));
  }
}

// ── Component ─────────────────────────────────────────────────────────────────
interface Tooltip { x: number; y: number; node: GraphNode; sharedKw?: string[] }
interface Pan { x: number; y: number; scale: number }

export function GraphPage() {
  const svgRef = useRef<SVGSVGElement>(null);
  const rafRef = useRef<number>(0);
  const navigate = useNavigate();

  const [projects, setProjects] = useState<Project[]>([]);
  const [filter, setFilter] = useState<string>('');
  const [simNodes, setSimNodes] = useState<SimNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const [pan, setPan] = useState<Pan>({ x: 0, y: 0, scale: 1 });
  const [loading, setLoading] = useState(true);
  const [settling, setSettling] = useState(false);
  const [error, setError] = useState('');

  const W = 960, H = 640;
  const projectSlugs = [...new Set(simNodes.map(n => n.project))];

  // ── Load data ──────────────────────────────────────────────────────────────
  useEffect(() => {
    getProjects().then(setProjects).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    setSimNodes([]);
    setEdges([]);
    getGraph(filter || undefined)
      .then(({ nodes, edges: e }) => {
        const slugs = [...new Set(nodes.map(n => n.project))];
        const initial = initPositions(nodes, slugs, W, H);
        setSimNodes(initial);
        setEdges(e);
        setLoading(false);
        setSettling(true);
      })
      .catch(err => { setError(String(err)); setLoading(false); });
  }, [filter]);

  // ── Force simulation ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!settling || simNodes.length === 0) return;
    let tick = 0;
    const MAX = 180;

    const step = () => {
      setSimNodes(prev => {
        const next = prev.map(n => ({ ...n }));
        const alpha = 1 - tick / MAX;
        runTick(next, edges, W, H, alpha);
        tick++;
        if (tick < MAX) rafRef.current = requestAnimationFrame(step);
        else setSettling(false);
        return next;
      });
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [settling, edges]);

  // ── Pan & zoom ─────────────────────────────────────────────────────────────
  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, px: 0, py: 0 });

  const onMouseDownBg = useCallback((e: React.MouseEvent) => {
    if ((e.target as SVGElement).closest('[data-node]')) return;
    dragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  }, [pan]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current) return;
    setPan(p => ({
      ...p,
      x: dragStart.current.px + (e.clientX - dragStart.current.x),
      y: dragStart.current.py + (e.clientY - dragStart.current.y),
    }));
  }, []);

  const onMouseUp = useCallback(() => { dragging.current = false; }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    setPan(p => ({ ...p, scale: Math.max(0.2, Math.min(3, p.scale * factor)) }));
  }, []);

  // ── Node hover ─────────────────────────────────────────────────────────────
  const onNodeEnter = (node: GraphNode, e: React.MouseEvent) => {
    const shared = edges
      .filter(ed => ed.source === node.id || ed.target === node.id)
      .flatMap(ed => ed.keywords);
    const uniq = [...new Set(shared)].slice(0, 8);
    setTooltip({ x: e.clientX + 14, y: e.clientY - 10, node, sharedKw: uniq });
  };
  const onNodeLeave = () => setTooltip(null);
  const onNodeClick = (node: GraphNode) => {
    navigate(`/projects/${node.project}`);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const nodeById = new Map(simNodes.map(n => [n.id, n]));
  const transform = `translate(${pan.x}px,${pan.y}px) scale(${pan.scale})`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Knowledge Graph</h1>
          <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '2px 0 0' }}>
            {simNodes.length} nós · {edges.length} conexões
            {settling && <span style={{ marginLeft: 8, opacity: 0.5 }}>· simulando…</span>}
          </p>
        </div>

        {/* Project filter */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            className={`badge ${!filter ? 'badge-blue' : ''}`}
            style={{ cursor: 'pointer', border: '1px solid var(--border)', padding: '3px 10px' }}
            onClick={() => setFilter('')}
          >All</button>
          {projects.map(p => (
            <button
              key={p.slug}
              className="badge"
              style={{
                cursor: 'pointer',
                border: `1px solid ${projectColor(p.slug, projects.map(x => x.slug))}`,
                color: projectColor(p.slug, projects.map(x => x.slug)),
                padding: '3px 10px',
                background: filter === p.slug ? projectColor(p.slug, projects.map(x => x.slug)) + '22' : 'transparent',
              }}
              onClick={() => setFilter(f => f === p.slug ? '' : p.slug)}
            >
              {p.name || p.slug}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-2)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg width="14" height="14"><circle cx="7" cy="7" r="6" fill="#3b82f6"/></svg>
          Decisão confirmada
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg width="14" height="14"><circle cx="7" cy="7" r="6" fill="none" stroke="#3b82f6" strokeWidth="2" strokeDasharray="3,2"/></svg>
          Draft pendente
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg width="24" height="4"><line x1="0" y1="2" x2="24" y2="2" stroke="#94a3b8" strokeWidth="1.5"/></svg>
          Conexão fraca
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg width="24" height="4"><line x1="0" y1="2" x2="24" y2="2" stroke="#94a3b8" strokeWidth="3"/></svg>
          Conexão forte
        </span>
        <span style={{ color: 'var(--text-2)' }}>Scroll = zoom · Drag = pan · Clique = abrir projeto</span>
      </div>

      {/* Canvas */}
      <div style={{
        position: 'relative',
        border: '1px solid var(--border)',
        borderRadius: 10,
        overflow: 'hidden',
        background: 'var(--surface)',
        height: H,
      }}>
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-2)', fontSize: 14 }}>
            Carregando grafo…
          </div>
        )}
        {error && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--red, #ef4444)', fontSize: 14 }}>
            {error}
          </div>
        )}
        {!loading && simNodes.length === 0 && !error && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-2)', fontSize: 14 }}>
            <span style={{ fontSize: 32 }}>🗺️</span>
            Nenhuma decisão encontrada. Confirme drafts ou crie decisões para vê-las aqui.
          </div>
        )}

        <svg
          ref={svgRef}
          width="100%" height="100%"
          viewBox={`0 0 ${W} ${H}`}
          style={{ cursor: dragging.current ? 'grabbing' : 'grab', display: 'block' }}
          onMouseDown={onMouseDownBg}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onWheel={onWheel}
        >
          <g style={{ transform, transformOrigin: '0 0' }}>
            {/* Edges */}
            {edges.map(e => {
              const a = nodeById.get(e.source), b = nodeById.get(e.target);
              if (!a || !b) return null;
              const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - 30;
              const opacity = Math.min(0.15 + e.weight * 0.07, 0.6);
              const strokeW = Math.min(1 + e.weight * 0.4, 4);
              return (
                <path
                  key={e.id}
                  d={`M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`}
                  fill="none"
                  stroke="var(--text-2)"
                  strokeWidth={strokeW}
                  strokeOpacity={opacity}
                />
              );
            })}

            {/* Nodes */}
            {simNodes.map(n => {
              const color = projectColor(n.project, projectSlugs);
              const R = n.type === 'decision' ? 22 : 18;
              return (
                <g
                  key={n.id}
                  data-node="1"
                  style={{ cursor: 'pointer' }}
                  transform={`translate(${n.x},${n.y})`}
                  onClick={() => onNodeClick(n)}
                  onMouseEnter={(e) => onNodeEnter(n, e)}
                  onMouseLeave={onNodeLeave}
                >
                  <circle
                    r={R}
                    fill={n.type === 'decision' ? color : 'var(--surface)'}
                    stroke={color}
                    strokeWidth={n.type === 'draft' ? 2 : 0}
                    strokeDasharray={n.type === 'draft' ? '4,3' : undefined}
                    opacity={0.9}
                  />
                  {n.type === 'decision' && (
                    <text
                      textAnchor="middle" dominantBaseline="central"
                      fill="white" fontSize={11} fontWeight={700}
                      style={{ pointerEvents: 'none', userSelect: 'none' }}
                    >
                      {n.project.slice(0, 2).toUpperCase()}
                    </text>
                  )}
                  {n.type === 'draft' && (
                    <text
                      textAnchor="middle" dominantBaseline="central"
                      fill={color} fontSize={10}
                      style={{ pointerEvents: 'none', userSelect: 'none' }}
                    >
                      {n.project.slice(0, 2).toUpperCase()}
                    </text>
                  )}
                  <text
                    y={R + 11}
                    textAnchor="middle"
                    fill="var(--text)"
                    fontSize={10}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {n.label.length > 22 ? n.label.slice(0, 20) + '…' : n.label}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {/* Tooltip */}
        {tooltip && (
          <div style={{
            position: 'fixed',
            left: tooltip.x,
            top: tooltip.y,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '10px 14px',
            boxShadow: '0 4px 16px rgba(0,0,0,.15)',
            zIndex: 100,
            maxWidth: 280,
            pointerEvents: 'none',
          }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{tooltip.node.label}</div>
            <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 6 }}>
              <span className="badge badge-blue" style={{ marginRight: 6 }}>{tooltip.node.project}</span>
              <span className={`badge ${tooltip.node.type === 'draft' ? 'badge-yellow' : 'badge-green'}`}>
                {tooltip.node.type === 'draft' ? 'draft' : 'confirmada'}
              </span>
              <span style={{ marginLeft: 8 }}>{tooltip.node.date}</span>
            </div>
            {tooltip.sharedKw && tooltip.sharedKw.length > 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-2)' }}>
                <span style={{ fontWeight: 600 }}>Temas: </span>
                {tooltip.sharedKw.join(' · ')}
              </div>
            )}
          </div>
        )}

        {/* Zoom controls */}
        <div style={{ position: 'absolute', bottom: 12, right: 12, display: 'flex', gap: 4 }}>
          {[['＋', 1.2], ['−', 0.8], ['⌂', 1]] .map(([label, factor]) => (
            <button
              key={String(label)}
              className="btn btn-ghost"
              style={{ width: 32, height: 32, padding: 0, fontSize: 15, lineHeight: 1 }}
              onClick={() => setPan(p => ({
                x: factor === 1 ? 0 : p.x,
                y: factor === 1 ? 0 : p.y,
                scale: factor === 1 ? 1 : Math.max(0.2, Math.min(3, p.scale * (factor as number))),
              }))}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Project color legend */}
      {projectSlugs.length > 0 && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12 }}>
          {projectSlugs.map(slug => (
            <span key={slug} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: projectColor(slug, projectSlugs), display: 'inline-block' }} />
              {slug}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
