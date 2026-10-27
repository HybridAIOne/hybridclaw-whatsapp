/**
 * The core transport host plus the plugin-owned credential store, pairing
 * prompt, and phone helpers the transport modules use. Core supplies only the
 * generic `ChannelTransportHost`; nothing WhatsApp-specific crosses back.
 */
import type {
  ChannelTransportHost,
  RuntimeWhatsAppConfig,
} from '@hybridaione/hybridclaw/plugin-sdk';
import type { WhatsAppAuthStore } from './auth.js';
import type { WhatsAppPairing } from './pairing-state.js';
import {
  canonicalizeUserJid,
  isGroupJid,
  jidToPhone,
  normalizePhoneNumber,
  normalizeUserIdentity,
} from './phone.js';

export interface WhatsAppTransportHost
  extends ChannelTransportHost<RuntimeWhatsAppConfig> {
  auth: Pick<WhatsAppAuthStore, 'authDir' | 'acquireLock' | 'ensureAuthDir'>;
  pairing: Pick<WhatsAppPairing, 'clear' | 'setError' | 'setQrText'>;
  phone: {
    canonicalizeUserJid(jid: string): string | null;
    isGroupJid(jid: string): boolean;
    jidToPhone(jid: string): string | null;
    normalizePhoneNumber(raw: string): string | null;
    normalizeUserIdentity(jid: string): string | null;
  };
}

export function createWhatsAppHost(
  host: ChannelTransportHost,
  store: WhatsAppAuthStore,
  pairing: WhatsAppPairing,
): WhatsAppTransportHost {
  return {
    ...(host as ChannelTransportHost<RuntimeWhatsAppConfig>),
    auth: {
      authDir: store.authDir,
      acquireLock: store.acquireLock,
      ensureAuthDir: store.ensureAuthDir,
    },
    pairing: {
      clear: () => pairing.clear(),
      setError: (error) => pairing.setError(error),
      setQrText: (qrText) => pairing.setQrText(qrText),
    },
    phone: {
      canonicalizeUserJid,
      isGroupJid,
      jidToPhone,
      normalizePhoneNumber,
      normalizeUserIdentity,
    },
  };
}
