import { sharedHandlers } from '../server/api/handlers.js';

/** Vercel Function: GET /api/frame — see server/api/handlers.js. */
export function GET(request) {
  return sharedHandlers().frame(request);
}

export const HEAD = GET;
