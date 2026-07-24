import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { WhatsAppTransportHost } from '@hybridaione/hybridclaw/plugin-sdk';

const PHONE_JID_RE = /^(\d+)(?::\d+)?@(s\.whatsapp\.net|hosted)$/iu;
const LID_JID_RE = /^(\d+)(?::\d+)?@(lid|hosted\.lid)$/iu;
const GROUP_JID_RE = /^[0-9]+(?:-[0-9]+)*@g\.us$/iu;
const E164_RE = /^[1-9]\d{6,14}$/u;

class TestRateLimiter {
  private readonly windowMs: number;
  private readonly buckets = new Map<string, number[]>();
  private readonly notifyAt = new Map<string, number>();

  constructor(windowMs = 60_000) {
    this.windowMs = Math.max(1_000, Math.floor(windowMs));
  }

  check(key: string, limit: number, nowMs = Date.now()) {
    const cutoff = nowMs - this.windowMs;
    const active = (this.buckets.get(key) ?? []).filter(
      (timestamp) => timestamp > cutoff,
    );
    if (active.length >= limit) {
      this.buckets.set(key, active);
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(0, (active[0] ?? nowMs) + this.windowMs - nowMs),
      };
    }
    active.push(nowMs);
    this.buckets.set(key, active);
    return {
      allowed: true,
      remaining: Math.max(0, limit - active.length),
      retryAfterMs: 0,
    };
  }

  shouldNotify(key: string, cooldownMs = 10_000, nowMs = Date.now()) {
    const nextAllowedAt = this.notifyAt.get(key) ?? 0;
    if (nowMs < nextAllowedAt) return false;
    this.notifyAt.set(key, nowMs + cooldownMs);
    return true;
  }
}

const EXPECTED_TRANSPORT_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'EPIPE',
  'EAI_AGAIN',
  'ENETUNREACH',
  'ENOTFOUND',
  'ERR_SOCKET_CLOSED',
  'ESOCKETTIMEDOUT',
  'ETIMEOUT',
  'ETIMEDOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);
const EXPECTED_TRANSPORT_ERROR_RE =
  /\b(opening handshake has timed out|client network socket disconnected|connect econnrefused|connect etimedout|connection reset|connection terminated|econnaborted|econnrefused|econnreset|ehostunreach|enetunreach|enotfound|eai_again|err_socket_closed|esockettimedout|etimeout|etimedout|fetch failed|network error|opening handshake|read econnreset|socket hang up|socket timeout|und_err_body_timeout|und_err_connect_timeout|und_err_headers_timeout|und_err_socket|websocket (?:connection |client )?(?:closed|error|timed out))\b/iu;

interface ErrorLike {
  cause?: unknown;
  code?: unknown;
  data?: unknown;
  error?: unknown;
  errors?: unknown;
  hostname?: unknown;
  message?: unknown;
}

function nestedErrors(error: ErrorLike): unknown[] {
  return [
    ...(Array.isArray(error.errors) ? error.errors : []),
    error.cause,
    error.data,
    error.error,
  ].filter((value) => value != null);
}

function findTransportDetails(
  error: unknown,
  depth = 0,
): { code: string; host: string; message: string } {
  if (depth > 3 || error == null) return { code: '', host: '', message: '' };
  if (typeof error === 'string') {
    return { code: '', host: '', message: error };
  }
  if (typeof error !== 'object') {
    return { code: '', host: '', message: '' };
  }
  const candidate = error as ErrorLike;
  const details = {
    code:
      typeof candidate.code === 'string' ? candidate.code.toUpperCase() : '',
    host:
      typeof candidate.hostname === 'string' ? candidate.hostname.trim() : '',
    message: typeof candidate.message === 'string' ? candidate.message : '',
  };
  if (details.code || details.host) return details;
  for (const nested of nestedErrors(candidate)) {
    const nestedDetails = findTransportDetails(nested, depth + 1);
    if (nestedDetails.code || nestedDetails.host || nestedDetails.message) {
      return nestedDetails;
    }
  }
  return details;
}

function isExpectedTransportError(error: unknown, depth = 0): boolean {
  if (depth > 3 || error == null) return false;
  if (typeof error === 'string') {
    return EXPECTED_TRANSPORT_ERROR_RE.test(error);
  }
  if (typeof error !== 'object') return false;
  const candidate = error as ErrorLike;
  const code =
    typeof candidate.code === 'string' ? candidate.code.toUpperCase() : '';
  const message =
    typeof candidate.message === 'string' ? candidate.message : '';
  return (
    EXPECTED_TRANSPORT_ERROR_CODES.has(code) ||
    EXPECTED_TRANSPORT_ERROR_RE.test(message) ||
    nestedErrors(candidate).some((nested) =>
      isExpectedTransportError(nested, depth + 1),
    )
  );
}

function describeExpectedTransportError(
  error: unknown,
  subject: string,
  fallbackHost?: string | null,
): string {
  const details = findTransportDetails(error);
  const host = details.host || String(fallbackHost || '').trim();
  const endpoint = host ? `${subject} connection to ${host}` : subject;
  switch (details.code) {
    case 'ENOTFOUND':
      return host
        ? `${subject} DNS lookup failed for ${host}.`
        : `${subject} DNS lookup failed.`;
    case 'EAI_AGAIN':
      return host
        ? `${subject} DNS lookup for ${host} is temporarily unavailable.`
        : `${subject} DNS lookup is temporarily unavailable.`;
    case 'ECONNREFUSED':
      return `${endpoint} was refused.`;
    case 'ECONNRESET':
      return `${endpoint} was reset.`;
    case 'ETIMEDOUT':
    case 'ETIMEOUT':
    case 'ESOCKETTIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
    case 'UND_ERR_HEADERS_TIMEOUT':
    case 'UND_ERR_BODY_TIMEOUT':
      return `${endpoint} timed out.`;
    default:
      if (/\b(timed out|timeout)\b/iu.test(details.message)) {
        return `${endpoint} timed out.`;
      }
      return host
        ? `${subject} is temporarily unavailable at ${host}.`
        : `${subject} is temporarily unavailable.`;
  }
}

function normalizePhoneNumber(raw: string): string | null {
  const candidate = String(raw || '')
    .trim()
    .replace(/^whatsapp:/iu, '')
    .trim();
  if (!candidate || candidate.includes('@')) return null;
  const digits = candidate.replace(/[^\d+]/gu, '');
  const normalized = digits.startsWith('+') ? digits.slice(1) : digits;
  return E164_RE.test(normalized) ? `+${normalized}` : null;
}

function jidToPhone(jid: string): string | null {
  const match = String(jid || '')
    .trim()
    .match(PHONE_JID_RE);
  return match?.[1] && E164_RE.test(match[1]) ? `+${match[1]}` : null;
}

function canonicalizeUserJid(jid: string): string | null {
  const candidate = String(jid || '').trim();
  const phone = candidate.match(PHONE_JID_RE);
  if (phone?.[1]) return `${phone[1]}@s.whatsapp.net`;
  const lid = candidate.match(LID_JID_RE);
  return lid?.[1] ? `${lid[1]}@lid` : null;
}

function normalizeUserIdentity(jid: string): string | null {
  const candidate = String(jid || '').trim();
  const phone = candidate.match(PHONE_JID_RE);
  if (phone?.[1]) return `phone:${phone[1]}`;
  const lid = candidate.match(LID_JID_RE);
  return lid?.[1] ? `lid:${lid[1]}` : null;
}

const logger = {
  level: 'info',
  child() {
    return this;
  },
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
};

export function createWhatsAppTestHost(
  overrides: Partial<WhatsAppTransportHost> = {},
): WhatsAppTransportHost {
  const authDir = path.join(os.tmpdir(), 'hybridclaw-whatsapp-test-auth');
  const base: WhatsAppTransportHost = {
    appVersion: '0.28.4-test',
    defaultAgentId: 'main',
    logger,
    getConfig: () => ({
      dmPolicy: 'disabled',
      groupPolicy: 'disabled',
      allowFrom: [],
      groupAllowFrom: [],
      textChunkLimit: 4_000,
      debounceMs: 2_500,
      sendReadReceipts: false,
      ackReaction: '',
      mediaMaxMb: 20,
    }),
    auth: {
      authDir,
      acquireLock: async () => () => {},
      ensureAuthDir: async (dir = authDir) => {
        await fs.mkdir(dir, { recursive: true });
        return dir;
      },
    },
    pairing: {
      clear() {},
      setError() {},
      setQrText() {},
    },
    phone: {
      canonicalizeUserJid,
      isGroupJid: (jid) => GROUP_JID_RE.test(String(jid || '').trim()),
      jidToPhone,
      normalizePhoneNumber,
      normalizeUserIdentity,
    },
    media: {
      createContextItem: async ({
        attachmentName,
        buffer,
        mimeType,
        sizeBytes,
        originalUrl,
      }) => {
        const dir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'hybridclaw-uploaded-media-cache-'),
        );
        const filePath = path.join(dir, attachmentName);
        await fs.writeFile(filePath, buffer);
        const url = originalUrl || filePath;
        return {
          path: filePath,
          url,
          originalUrl: url,
          mimeType: mimeType || null,
          sizeBytes: sizeBytes ?? buffer.length,
          filename: attachmentName,
        };
      },
      normalizeMimeType: (value) => {
        const normalized = String(value || '')
          .split(';')[0]
          ?.trim()
          .toLowerCase();
        return normalized || null;
      },
      resolveManagedTempDir: ({ filePath }) => {
        const relative = path.relative(os.tmpdir(), path.resolve(filePath));
        const topLevel = relative.split(path.sep)[0];
        return topLevel?.startsWith('hybridclaw-wa-')
          ? path.join(os.tmpdir(), topLevel)
          : null;
      },
    },
    text: {
      chunkMessage: (text, { maxChars }) => {
        const chunks: string[] = [];
        for (let index = 0; index < text.length; index += maxChars) {
          chunks.push(text.slice(index, index + maxChars));
        }
        return chunks.length > 0 ? chunks : [''];
      },
      normalizeNativeAgentAddressingText: (text) => text,
    },
    buildSessionKey: (agentId, channelKind, chatType, peerId) =>
      [
        'agent',
        encodeURIComponent(agentId),
        'channel',
        encodeURIComponent(channelKind),
        'chat',
        encodeURIComponent(chatType),
        'peer',
        encodeURIComponent(peerId),
      ].join(':'),
    describeExpectedTransportError,
    isExpectedTransportError,
    SlidingWindowRateLimiter: TestRateLimiter,
    sleep: async () => {},
  };

  return {
    ...base,
    ...overrides,
  };
}
