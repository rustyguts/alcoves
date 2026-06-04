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
					label: 'Features',
					items: [
						{ label: 'Authentication & sessions', slug: 'features/authentication-and-sessions' },
						{ label: 'Libraries, roles & access', slug: 'features/libraries-and-access-control' },
						{ label: 'Files, folders & uploads', slug: 'features/files-folders-and-uploads' },
						{ label: 'Faces & objects', slug: 'features/face-and-object-detection' },
						{ label: 'Audio & transcription', slug: 'features/audio-detection-and-transcription' },
						{ label: 'Video editor & moments', slug: 'features/video-editor-and-moments' },
						{ label: 'Sharing moments', slug: 'features/moment-sharing' },
						{ label: 'Search & activity', slug: 'features/search-activity-notifications' },
						{ label: 'MCP server', slug: 'features/mcp-server' },
						{ label: 'Admin & job queue', slug: 'features/admin-and-job-queue' },
					],
				},
				{
					label: 'Self-hosting',
					items: [{ label: 'Deploying Alcoves', slug: 'self-hosting/deploying-alcoves' }],
				},
				{
					label: 'Concepts',
					items: [{ label: 'Privacy & local AI', slug: 'concepts/privacy-and-local-ai' }],
				},
				{
					label: 'Architecture',
					items: [
						{ label: 'Overview', slug: 'architecture/overview' },
						{ label: 'Backend architecture', slug: 'architecture/backend-architecture-go' },
						{ label: 'Frontend architecture', slug: 'architecture/frontend-architecture' },
						{ label: 'Database & migrations', slug: 'architecture/database-schema-and-migrations' },
						{ label: 'Media processing pipeline', slug: 'architecture/media-processing-pipeline' },
						{ label: 'Storage backends', slug: 'architecture/storage-backends' },
						{ label: 'ML models & runtime', slug: 'architecture/ml-models-runtime' },
					],
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
