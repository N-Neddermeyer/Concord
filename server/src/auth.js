import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashPassword(password) {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = scryptSync(password, Buffer.from(salt, 'hex'), 64);
  return timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

export const newToken = () => randomBytes(32).toString('base64url');
