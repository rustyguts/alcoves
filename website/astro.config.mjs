// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

const SITE = 'https://alcoves.io';
const REPO = 'https://github.com/rustyguts/alcoves';

// https://astro.build/config
export default defineConfig({
	site: SITE,
	// No `base` — served from the apex domain `alcoves.io` (custom CNAME).
	integrations: [
		starlight({
			title: 'Alcoves',
			description:
				'A self-hosted, privacy-first collaborative media library with AI that runs locally on your own hardware.',
			logo: {
				src: './src/assets/logo.webp',
				alt: 'Alcoves',
			},
			favicon: '/favicon.png',
			social: [{ icon: 'github', label: 'GitHub', href: REPO }],
			editLink: {
				baseUrl: `${REPO}/edit/main/website/`,
			},
			lastUpdated: true,
			// Default social-card / OG metadata for documentation pages.
			head: [
				{ tag: 'meta', attrs: { property: 'og:image', content: `${SITE}/og-image.png` } },
				{ tag: 'meta', attrs: { name: 'twitter:image', content: `${SITE}/og-image.png` } },
				{ tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
			],
			sidebar: [
				{
					label: 'Start here',
					items: [
						{ label: 'Overview', slug: 'overview' },
						{ label: 'Quickstart', slug: 'getting-started/quickstart' },
						{ label: 'Configuration', slug: 'getting-started/configuration' },
					],
				},
				{
					label: 'Concepts',
					items: [{ autogenerate: { directory: 'concepts' } }],
				},
				{
					label: 'Reference',
					items: [{ autogenerate: { directory: 'reference' } }],
				},
			],
			customCss: ['@fontsource-variable/ibm-plex-sans', './src/styles/global.css'],
		}),
		sitemap(),
	],
	vite: {
		plugins: [tailwindcss()],
	},
});
