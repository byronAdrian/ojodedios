import { sharedHandlers } from '../server/api/handlers.js';

/** Vercel Function: GET /api/health — see server/api/handlers.js. */
export function GET(request) {
  return sharedHandlers().health(request);
}

export const HEAD = GET;
