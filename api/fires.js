import { sharedHandlers } from '../server/api/handlers.js';

/** Vercel Function: GET /api/fires — see server/api/handlers.js. */
export function GET(request) {
  return sharedHandlers().fires(request);
}

export const HEAD = GET;
