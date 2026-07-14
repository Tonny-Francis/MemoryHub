import fs from 'node:fs';
import path from 'node:path';

import { simpleGit } from 'simple-git';

import { env } from '../Config/Env.Config.js';
import { logger } from '../Config/Logger.Config.js';

const hasRemote = (): boolean => Boolean(env.GIT_VAULT_REPO_URL);

function maskToken(url: string): string {
  return url.replace(/https:\/\/[^@]+@/, 'https://***@');
}

function git(cwd?: string) {
  return simpleGit(cwd ?? env.VAULT_DIR);
}

export async function initGit(): Promise<void> {
  const { VAULT_DIR, GIT_VAULT_REPO_URL, GIT_USER_NAME, GIT_USER_EMAIL } = env;

  if (hasRemote()) {
    if (fs.existsSync(path.join(VAULT_DIR, '.git'))) {
      logger.info('Vault repo found — pulling latest');
      await git().pull();
    } else {
      logger.info({ url: maskToken(GIT_VAULT_REPO_URL!) }, 'Cloning vault repo');
      fs.mkdirSync(path.dirname(VAULT_DIR), { recursive: true });
      await simpleGit().clone(GIT_VAULT_REPO_URL!, VAULT_DIR);
      await git().addConfig('user.name', GIT_USER_NAME);
      await git().addConfig('user.email', GIT_USER_EMAIL);
      logger.info('Vault repo cloned');
    }
  } else {
    fs.mkdirSync(VAULT_DIR, { recursive: true });
    if (!fs.existsSync(path.join(VAULT_DIR, '.git'))) {
      logger.info({ dir: VAULT_DIR }, 'Initializing local vault (no remote)');
      await simpleGit(VAULT_DIR).init();
      await git().addConfig('user.name', GIT_USER_NAME);
      await git().addConfig('user.email', GIT_USER_EMAIL);
    }

    // Ensure _global/ and projects/ exist
    for (const dir of ['_global', 'projects']) {
      fs.mkdirSync(path.join(VAULT_DIR, dir), { recursive: true });
    }
  }
}

export function schedulePull(): void {
  if (!hasRemote()) return;

  setInterval(async () => {
    try {
      await git().pull();
      logger.debug('Scheduled vault pull complete');
    } catch (err) {
      logger.error(err, 'Scheduled vault pull failed');
    }
  }, env.GIT_SYNC_INTERVAL_MS);
}

export async function commitAndPush(message: string): Promise<boolean> {
  const g = git();
  await g.add('.');
  const status = await g.status();
  if (status.isClean()) return false;
  await g.commit(message);
  if (hasRemote()) await g.push();
  return true;
}

export async function pull(): Promise<string> {
  if (!hasRemote()) return 'Local-only mode — no remote configured.';
  const result = await git().pull();
  const { changes, insertions, deletions } = result.summary;
  if (changes === 0) return 'Already up to date.';
  return `Updated: ${changes} file(s), +${insertions}/-${deletions} lines.`;
}
