import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		// SvelteKit's built-in check rejects any form-encoded mutation whose Origin
		// header is absent or mismatched — including origin-LESS server-to-server
		// posts, which is exactly what an OAuth client's token exchange at
		// /api/oauth/token (application/x-www-form-urlencoded, no Origin) looks
		// like, so it would 403 the MCP OAuth flow through the in-process /api
		// proxy. The equivalent browser-CSRF protection lives in the proxy route
		// instead (src/routes/api/[...path]/+server.ts: reject form posts whose
		// Origin is present and cross-site — browsers always send Origin on
		// cross-site form submissions). Defense in depth: the Go session cookie is
		// SameSite=Lax, and the app has no SvelteKit form actions.
		//
		// checkOrigin:false is deprecated in favour of csrf.trustedOrigins, but
		// trustedOrigins cannot express "allow origin-less requests" (an absent
		// Origin is always rejected), which is the case we need — revisit if the
		// option grows that capability.
		csrf: { checkOrigin: false },
		// envPrefix so the Node server reads FRONTEND_HOST/FRONTEND_PORT/FRONTEND_ORIGIN/
		// FRONTEND_BODY_SIZE_LIMIT — avoids colliding with the Go API's PORT when both
		// run in the unified single-image `all` role.
		adapter: adapter({ envPrefix: 'FRONTEND_' })
	}
};

export default config;
