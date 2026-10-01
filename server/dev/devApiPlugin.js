/**
 * Serves the same /api handlers as Vercel during `vite dev` / `vite preview`,
 * so local behaviour matches production. Also applies the headers declared in
 * vercel.json in preview, so CSP problems show up before deploying.
 */
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';

const ROUTES = { '/api/cameras': 'cameras', '/api/frame': 'frame', '/api/flights': 'flights', '/api/flight-trace': 'flightTrace', '/api/quakes': 'quakes', '/api/fires': 'fires', '/api/health': 'health' };

function toRequest(req) {
  const url = `http://${req.headers.host || 'localhost'}${req.url}`;
  return new Request(url, { method: req.method, headers: req.headers });
}

async function send(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (!response.body) return res.end();
  Readable.fromWeb(response.body).pipe(res);
}

function vercelHeaders() {
  try {
    const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
    return (config.headers ?? []).filter((rule) => rule.source === '/(.*)').flatMap((rule) => rule.headers);
  } catch {
    return [];
  }
}

export function devApiPlugin() {
  let handlers;
  const middleware = (applyHeaders) => async (req, res, next) => {
    if (applyHeaders) for (const { key, value } of vercelHeaders()) res.setHeader(key, value);
    const path = (req.url || '').split('?')[0];
    const name = ROUTES[path];
    if (!name) {
      if (path.startsWith('/api/')) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        return res.end('{"error":"not_found"}');
      }
      return next();
    }
    try {
      handlers ??= (await import('../api/handlers.js')).createHandlers();
      await send(res, await handlers[name](toRequest(req)));
    } catch (error) {
      next(error);
    }
  };
  return {
    name: 'ojodedios-dev-api',
    // Block bodies on purpose: a returned function would be treated as a post hook.
    configureServer(server) {
      server.middlewares.use(middleware(false));
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware(true));
    },
  };
}
