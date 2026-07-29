// Dakota Prints OS — single Express service: JSON API + built React client.
import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db, seed, UPLOAD_DIR } from './db.js';
import { login, requireAuth, currentUser, destroySession, setSessionCookie, COOKIE } from './auth.js';
import publicRoutes from './routes/public.js';
import osRoutes from './routes/os.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 5000;

seed();

const app = express();
app.disable('x-powered-by');
// Render terminates TLS at its edge — trust the proxy so req.protocol and the
// client IP recorded in webhook_log are the real ones.
app.set('trust proxy', 1);
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use((req, res, next) => {
  // The OS is also embedded in preview iframes on other origins; allow it.
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-webhook-token');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ------------------------------------------------------------------ auth API
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const result = login(email, password);
  if (!result) return res.status(401).json({ error: 'Wrong email or password' });
  setSessionCookie(res, result.token);
  res.json(result);
});
app.post('/api/auth/logout', (req, res) => {
  const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
  destroySession(bearer || req.cookies?.[COOKIE]);
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});
app.get('/api/auth/me', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ user });
});

app.use('/api/public', publicRoutes);
app.use('/api/os', requireAuth, osRoutes);
app.get('/api/health', (_req, res) => res.json({
  ok: true,
  service: 'dakota-prints-os',
  orders: db.prepare('SELECT COUNT(*) n FROM orders').get().n,
  uptime_s: Math.round(process.uptime()),
}));

// uploads (relative public paths are what the DB stores)
app.use('/uploads', express.static(path.resolve(UPLOAD_DIR), { maxAge: '7d' }));

// ------------------------------------------------------- built client (SPA)
const CLIENT_DIST = path.join(ROOT, 'client', 'dist');
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST, { index: false, maxAge: '1h' }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => res.send('Dakota Prints OS API is running. Run `npm run build` to serve the OS UI.'));
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(400).json({ error: err.message || 'Unexpected error' });
});

app.listen(PORT, '0.0.0.0', () => console.log(`Dakota Prints OS listening on :${PORT}`));
