import type {
  ChannelTransportInstance,
  ChannelTransportRegistration,
  HybridClawPluginApi,
} from '@hybridaione/hybridclaw/plugin-sdk';
import { afterEach, expect, test, vi } from 'vitest';
import { createWhatsAppTestHost } from './whatsapp-test-host.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

test('register and create stay lazy until the transport is used', async () => {
  const instance: ChannelTransportInstance = {
    init: vi.fn(async () => {}),
    shutdown: vi.fn(async () => {}),
    sendText: vi.fn(async () => ({ messageIds: ['chunk-1', 'chunk-2'] })),
    sendMedia: vi.fn(async () => ({ messageIds: ['media-1'] })),
  };
  const createWhatsAppTransport = vi.fn(() => instance);
  vi.doMock('../src/transport.ts', () => ({
    createWhatsAppTransport,
  }));

  const registered: ChannelTransportRegistration[] = [];
  const plugin = (await import('../src/index.ts')).default;
  plugin.register({
    registerChannelTransport(transport) {
      registered.push(transport);
    },
  } as HybridClawPluginApi);

  expect(registered).toHaveLength(1);
  expect(createWhatsAppTransport).not.toHaveBeenCalled();

  const transport = registered[0]?.create(createWhatsAppTestHost());
  expect(transport).toBeDefined();
  expect(createWhatsAppTransport).not.toHaveBeenCalled();

  const handler = vi.fn(async () => {});
  await transport?.init(handler);
  expect(createWhatsAppTransport).toHaveBeenCalledTimes(1);
  expect(instance.init).toHaveBeenCalledWith(handler);
  await expect(
    transport?.sendText('15550100100@s.whatsapp.net', 'hello'),
  ).resolves.toEqual({ messageIds: ['chunk-1', 'chunk-2'] });
  await expect(
    transport?.sendMedia({
      jid: '15550100100@s.whatsapp.net',
      filePath: '/tmp/image.png',
    }),
  ).resolves.toEqual({ messageIds: ['media-1'] });
});
