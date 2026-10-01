import { sharedHandlers } from '../server/api/handlers.js';

/** Vercel Function: GET /api/flights — see server/api/handlers.js. */
export function GET(request) {
  return sharedHandlers().flights(request);
}

export const HEAD = GET;
