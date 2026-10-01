import { sharedHandlers } from '../server/api/handlers.js';

/** Vercel Function: GET /api/quakes — see server/api/handlers.js. */
export function GET(request) {
  return sharedHandlers().quakes(request);
}

export const HEAD = GET;
