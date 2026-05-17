// Express entrypoint. Mounts the route modules, serves uploaded PDFs, and —
// in production — serves the built React client so a single Node process is
// all you need behind nginx.
import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UPLOADS_DIR, SAMPLES_DIR } from './db.js';

import authRouter from './routes/auth.js';
import templatesRouter from './routes/templates.js';
import trainingRouter from './routes/training.js';
import extractionRouter from './routes/extraction.js';
import importsRouter from './routes/imports.js';
import dataRouter from './routes/data.js';
import settingsRouter from './routes/settings.js';
import aiTemplatesRouter from './routes/aiTemplates.js';
import { authenticate } from './middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Behind nginx / a CDN, trust the X-Forwarded-* headers so req.ip is right
// and req.protocol reflects the original request.
app.set('trust proxy', true);

// In dev, the Vite dev server runs on a different port and proxies /api
// here, so we keep CORS open. In production, server + client are same-origin
// so CORS is unnecessary; leaving it permissive is harmless for closed beta.
app.use(cors());
// Log every request as it arrives so we can tell whether it's reaching the
// server at all (vs being eaten by Vite's proxy or a middleware silently).
app.use((req, _res, next) => {
  if (req.url.startsWith('/api/')) console.log(`[${new Date().toISOString().slice(11, 19)}] -> ${req.method} ${req.url}`);
  next();
});
app.use(express.json({ limit: '5mb' }));

// Static PDF access for the UI's "view source" links.
app.use('/files/uploads', express.static(UPLOADS_DIR));
app.use('/files/samples', express.static(SAMPLES_DIR));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'docustruct',
    env: NODE_ENV,
    time: new Date().toISOString(),
  });
});

// Auth routes (public)
app.use('/api/auth', authRouter);

// Protected routes (require authentication)
app.use('/api/templates', authenticate, templatesRouter);
app.use('/api/training', authenticate, trainingRouter);
app.use('/api/extraction', authenticate, extractionRouter);
app.use('/api/imports', authenticate, importsRouter);
app.use('/api/data', authenticate, dataRouter);
app.use('/api/settings', authenticate, settingsRouter);
app.use('/api/ai', authenticate, aiTemplatesRouter);

// Serve the built React client in production. The build lives at
// `<repo>/client/dist`. Falls back to index.html for client-side routing
// (so /dashboard, /templates, /login, /signup, / all resolve via React Router).
const clientDist = path.resolve(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist, { index: 'index.html' }));
  app.get(/^(?!\/api\/|\/files\/).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
  console.log(`Serving client build from ${clientDist}`);
} else if (NODE_ENV === 'production') {
  console.warn(
    `[!] No client build found at ${clientDist}. ` +
    `Run \`npm --prefix client run build\` before starting in production.`
  );
}

app.use((err, req, res, _next) => {
  console.error(`[${req.method} ${req.originalUrl}]`, err);
  const payload = { error: err.message || 'Server error' };
  if (NODE_ENV !== 'production' && err.stack) {
    payload.stack = err.stack.split('\n').slice(0, 6).join('\n');
  }
  res.status(err.status || 500).json(payload);
});

app.listen(PORT, () => {
  console.log(`DocuStruct listening on http://localhost:${PORT} (${NODE_ENV})`);
});
