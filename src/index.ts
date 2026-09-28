/**
 * Registers WhatsApp without loading its socket dependencies until first use.
 * Unlike the transport, this wrapper owns no connection state and preserves
 * send results unchanged across the lazy-loading boundary.
 */
import type {
  ChannelTransportInstance,
  HybridClawPluginDefinition,
  WhatsAppTransportHost,
} from '@hybridaione/hybridclaw/plugin-sdk';
import type { createWhatsAppTransport } from './transport.js';

type WhatsAppTransport = ReturnType<typeof createWhatsAppTransport>;

function createLazyTransport(
  host: WhatsAppTransportHost,
): ChannelTransportInstance {
  let transportPromise: Promise<WhatsAppTransport> | null = null;
  const getTransport = (): Promise<WhatsAppTransport> => {
    transportPromise ??= import('./transport.js').then((module) =>
      module.createWhatsAppTransport(host),
    );
    return transportPromise;
  };

  return {
    async init(handler) {
      await (await getTransport()).init(handler);
    },
    async shutdown() {
      if (!transportPromise) return;
      await (await transportPromise).shutdown();
    },
    async sendText(chatId, text) {
      return (await getTransport()).sendText(chatId, text);
    },
    async sendMedia(params) {
      return (await getTransport()).sendMedia(params);
    },
    async createPairingSession() {
      const transport = await getTransport();
      if (!transport.createPairingSession) {
        throw new Error('WhatsApp transport does not support pairing.');
      }
      return transport.createPairingSession();
    },
  };
}

const plugin: HybridClawPluginDefinition = {
  id: 'whatsapp',
  name: 'WhatsApp',
  version: '0.1.1',
  kind: 'channel',
  register(api) {
    api.registerChannelTransport({
      kind: 'whatsapp',
      create: createLazyTransport,
    });
  },
};

export default plugin;
