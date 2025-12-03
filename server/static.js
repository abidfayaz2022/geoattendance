// server/static.js
import express from 'express';
import path from 'node:path';

export function serveStaticAssets(app, { distDir, indexFile = 'index.html' }) {
  app.use(express.static(distDir));

  // SPA fallback
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distDir, indexFile));
  });
}
