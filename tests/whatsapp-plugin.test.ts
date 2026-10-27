import fs from 'node:fs';
import path from 'node:path';
import type {
  ChannelTransportInstance,
  ChannelTransportRegistration,
  HybridClawPluginApi,
  RuntimeWhatsAppConfig,
} from '@hybridaione/hybridclaw/plugin-sdk';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { useTempDir } from './test-utils.js';
import { createWhatsAppTestHost } from './whatsapp-test-host.js';

const makeTempDir = useTempDir('hybridclaw-whatsapp-plugin-');

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete (globalThis as Record<symbol, unknown>)[
    Symbol.for('hybridclaw.whatsapp.pairingState')
  ];
});

async function registerPlugin(
  whatsapp: Partial<RuntimeWhatsAppConfig> = {},
): Promise<{ registration: ChannelTransportRegistration; authDir: string }> {
  const homeDir = makeTempDir();
  const registered: ChannelTransportRegistration[] = [];
  const plugin = (await import('../src/index.ts')).default;
  plugin.register({
    config: { whatsapp: { dmPolicy: 'pairing', ...whatsapp } },
    runtime: { homeDir },
    registerChannelTransport(transport) {
      registered.push(transport);
    },
  } as HybridClawPluginApi);
  expect(registered).toHaveLength(1);
  return {
    registration: registered[0] as ChannelTransportRegistration,
    authDir: path.join(homeDir, 'credentials', 'whatsapp'),
  };
}

function writeCreds(authDir: string, creds: unknown): void {
  fs.mkdirSync(authDir, { recursive: true });
  fs.writeFileSync(path.join(authDir, 'creds.json'), JSON.stringify(creds));
}

test('register and create stay lazy until the transport is used', async () => {
  const instance: ChannelTransportInstance = {
    init: vi.fn(async () => {}),
    shutdown: vi.fn(async () => {}),
    sendText: vi.fn(async () => ({ messageIds: ['chunk-1', 'chunk-2'] })),
    sendMedia: vi.fn(async () => ({ messageIds: ['media-1'] })),
  };
  const createWhatsAppTransport = vi.fn((_host: unknown) => instance);
  vi.doMock('../src/transport.ts', () => ({
    createWhatsAppTransport,
  }));

  const { registration, authDir } = await registerPlugin();
  expect(createWhatsAppTransport).not.toHaveBeenCalled();

  const transport = registration.create(createWhatsAppTestHost());
  expect(createWhatsAppTransport).not.toHaveBeenCalled();

  const handler = vi.fn(async () => {});
  await transport.init(handler);
  expect(createWhatsAppTransport).toHaveBeenCalledTimes(1);
  expect(createWhatsAppTransport.mock.calls[0]?.[0]).toMatchObject({
    auth: { authDir },
  });
  expect(instance.init).toHaveBeenCalledWith(handler);
  await expect(
    transport.sendText('15550100100@s.whatsapp.net', 'hello'),
  ).resolves.toEqual({ messageIds: ['chunk-1', 'chunk-2'] });
  await expect(
    transport.sendMedia({
      jid: '15550100100@s.whatsapp.net',
      filePath: '/tmp/image.png',
    }),
  ).resolves.toEqual({ messageIds: ['media-1'] });
});

describe('target matching', () => {
  test.each([
    ['15550100100@s.whatsapp.net', true],
    ['whatsapp:15550100100:3@s.whatsapp.net', true],
    ['123456789@lid', true],
    ['120363000000000000@g.us', true],
    ['line:u0123456789abcdef0123456789abcdef', false],
    ['pat@example.com', false],
    ['+15550100100', false],
  ])('matchesTarget(%s) is %s', async (target, expected) => {
    const { registration } = await registerPlugin();
    expect(registration.matchesTarget(target)).toBe(expected);
  });

  test.each([
    ['+1 (555) 010-0100', '15550100100@s.whatsapp.net'],
    ['whatsapp:+15550100100', '15550100100@s.whatsapp.net'],
    ['15550100100:7@s.whatsapp.net', '15550100100@s.whatsapp.net'],
    ['123456789@hosted.lid', '123456789@lid'],
    ['120363000000000000@g.us', '120363000000000000@g.us'],
    ['#general', null],
    ['pat@example.com', null],
    ['', null],
  ])('normalizeTarget(%s) is %s', async (target, expected) => {
    const { registration } = await registerPlugin();
    expect(registration.normalizeTarget(target)).toBe(expected);
  });
});

describe('credentials', () => {
  test('reports the linked account from the plugin-owned auth dir', async () => {
    const { registration, authDir } = await registerPlugin();
    await expect(registration.getAuthStatus()).resolves.toEqual({
      linked: false,
      jid: null,
    });

    writeCreds(authDir, { me: { id: '15550100100:2@s.whatsapp.net' } });
    await expect(registration.getAuthStatus()).resolves.toEqual({
      linked: true,
      jid: '15550100100:2@s.whatsapp.net',
    });
  });

  test('resetAuth clears the auth dir and releases its lock', async () => {
    const { registration, authDir } = await registerPlugin();
    writeCreds(authDir, { registered: true });

    await expect(registration.resetAuth()).resolves.toBe(authDir);
    expect(fs.readdirSync(authDir)).toEqual([]);
    expect(fs.existsSync(`${authDir}.lock`)).toBe(false);
    await expect(registration.getAuthStatus()).resolves.toMatchObject({
      linked: false,
    });
  });

  test('resetAuth refuses while another live process owns the lock', async () => {
    const { registration, authDir } = await registerPlugin();
    fs.mkdirSync(path.dirname(authDir), { recursive: true });
    fs.writeFileSync(
      `${authDir}.lock`,
      JSON.stringify({
        pid: process.ppid,
        startedAt: new Date().toISOString(),
      }),
    );

    await expect(registration.resetAuth()).rejects.toMatchObject({
      name: 'WhatsAppAuthLockError',
      lockPath: `${authDir}.lock`,
      ownerPid: process.ppid,
    });
  });

  test('resetAuth reclaims a lock left by a dead process', async () => {
    const { registration, authDir } = await registerPlugin();
    fs.mkdirSync(path.dirname(authDir), { recursive: true });
    fs.writeFileSync(
      `${authDir}.lock`,
      JSON.stringify({ pid: 2 ** 22 + 1, startedAt: new Date().toISOString() }),
    );

    await expect(registration.resetAuth()).resolves.toBe(authDir);
  });
});

test('pairing state set by the transport host is what core reads', async () => {
  const createWhatsAppTransport = vi.fn((host) => {
    host.pairing.setQrText('qr-text');
    return {} as ChannelTransportInstance;
  });
  vi.doMock('../src/transport.ts', () => ({ createWhatsAppTransport }));
  const { registration } = await registerPlugin();
  expect(registration.getPairingState?.()).toMatchObject({
    pairingQrText: null,
    error: null,
  });

  await registration
    .create(createWhatsAppTestHost())
    .init(async () => {})
    .catch(() => undefined);

  expect(registration.getPairingState?.()).toMatchObject({
    pairingQrText: 'qr-text',
    error: null,
  });
});

describe('doctorChecks', () => {
  test.each([
    ['pairing', true, [{ severity: 'warn', message: 'WhatsApp not linked' }]],
    ['open', true, [{ severity: 'error', message: 'WhatsApp not linked' }]],
    ['open', false, []],
  ] as const)('unlinked with dmPolicy %s and enabled %s', async (dmPolicy, enabled, expected) => {
    const { registration } = await registerPlugin({ dmPolicy });
    await expect(registration.doctorChecks?.({ enabled })).resolves.toEqual(
      expected,
    );
  });

  test.each([
    ['15550100100@s.whatsapp.net', 'disabled', true],
    ['120363000000000000@g.us', 'disabled', false],
    ['15550100100@s.whatsapp.net', 'open', false],
    [null, 'disabled', false],
  ] as const)('linked with delivery target %s and dmPolicy %s warns about self-chat: %s', async (deliveryTarget, dmPolicy, warns) => {
    const { registration, authDir } = await registerPlugin({ dmPolicy });
    writeCreds(authDir, { registered: true });
    const findings = await registration.doctorChecks?.({
      enabled: true,
      deliveryTarget,
    });
    expect(findings?.[0]).toEqual({
      severity: 'ok',
      message: 'WhatsApp linked',
    });
    expect(findings?.some((finding) => finding.severity === 'warn')).toBe(
      warns,
    );
  });
});

test('describeSend names the linked account and flags self messages', async () => {
  const { registration } = await registerPlugin();
  const auth = { linked: true, jid: '15550100100:4@s.whatsapp.net' };

  expect(
    registration.describeSend?.({
      target: '15550100199@s.whatsapp.net',
      auth,
    }),
  ).toEqual({ sentFrom: '+15550100100', recipient: '+15550100199' });
  expect(
    registration.describeSend?.({
      target: '15550100100@s.whatsapp.net',
      auth,
    }),
  ).toMatchObject({ recipient: '+15550100100', note: expect.any(String) });
  expect(
    registration.describeSend?.({
      target: '120363000000000000@g.us',
      auth: { linked: false },
    }),
  ).toEqual({
    sentFrom: 'the linked WhatsApp account',
    recipient: '120363000000000000@g.us',
  });
});

test('messageToolHints are non-empty prompt lines', async () => {
  const { registration } = await registerPlugin();
  const hints = registration.messageToolHints?.({ channelId: null }) ?? [];
  expect(hints.length).toBeGreaterThan(0);
  for (const hint of hints) expect(hint).toMatch(/^- /);
});
