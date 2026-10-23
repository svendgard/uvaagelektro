import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';

const N = 32768, R = 8, P = 1, KEYLEN = 64;
const MAXMEM = 128 * N * R * 2;

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM }, (e, k) => (e ? reject(e) : resolve(k))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  // Kjører alltid en hash, også når brukeren ikke finnes, så svartiden ikke avslører kontoer.
  const parts = stored?.split('$');
  if (!parts || parts.length !== 6 || parts[0] !== 'scrypt') {
    await scrypt(password, Buffer.alloc(16));
    return false;
  }
  const key = await scrypt(password, Buffer.from(parts[4], 'base64url'));
  const expected = Buffer.from(parts[5], 'base64url');
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Tilfeldig token til lenker og sesjoner. Bare SHA-256 av den lagres. */
export const newToken = () => randomBytes(32).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function passwordProblem(password: string, email: string): string | null {
  if (typeof password !== 'string' || password.length < 12) return 'Passordet må ha minst 12 tegn.';
  if (password.length > 200) return 'Passordet er for langt.';
  if (password.toLowerCase().includes(email.split('@')[0].toLowerCase())) return 'Passordet kan ikke inneholde e-postnavnet ditt.';
  if (/^(.)\1+$/.test(password)) return 'Velg et passord som ikke bare består av ett tegn.';
  return null;
}
