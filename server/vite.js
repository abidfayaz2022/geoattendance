// server/vite.js
// Optional: only needed if you want one Node process to also run Vite dev.
export async function attachViteDevMiddleware(app) {
  if (process.env.NODE_ENV !== 'development') return;

  const { createServer } = await import('vite');
  const vite = await createServer({
    root: './client',
    server: { middlewareMode: true },
  });

  app.use(vite.middlewares);
}
