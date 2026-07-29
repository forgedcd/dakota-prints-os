// Session-cookie + bearer-token auth for the Dakota Prints OS admin surface.
// Cookies are used for normal browsers; the bearer token exists because some
// embedded/sandboxed iframe hosts block cookies entirely.
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from './db.js';

const SESSIONS = new Map(); // token -> { userId, createdAt }
const TTL_MS = 1000 * 60 * 60 * 24 * 14;
export const COOKIE = 'dp_session';

export function login(email, password) {
  const user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(String(email || '').trim());
  if (!user) return null;
  if (!bcrypt.compareSync(String(password || ''), user.password_hash)) return null;
  const token = crypto.randomBytes(24).toString('hex');
  SESSIONS.set(token, { userId: user.id, createdAt: Date.now() });
  return { token, user: publicUser(user) };
}

export function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}

export function destroySession(token) {
  if (token) SESSIONS.delete(token);
}

function tokenFrom(req) {
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) return h.slice(7);
  return req.cookies?.[COOKIE] || null;
}

export function currentUser(req) {
  const token = tokenFrom(req);
  if (!token) return null;
  const sess = SESSIONS.get(token);
  if (!sess) return null;
  if (Date.now() - sess.createdAt > TTL_MS) { SESSIONS.delete(token); return null; }
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(sess.userId);
  return u ? publicUser(u) : null;
}

export function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.user = user;
  next();
}

export function setSessionCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: TTL_MS,
    path: '/',
  });
}
