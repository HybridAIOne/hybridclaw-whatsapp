/**
 * WhatsApp credential store: Baileys multi-file auth in
 * `<data dir>/credentials/whatsapp` plus a sibling `.lock` owned by one
 * HybridClaw process at a time. The path and lock format match the pre-0.2
 * core store, so an existing link keeps working after the move.
 *
 * NOT the Baileys session itself (`auth-state.ts` loads that); this module only
 * locks, reports, and resets the directory.
 */
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const AUTH_LOCK_TIMEOUT_MS = 2_000;
const AUTH_LOCK_CORRUPT_STALE_MS = 10_000;
const AUTH_LOCK_PROCESS_START_SKEW_MS = 1_000;
const AUTH_FILE_MODE = 0o600;

interface AuthLockMetadata {
  pid: number | null;
  startedAt: string;
  purpose: string;
}

export type WhatsAppAuthStatus = {
  linked: boolean;
  jid: string | null;
};

export class WhatsAppAuthLockError extends Error {
  readonly lockPath: string;
  readonly ownerPid: number | null;

  constructor(
    message: string,
    options: { lockPath: string; ownerPid?: number | null },
  ) {
    super(message);
    this.name = 'WhatsAppAuthLockError';
    this.lockPath = options.lockPath;
    this.ownerPid = options.ownerPid ?? null;
  }
}

function isProcessRunning(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException)?.code === 'EPERM';
  }
}

function readLockMetadata(lockPath: string): AuthLockMetadata | null {
  try {
    const parsed = JSON.parse(
      fsSync.readFileSync(lockPath, 'utf-8'),
    ) as Partial<AuthLockMetadata>;
    return {
      pid:
        typeof parsed.pid === 'number' && Number.isFinite(parsed.pid)
          ? Math.trunc(parsed.pid)
          : null,
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : '',
      purpose: typeof parsed.purpose === 'string' ? parsed.purpose : '',
    };
  } catch {
    return null;
  }
}

function isLockFromEarlierLifetimeOfThisPid(
  metadata: AuthLockMetadata,
): boolean {
  if (metadata.pid !== process.pid) return false;
  const startedAtMs = Date.parse(metadata.startedAt);
  if (!Number.isFinite(startedAtMs)) return false;
  const processStartedAtMs = Date.now() - process.uptime() * 1000;
  return startedAtMs < processStartedAtMs - AUTH_LOCK_PROCESS_START_SKEW_MS;
}

function removeLock(lockPath: string): boolean {
  try {
    fsSync.rmSync(lockPath, { force: true });
    return true;
  } catch {
    return false;
  }
}

function maybeClearInactiveLock(lockPath: string): boolean {
  const metadata = readLockMetadata(lockPath);
  if (metadata?.pid != null) {
    if (isLockFromEarlierLifetimeOfThisPid(metadata))
      return removeLock(lockPath);
    if (isProcessRunning(metadata.pid)) return false;
    return removeLock(lockPath);
  }
  try {
    const stat = fsSync.statSync(lockPath);
    if (Date.now() - stat.mtimeMs <= AUTH_LOCK_CORRUPT_STALE_MS) return false;
  } catch {
    return false;
  }
  return removeLock(lockPath);
}

function parseAuthStatus(raw: string): WhatsAppAuthStatus {
  const parsed = JSON.parse(raw) as {
    registered?: unknown;
    me?: { id?: unknown } | null;
  };
  const jid =
    typeof parsed?.me?.id === 'string' && parsed.me.id.trim()
      ? parsed.me.id.trim()
      : null;
  return { linked: jid != null || parsed?.registered === true, jid };
}

export function createWhatsAppAuthStore(authDir: string) {
  const lockPath = `${authDir}.lock`;

  const acquireLock = async (options?: {
    purpose?: string;
    timeoutMs?: number;
  }): Promise<() => void> => {
    const timeoutMs = Math.max(0, options?.timeoutMs ?? AUTH_LOCK_TIMEOUT_MS);
    const startedAt = Date.now();
    let backoffMs = 50;
    await fs.mkdir(path.dirname(lockPath), { recursive: true });

    while (true) {
      try {
        const fd = fsSync.openSync(lockPath, 'wx', AUTH_FILE_MODE);
        const metadata: AuthLockMetadata = {
          pid: process.pid,
          startedAt: new Date().toISOString(),
          purpose: String(options?.purpose || 'runtime').trim() || 'runtime',
        };
        fsSync.writeFileSync(fd, `${JSON.stringify(metadata, null, 2)}\n`);
        fsSync.closeSync(fd);
        return () => {
          removeLock(lockPath);
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw new WhatsAppAuthLockError(
            `Failed to acquire WhatsApp auth lock at ${lockPath}.`,
            { lockPath },
          );
        }
        if (maybeClearInactiveLock(lockPath)) continue;
        if (Date.now() - startedAt >= timeoutMs) break;
        await sleep(backoffMs);
        backoffMs = Math.min(backoffMs * 2, 250);
      }
    }

    const ownerPid = readLockMetadata(lockPath)?.pid ?? null;
    const ownerHint = ownerPid != null ? ` (owned by pid ${ownerPid})` : '';
    throw new WhatsAppAuthLockError(
      `WhatsApp auth state is already in use${ownerHint}. Stop the other HybridClaw process before linking or resetting WhatsApp.`,
      { lockPath, ownerPid },
    );
  };

  const ensureAuthDir = async (): Promise<string> => {
    await fs.mkdir(authDir, { recursive: true });
    return authDir;
  };

  return {
    authDir,
    lockPath,
    acquireLock,
    ensureAuthDir,
    async getStatus(): Promise<WhatsAppAuthStatus> {
      try {
        return parseAuthStatus(
          await fs.readFile(path.join(authDir, 'creds.json'), 'utf-8'),
        );
      } catch {
        return { linked: false, jid: null };
      }
    },
    async reset(): Promise<string> {
      const releaseLock = await acquireLock({ purpose: 'reset' });
      try {
        await fs.rm(authDir, { recursive: true, force: true });
        await fs.mkdir(authDir, { recursive: true });
        return authDir;
      } finally {
        releaseLock();
      }
    },
  };
}

export type WhatsAppAuthStore = ReturnType<typeof createWhatsAppAuthStore>;
