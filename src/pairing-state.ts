/**
 * In-memory WhatsApp pairing prompt for the admin console: the terminal QR
 * text and the last pairing error. It lives only as long as the process that
 * runs the link; a restart starts a fresh pairing.
 */
export type WhatsAppPairingState = {
  pairingQrText: string | null;
  updatedAt: string | null;
  error: string | null;
};

export function createWhatsAppPairingState() {
  const empty = (): WhatsAppPairingState => ({
    pairingQrText: null,
    updatedAt: null,
    error: null,
  });
  let current = empty();

  return {
    get: (): WhatsAppPairingState => ({ ...current }),
    clear() {
      current = empty();
    },
    setQrText(pairingQrText: string) {
      current = {
        pairingQrText,
        updatedAt: new Date().toISOString(),
        error: null,
      };
    },
    setError(error: string) {
      current = {
        pairingQrText: null,
        updatedAt: new Date().toISOString(),
        error,
      };
    },
  };
}

export type WhatsAppPairing = ReturnType<typeof createWhatsAppPairingState>;
