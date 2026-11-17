// Autenticação de usuários, política de senha forte e tokens de sessão (HMAC-SHA256 + scrypt).
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const COOKIE_NAME = 'jc_session';
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function getSecret() {
  return process.env.AUTH_SECRET || process.env.GEMINI_API_KEY || 'jc-dev-fallback-secret-change-in-prod';
}

export function validatePasswordStrength(password = '') {
  const s = String(password);
  const rules = [
    { key: 'length', ok: s.length >= 8, label: 'Mínimo de 8 caracteres' },
    { key: 'upper', ok: /[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]/.test(s), label: 'Pelo menos 1 letra maiúscula (A–Z)' },
    { key: 'lower', ok: /[a-záàâãéêíóôõúç]/.test(s), label: 'Pelo menos 1 letra minúscula (a–z)' },
    { key: 'digit', ok: /\d/.test(s), label: 'Pelo menos 1 número (0–9)' },
    { key: 'special', ok: /[^A-Za-z0-9ÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç\s]/.test(s), label: 'Pelo menos 1 caractere especial (!@#$%...)' },
  ];
  const failed = rules.filter((r) => !r.ok);
  return {
    valid: failed.length === 0,
    rules,
    message: failed.length ? `A senha não atende aos requisitos: ${failed.map((f) => f.label.toLowerCase()).join(', ')}.` : '',
  };
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return `${salt}:${Buffer.from(derived).toString('hex')}`;
}

export async function verifyPassword(password, storedHash = '') {
  const [salt, keyHex] = String(storedHash).split(':');
  if (!salt || !keyHex) return false;
  const derived = await scrypt(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export function signSessionToken(user) {
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
    email: user.email,
    exp: Date.now() + TOKEN_TTL_MS,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data?.sub || !data?.exp || Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader = '') {
  const out = {};
  for (const part of String(cookieHeader).split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function extractTokenFromReq(req) {
  const auth = req.headers?.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const cookies = parseCookies(req.headers?.cookie || '');
  return cookies[COOKIE_NAME] || null;
}

export function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
  const maxAge = Math.floor(TOKEN_TTL_MS / 1000);
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`,
  );
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}
