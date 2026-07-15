import { env } from '../../Config/Env.Config.js';
import { hasProcessed, markProcessed, getLastSeen, setLastSeen } from '../State.js';
import type { IngestItem } from '../types.js';

const DECISION_LABELS = ['decision', 'adr', 'architecture'];
const DECISION_KEYWORDS = ['decision', 'adr', 'architecture', 'we decided', 'chosen'];

interface GitLabMR {
  iid: number;
  title: string;
  description: string | null;
  web_url: string;
  author: { name: string };
  created_at: string;
  labels: string[];
}

interface GitLabCommit {
  id: string;
  title: string;
  message: string;
  web_url: string;
  author_name: string;
  created_at: string;
}

function gitlabFetch<T>(path: string): Promise<T> {
  const url = `${env.GITLAB_URL}/api/v4${path}`;
  return fetch(url, {
    headers: {
      'PRIVATE-TOKEN': env.GITLAB_TOKEN ?? '',
      'Content-Type': 'application/json',
    },
  }).then(async (r) => {
    if (!r.ok) throw new Error(`GitLab API ${r.status}: ${path}`);
    return r.json() as Promise<T>;
  });
}

function projectSlugFromPath(projectPath: string): string {
  return projectPath.split('/').pop()?.toLowerCase().replace(/[^a-z0-9]+/g, '-') ?? projectPath;
}

async function pollMRs(projectId: string, projectPath: string): Promise<IngestItem[]> {
  const since = await getLastSeen('gitlab', `mr:${projectId}`);
  const params = new URLSearchParams({ per_page: '50', order_by: 'created_at', sort: 'desc' });
  if (since) params.set('created_after', since);

  const mrs = await gitlabFetch<GitLabMR[]>(`/projects/${encodeURIComponent(projectId)}/merge_requests?${params}`);
  if (!mrs.length) return [];

  await setLastSeen('gitlab', `mr:${projectId}`, mrs[0].created_at);

  return mrs
    .filter((mr) => {
      const text = `${mr.title} ${mr.description ?? ''}`.toLowerCase();
      const hasLabel = mr.labels.some((l) => DECISION_LABELS.includes(l.toLowerCase()));
      const hasKeyword = DECISION_KEYWORDS.some((kw) => text.includes(kw));
      return hasLabel || hasKeyword;
    })
    .map((mr): IngestItem => ({
      id: `gitlab:mr:${projectId}:${mr.iid}`,
      source: 'gitlab',
      projectSlug: projectSlugFromPath(projectPath),
      title: mr.title,
      body: mr.description ?? '',
      url: mr.web_url,
      author: mr.author.name,
      createdAt: mr.created_at,
    }));
}

async function pollCommits(projectId: string, projectPath: string): Promise<IngestItem[]> {
  const since = await getLastSeen('gitlab', `commit:${projectId}`);
  const params = new URLSearchParams({ per_page: '50' });
  if (since) params.set('since', since);

  const commits = await gitlabFetch<GitLabCommit[]>(`/projects/${encodeURIComponent(projectId)}/repository/commits?${params}`);
  if (!commits.length) return [];

  await setLastSeen('gitlab', `commit:${projectId}`, commits[0].created_at);

  return commits
    .filter((c) => DECISION_KEYWORDS.some((kw) => c.message.toLowerCase().includes(kw)))
    .map((c): IngestItem => ({
      id: `gitlab:commit:${projectId}:${c.id}`,
      source: 'gitlab',
      projectSlug: projectSlugFromPath(projectPath),
      title: c.title,
      body: c.message,
      url: c.web_url,
      author: c.author_name,
      createdAt: c.created_at,
    }));
}

interface GitLabProject {
  id: number;
  path_with_namespace: string;
}

async function resolveProjectIds(): Promise<{ id: string; path: string }[]> {
  const projects: { id: string; path: string }[] = [];

  if (env.GITLAB_PROJECT_IDS) {
    for (const pid of env.GITLAB_PROJECT_IDS.split(',').map((s) => s.trim()).filter(Boolean)) {
      projects.push({ id: pid, path: pid });
    }
  }

  if (env.GITLAB_GROUP_IDS) {
    for (const gid of env.GITLAB_GROUP_IDS.split(',').map((s) => s.trim()).filter(Boolean)) {
      try {
        const params = new URLSearchParams({ per_page: '100', include_subgroups: 'true' });
        const groupProjects = await gitlabFetch<GitLabProject[]>(`/groups/${encodeURIComponent(gid)}/projects?${params}`);
        for (const p of groupProjects) {
          if (!projects.some((existing) => existing.id === String(p.id))) {
            projects.push({ id: String(p.id), path: p.path_with_namespace });
          }
        }
      } catch (err) {
        console.warn(`[GitLab] Failed to list projects for group ${gid}:`, err);
      }
    }
  }

  return projects;
}

export async function pollGitLab(): Promise<IngestItem[]> {
  if (!env.GITLAB_TOKEN) return [];
  if (!env.GITLAB_PROJECT_IDS && !env.GITLAB_GROUP_IDS) return [];

  const projects = await resolveProjectIds();
  const results: IngestItem[] = [];

  for (const { id, path } of projects) {
    try {
      const [mrs, commits] = await Promise.all([pollMRs(id, path), pollCommits(id, path)]);
      results.push(...mrs, ...commits);
    } catch (err) {
      console.warn(`[GitLab] Failed to poll ${id}:`, err);
    }
  }

  return results;
}

export function handleGitLabWebhook(payload: unknown): IngestItem | null {
  const p = payload as Record<string, unknown>;
  const projectPath = (p['project'] as Record<string, string> | undefined)?.['path_with_namespace'] ?? 'unknown';
  const projectSlug = projectSlugFromPath(projectPath);

  if (p['object_kind'] === 'merge_request') {
    const attrs = p['object_attributes'] as Record<string, unknown>;
    const text = `${attrs['title']} ${attrs['description'] ?? ''}`.toLowerCase();
    if (!DECISION_KEYWORDS.some((kw) => text.includes(kw))) return null;
    return {
      id: `gitlab:mr:${projectPath}:${attrs['iid']}`,
      source: 'gitlab',
      projectSlug,
      title: String(attrs['title']),
      body: String(attrs['description'] ?? ''),
      url: String(attrs['url'] ?? ''),
      author: String((p['user'] as Record<string, string> | undefined)?.['name'] ?? 'unknown'),
      createdAt: String(attrs['created_at'] ?? new Date().toISOString()),
    };
  }

  if (p['object_kind'] === 'push') {
    const commits = (p['commits'] as Array<Record<string, unknown>>) ?? [];
    const match = commits.find((c) => DECISION_KEYWORDS.some((kw) => String(c['message']).toLowerCase().includes(kw)));
    if (!match) return null;
    return {
      id: `gitlab:commit:${projectPath}:${match['id']}`,
      source: 'gitlab',
      projectSlug,
      title: String(match['title'] ?? match['message']).split('\n')[0],
      body: String(match['message']),
      url: String(match['url'] ?? ''),
      author: String((match['author'] as Record<string, string> | undefined)?.['name'] ?? 'unknown'),
      createdAt: String(match['timestamp'] ?? new Date().toISOString()),
    };
  }

  return null;
}

// ── MR auto-comment with relevant vault decisions ─────────────────────────────

export async function commentMrWithContext(
  projectId: string,
  mrIid: number,
  relevantDecisions: Array<{ date: string; title: string; path: string }>,
): Promise<void> {
  const commentKey = `gitlab:mr-comment:${projectId}:${mrIid}`;
  if (await hasProcessed('gitlab', commentKey)) return;

  if (!relevantDecisions.length) return;

  const lines = [
    '🧠 **MemoryHub** — decisões relevantes para este MR:',
    '',
    ...relevantDecisions.map((d) => `- \`${d.date}\` **${d.title}**`),
    '',
    '_Fonte: [MemoryHub](/) — base de conhecimento da equipe_',
  ];

  await gitlabFetchPost(
    `/projects/${encodeURIComponent(projectId)}/merge_requests/${mrIid}/notes`,
    { body: lines.join('\n') },
  );

  await markProcessed('gitlab', commentKey);
}

async function gitlabFetchPost(path: string, body: unknown): Promise<void> {
  const url = `${env.GITLAB_URL}/api/v4${path}`;
  await fetch(url, {
    method: 'POST',
    headers: {
      'PRIVATE-TOKEN': env.GITLAB_TOKEN ?? '',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}
