'use strict';
/* Single-role admin auth: one password (scrypt-hashed in settings), a signed
   HttpOnly cookie, and a small per-IP throttle on login. */
const crypto = require('crypto');
const { getSetting, setSetting } = require('./db');

const COOKIE = 'mv_admin';
const TTL_MS = 7 * 24 * 3600 * 1000;
const DEFAULT_PASSWORD = 'mavladi2026';

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 32);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [alg, saltHex, keyHex] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), 32);
  return crypto.timingSafeEqual(key, Buffer.from(keyHex, 'hex'));
}

function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  let s = getSetting('session_secret');
  if (!s) {
    s = crypto.randomBytes(32).toString('hex');
    setSetting('session_secret', s);
  }
  return s;
}

/* First boot: take ADMIN_PASSWORD from the environment, else the default
   (and the admin panel nags until it is changed). */
function ensureAdminPassword() {
  if (getSetting('admin_password_hash')) return;
  const pw = process.env.ADMIN_PASSWORD || DEFAULT_PASSWORD;
  setSetting('admin_password_hash', hashPassword(pw));
  setSetting('admin_password_is_default', process.env.ADMIN_PASSWORD ? '0' : '1');
  if (!process.env.ADMIN_PASSWORD) {
    console.warn(`\n  ⚠  Admin password set to the default "${DEFAULT_PASSWORD}". Change it in Admin → Settings.\n`);
  }
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}
function unsign(token) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const want = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(mac), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!p.exp || p.exp < Date.now()) return null;
    // a password change bumps the generation and signs everyone out
    if (String(p.gen) !== String(getSetting('session_gen') || '0')) return null;
    return p;
  } catch {
    return null;
  }
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function setSession(req, res) {
  const token = sign({ exp: Date.now() + TTL_MS, gen: getSetting('session_gen') || '0' });
  const secure = req.secure ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${TTL_MS / 1000}${secure}`
  );
}
function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}
function isAdmin(req) {
  return !!unsign(readCookie(req, COOKIE));
}

/* Mutations must come from our own fetch() calls: SameSite=Strict already
   blocks cross-site cookies, the custom header is belt and braces. */
function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Please sign in again.' });
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.get('X-Requested-With') !== 'fetch') {
    return res.status(403).json({ error: 'Bad request origin.' });
  }
  next();
}

/* ---------- throttle ---------- */
const attempts = new Map();
function throttle(key, limit, windowMs) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || rec.reset < now) {
    attempts.set(key, { n: 1, reset: now + windowMs });
    return true;
  }
  rec.n += 1;
  return rec.n <= limit;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of attempts) if (v.reset < now) attempts.delete(k);
}, 60_000).unref();

module.exports = {
  hashPassword, verifyPassword, ensureAdminPassword,
  setSession, clearSession, isAdmin, requireAdmin, throttle,
};
