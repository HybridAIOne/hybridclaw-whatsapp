/**
 * WhatsApp addressing: user JIDs (`<digits>@s.whatsapp.net`, `@lid`,
 * `@hosted`, `@hosted.lid`), group JIDs (`@g.us`), E.164 phone numbers, and
 * the optional `whatsapp:` prefix. HybridClaw stores these JIDs as channel ids,
 * so `isWhatsAppJid` must keep claiming every id the pre-0.2 core matched.
 */
const WHATSAPP_PREFIX_RE = /^whatsapp:/i;
const USER_JID_RE =
  /^(\d+)(?::\d+)?@(s\.whatsapp\.net|lid|hosted|hosted\.lid)$/i;
const PHONE_USER_JID_RE = /^(\d+)(?::\d+)?@(s\.whatsapp\.net|hosted)$/i;
const LID_USER_JID_RE = /^(\d+)(?::\d+)?@(lid|hosted\.lid)$/i;
const GROUP_JID_RE = /^[0-9]+(?:-[0-9]+)*@g\.us$/i;
const E164_DIGITS_RE = /^[1-9]\d{6,14}$/;

function stripWhatsAppPrefix(value: string): string {
  return String(value || '')
    .trim()
    .replace(WHATSAPP_PREFIX_RE, '')
    .trim();
}

/** `+<digits>` or null; strips formatting but never guesses a country code. */
export function normalizePhoneNumber(raw: string): string | null {
  const candidate = stripWhatsAppPrefix(raw);
  if (!candidate || candidate.includes('@')) return null;
  const digits = candidate.replace(/[^\d+]/g, '');
  const normalized = digits.startsWith('+') ? digits.slice(1) : digits;
  return E164_DIGITS_RE.test(normalized) ? `+${normalized}` : null;
}

function phoneToJid(phone: string): string | null {
  const normalized = normalizePhoneNumber(phone);
  return normalized ? `${normalized.slice(1)}@s.whatsapp.net` : null;
}

export function jidToPhone(jid: string): string | null {
  const match = stripWhatsAppPrefix(jid).match(USER_JID_RE);
  if (!match?.[1] || !E164_DIGITS_RE.test(match[1])) return null;
  return `+${match[1]}`;
}

export function normalizeUserIdentity(jid: string): string | null {
  const candidate = stripWhatsAppPrefix(jid);
  const phone = candidate.match(PHONE_USER_JID_RE);
  if (phone) return `phone:${phone[1]}`;
  const lid = candidate.match(LID_USER_JID_RE);
  return lid ? `lid:${lid[1]}` : null;
}

export function canonicalizeUserJid(jid: string): string | null {
  const candidate = stripWhatsAppPrefix(jid);
  const phone = candidate.match(PHONE_USER_JID_RE);
  if (phone) return `${phone[1]}@s.whatsapp.net`;
  const lid = candidate.match(LID_USER_JID_RE);
  return lid ? `${lid[1]}@lid` : null;
}

export function isGroupJid(jid: string): boolean {
  return GROUP_JID_RE.test(stripWhatsAppPrefix(jid));
}

export function isWhatsAppJid(channelId: string): boolean {
  const candidate = stripWhatsAppPrefix(channelId);
  return USER_JID_RE.test(candidate) || GROUP_JID_RE.test(candidate);
}

/** A message-tool target (JID, `whatsapp:` prefix, or phone number) as a JID. */
export function normalizeWhatsAppTarget(rawTarget: string): string | null {
  const withoutPrefix = stripWhatsAppPrefix(rawTarget);
  if (!withoutPrefix) return null;
  const canonicalJid = canonicalizeUserJid(withoutPrefix);
  if (canonicalJid) return canonicalJid;
  if (isWhatsAppJid(withoutPrefix)) return withoutPrefix;
  if (/[a-z]/i.test(withoutPrefix)) return null;
  return phoneToJid(withoutPrefix);
}
