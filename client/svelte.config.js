import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		// envPrefix so the Node server reads FRONTEND_HOST/FRONTEND_PORT/FRONTEND_ORIGIN/
		// FRONTEND_BODY_SIZE_LIMIT — avoids colliding with the Go API's PORT when both
		// run in the unified single-image `all` role.
		adapter: adapter({ envPrefix: 'FRONTEND_' })
	}
};

export default config;
