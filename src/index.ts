/**
 * Registers WhatsApp on the full channel transport contract without loading
 * its socket dependencies until first use. Target matching, link status,
 * reset, pairing state, doctor findings, and prompt hints all answer from
 * plugin-owned modules, so core needs no WhatsApp code to ask them.
 *
 * Unlike the transport, this wrapper owns no connection state and preserves
 * send results unchanged across the lazy-loading boundary.
 */
import path from 'node:path';
import type {
  ChannelTransportAuthStatus,
  ChannelTransportDoctorFinding,
  ChannelTransportInstance,
  ChannelTransportSendDescription,
  HybridClawPluginDefinition,
  RuntimeWhatsAppConfig,
} from '@hybridaione/hybridclaw/plugin-sdk';
import { createWhatsAppAuthStore, type WhatsAppAuthStore } from './auth.js';
import { createWhatsAppHost, type WhatsAppTransportHost } from './host.js';
import {
  createWhatsAppPairingState,
  type WhatsAppPairing,
} from './pairing-state.js';
import {
  canonicalizeUserJid,
  isGroupJid,
  isWhatsAppJid,
  jidToPhone,
  normalizeWhatsAppTarget,
} from './phone.js';
import type { createWhatsAppTransport } from './transport.js';

type WhatsAppTransport = ReturnType<typeof createWhatsAppTransport>;

const SELF_CHAT_ADVISORY =
  'WhatsApp self-chat does not send push notifications; heartbeats, scheduled tasks, and delegation results delivered there can go unnoticed. For proactive notifications, pair a dedicated second number and use --allow-from <your-personal-number> to chat with it from your personal account.';

const MESSAGE_TOOL_HINTS = [
  '- Normal assistant replies go back to the current WhatsApp chat automatically; do not reuse its WhatsApp JID as a Discord target.',
  '- WhatsApp formatting uses `*bold*`, `_italic_`, `~strike~`, and triple-backtick code fences.',
  '- Keep each WhatsApp message chunk concise and under roughly 4,000 characters.',
  '- Avoid Discord-specific syntax like `<@userId>` or `<#channelId>` in WhatsApp replies.',
  '- For `message` sends from WhatsApp, always provide an explicit target when sending to another channel. Use Discord ids/#channel for Discord, a WhatsApp JID/phone number for WhatsApp, or an email address for email.',
];

// A plugin reload re-registers while core keeps the live transport, whose
// pairing prompt the console must still see, so the state is per process.
const PAIRING_STATE_KEY = Symbol.for('hybridclaw.whatsapp.pairingState');

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

async function doctorChecks(
  store: WhatsAppAuthStore,
  config: RuntimeWhatsAppConfig,
  enabled: boolean,
  deliveryTarget: string | null,
): Promise<ChannelTransportDoctorFinding[]> {
  if (!(await store.getStatus()).linked) {
    if (!enabled) return [];
    return [
      {
        severity: config.dmPolicy === 'pairing' ? 'warn' : 'error',
        message: 'WhatsApp not linked',
      },
    ];
  }
  const findings: ChannelTransportDoctorFinding[] = [
    { severity: 'ok', message: 'WhatsApp linked' },
  ];
  if (
    config.dmPolicy === 'disabled' &&
    deliveryTarget &&
    isWhatsAppJid(deliveryTarget) &&
    !isGroupJid(deliveryTarget)
  ) {
    findings.push({ severity: 'warn', message: SELF_CHAT_ADVISORY });
  }
  return findings;
}

function describeSend(
  target: string,
  auth: ChannelTransportAuthStatus,
): ChannelTransportSendDescription {
  const linkedJid =
    typeof auth.jid === 'string' ? canonicalizeUserJid(auth.jid) : null;
  const isSelfMessage =
    linkedJid != null && linkedJid === canonicalizeUserJid(target);
  return {
    sentFrom: linkedJid
      ? (jidToPhone(linkedJid) ?? linkedJid)
      : 'the linked WhatsApp account',
    recipient: jidToPhone(target) ?? target,
    ...(isSelfMessage
      ? {
          note: 'The recipient is the linked WhatsApp account itself. WhatsApp shows this as a message to yourself and does not send a push notification.',
        }
      : {}),
  };
}

const plugin: HybridClawPluginDefinition = {
  id: 'whatsapp',
  name: 'WhatsApp',
  version: '0.2.0',
  kind: 'channel',
  register(api) {
    const store = createWhatsAppAuthStore(
      path.join(api.runtime.homeDir, 'credentials', 'whatsapp'),
    );
    const globals = globalThis as { [PAIRING_STATE_KEY]?: WhatsAppPairing };
    globals[PAIRING_STATE_KEY] ??= createWhatsAppPairingState();
    const pairing = globals[PAIRING_STATE_KEY];
    api.registerChannelTransport({
      kind: 'whatsapp',
      create: (host) =>
        createLazyTransport(createWhatsAppHost(host, store, pairing)),
      matchesTarget: isWhatsAppJid,
      normalizeTarget: normalizeWhatsAppTarget,
      getAuthStatus: () => store.getStatus(),
      resetAuth: () => store.reset(),
      getPairingState: () => pairing.get(),
      doctorChecks: ({ enabled, deliveryTarget }) =>
        doctorChecks(
          store,
          api.config.whatsapp,
          enabled,
          deliveryTarget ?? null,
        ),
      messageToolHints: () => MESSAGE_TOOL_HINTS,
      describeSend: ({ target, auth }) => describeSend(target, auth),
    });
  },
};

export default plugin;
