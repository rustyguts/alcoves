export { createApi, type Api } from './client';
export { apiUrl } from './url';
export { ApiError, type ApiFetch, type ApiFetchOptions } from './fetch';

import { createApi } from './client';

/**
 * Browser API singleton bound to the global `fetch`. Use in components and rune
 * stores for client-side calls (same-origin → /api proxy, or PUBLIC_API_ORIGIN
 * direct). Do NOT use during SSR — server `load` must call `createApi(event.fetch)`
 * so the session cookie is forwarded by hooks.server.ts.
 */
export const api = createApi((input, init) => fetch(input, init));
