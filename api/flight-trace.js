import { sharedHandlers } from '../server/api/handlers.js';

/** Vercel Function: GET /api/flight-trace — see server/api/handlers.js. */
export function GET(request) {
  return sharedHandlers().flightTrace(request);
}

export const HEAD = GET;
