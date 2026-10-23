import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Tofaktor med engangskoder fra autentiseringsapp (TOTP, RFC 6238: SHA-1, 6 siffer, 30 s).
 * Kompatibel med Microsoft Authenticator, Google Authenticator, 1Password m.fl.
 */

const STEP_S = 30;
const DIGITS = 6;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('Ugyldig base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(randomBytes(20));

export function totpAt(secretB32: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32Decode(secretB32)).update(counter).digest();
  const off = h[h.length - 1] & 0xf;
  const n = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(n % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Sjekker koden mot nåværende tidssteg ±1 (tåler 30 s klokkeforskjell).
 * Returnerer tidssteget som ble brukt, eller null. Steg <= lastUsedStep avvises (gjenbruk).
 */
export function verifyTotp(secretB32: string, code: string, nowMs: number, lastUsedStep: number | null): number | null {
  const c = String(code ?? '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const cur = Math.floor(nowMs / 1000 / STEP_S);
  for (const step of [cur - 1, cur, cur + 1]) {
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    const expected = Buffer.from(totpAt(secretB32, step));
    if (timingSafeEqual(expected, Buffer.from(c))) return step;
  }
  return null;
}

export const otpauthUri = (secretB32: string, account: string, issuer: string) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_S}`;

/** Reservekoder: 10 stk, format xxxx-xxxx, uten tvetydige tegn. */
export function newRecoveryCodes(n = 10): string[] {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: n }, () => {
    const b = randomBytes(8);
    const s = Array.from(b, (x) => alphabet[x % alphabet.length]).join('');
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}
export const normalizeRecovery = (s: string) => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Kryptering av hemmeligheten i databasen (AES-256-GCM). Nøkkelen ligger i MFA_ENCRYPTION_KEY
 * (32 byte, base64) i Render, ikke i databasen.
 */
export function encryptSecret(plain: string, keyB64: string): string {
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) throw new Error('MFA_ENCRYPTION_KEY må være 32 byte (base64)');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${enc.toString('base64url')}`;
}

export function decryptSecret(stored: string, keyB64: string): string {
  const [v, iv, tag, data] = stored.split('.');
  if (v !== 'v1') throw new Error('Ukjent format');
  const d = createDecipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
}
