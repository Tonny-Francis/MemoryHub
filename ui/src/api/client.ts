const BASE = '/api';

function getToken(): string | null {
  return localStorage.getItem('mh_token');
}

function setTokens(access: string, refresh: string): void {
  localStorage.setItem('mh_token', access);
  localStorage.setItem('mh_refresh', refresh);
}

function clearTokens(): void {
  localStorage.removeItem('mh_token');
  localStorage.removeItem('mh_refresh');
}

async function refreshAccessToken(): Promise<string | null> {
  const refresh = localStorage.getItem('mh_refresh');
  if (!refresh) return null;
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refresh }),
    });
    if (!res.ok) { clearTokens(); return null; }
    const data = await res.json() as { accessToken: string };
    localStorage.setItem('mh_token', data.accessToken);
    return data.accessToken;
  } catch {
    clearTokens();
    return null;
  }
}

async function request<T>(path: string, options?: RequestInit, retry = true): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });

  if (res.status === 401 && retry) {
    const newToken = await refreshAccessToken();
    if (newToken) return request<T>(path, options, false);
    clearTokens();
    window.location.href = '/login';
    throw new Error('Session expired');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface User { id: string; email: string; name: string; role: string; }

export async function login(email: string, password: string): Promise<User> {
  const data = await request<{ accessToken: string; refreshToken: string; user: User }>(
    '/auth/login',
    { method: 'POST', body: JSON.stringify({ email, password }) },
    false
  );
  setTokens(data.accessToken, data.refreshToken);
  return data.user;
}

export async function logout(): Promise<void> {
  const refresh = localStorage.getItem('mh_refresh');
  await fetch(`${BASE}/auth/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: refresh }),
  }).catch(() => {});
  clearTokens();
}

export function isLoggedIn(): boolean {
  return Boolean(getToken() || localStorage.getItem('mh_refresh'));
}

export async function getMe(): Promise<User> {
  return request<User>('/auth/me');
}

// ── Projects ──────────────────────────────────────────────────────────────────

export interface Project {
  slug: string; name: string; stack?: string; owner?: string;
  description?: string; repoUrl?: string; overview?: string;
}

export interface DecisionFile { filename: string; date: string; title: string; path: string; }

export interface ProjectDetail extends Project {
  decisions: DecisionFile[];
  drafts: DecisionFile[];
}

export async function getProjects(): Promise<Project[]> {
  return request<Project[]>('/projects');
}

export async function getProject(slug: string): Promise<ProjectDetail> {
  return request<ProjectDetail>(`/projects/${slug}`);
}

export async function createProject(data: Omit<Project, 'overview'>): Promise<Project> {
  return request<Project>('/projects', { method: 'POST', body: JSON.stringify(data) });
}

export async function getDecision(slug: string, filename: string): Promise<{ content: string }> {
  return request<{ content: string }>(`/projects/${slug}/decisions/${filename}`);
}

export async function createDecision(slug: string, data: { topic: string; title: string; context: string; decision: string; alternatives: string; consequences: string }): Promise<{ path: string }> {
  return request<{ path: string }>(`/projects/${slug}/decisions`, { method: 'POST', body: JSON.stringify(data) });
}

export async function getDraft(slug: string, filename: string): Promise<{ content: string }> {
  return request<{ content: string }>(`/projects/${slug}/drafts/${filename}`);
}

export async function updateDraft(slug: string, filename: string, content: string): Promise<void> {
  await request(`/projects/${slug}/drafts/${filename}`, { method: 'PUT', body: JSON.stringify({ content }) });
}

export async function updateDecision(slug: string, filename: string, content: string): Promise<void> {
  await request(`/projects/${slug}/decisions/${filename}`, { method: 'PUT', body: JSON.stringify({ content }) });
}

export async function deleteDecision(slug: string, filename: string): Promise<void> {
  await request(`/projects/${slug}/decisions/${filename}`, { method: 'DELETE' });
}

export async function confirmDraft(slug: string, filename: string): Promise<void> {
  await request(`/projects/${slug}/drafts/${filename}/confirm`, { method: 'POST' });
}

export async function rejectDraft(slug: string, filename: string): Promise<void> {
  await request(`/projects/${slug}/drafts/${filename}`, { method: 'DELETE' });
}

// ── Search ────────────────────────────────────────────────────────────────────

export interface SearchMatch { file: string; lines: string[]; }
export interface SearchResult { path: string; projectSlug: string; content: string; similarity: number; }

export async function search(q: string, project?: string): Promise<SearchMatch[]> {
  const params = new URLSearchParams({ q });
  if (project) params.set('project', project);
  const res = await request<{ mode: string; results: SearchMatch[] | SearchResult[] }>(`/search?${params}`);
  if (res.mode === 'semantic') {
    return (res.results as SearchResult[]).map((r) => ({
      file: r.path,
      lines: [r.content.slice(0, 200)],
    }));
  }
  return res.results as SearchMatch[];
}

// ── Graph ─────────────────────────────────────────────────────────────────────

export interface GraphNode { id: string; label: string; project: string; date: string; path: string; type: 'decision' | 'draft'; }
export interface GraphEdge { id: string; source: string; target: string; weight: number; keywords: string[]; }
export interface GraphData { nodes: GraphNode[]; edges: GraphEdge[]; }

export async function getGraph(project?: string): Promise<GraphData> {
  const params = new URLSearchParams();
  if (project) params.set('project', project);
  return request<GraphData>(`/graph${params.size ? `?${params}` : ''}`);
}

// ── Admin ─────────────────────────────────────────────────────────────────────

export async function getUsers(): Promise<User[]> {
  return request<User[]>('/users');
}

export async function createUser(data: { email: string; password: string; name: string; role: string }): Promise<User> {
  return request<User>('/users', { method: 'POST', body: JSON.stringify(data) });
}
