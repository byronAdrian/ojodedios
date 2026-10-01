import { sharedHandlers } from '../server/api/handlers.js';

/** Vercel Function: GET /api/cameras — see server/api/handlers.js. */
export function GET(request) {
  return sharedHandlers().cameras(request);
}

export const HEAD = GET;
