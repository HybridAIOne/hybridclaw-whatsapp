import { useMultiFileAuthState } from '@whiskeysockets/baileys';
import type { WhatsAppTransportHost } from './host.js';

export async function loadWhatsAppAuthState(host: WhatsAppTransportHost) {
  const authDir = await host.auth.ensureAuthDir();
  return useMultiFileAuthState(authDir);
}
