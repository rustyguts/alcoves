import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Page from './+page.svelte';
import type { ShareMetadata } from './+page.server';

const baseMeta: ShareMetadata = {
	token: 'tok',
	title: 'Sunset at the beach',
	description: 'A short clip from the trip',
	shareUrl: 'https://alcoves.io/s/tok',
	appUrl: 'https://alcoves.io/libraries/lib',
	videoUrl: '/api/share/tok/video',
	thumbnailUrl: '/api/share/tok/thumbnail',
	ready: true
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const renderPage = (meta: ShareMetadata) => render(Page, { props: { data: { meta } } as any });

describe('s/[token] +page.svelte', () => {
	it('renders the moment title, description, and a playable video when ready', async () => {
		const screen = renderPage(baseMeta);

		await expect
			.element(screen.getByRole('heading', { name: 'Sunset at the beach' }))
			.toBeVisible();
		await expect.element(screen.getByText('A short clip from the trip')).toBeVisible();

		const video = screen.container.querySelector('video');
		expect(video).not.toBeNull();
		expect(video?.getAttribute('src')).toBe('/api/share/tok/video');
		expect(video?.getAttribute('poster')).toBe('/api/share/tok/thumbnail');
		expect(video?.hasAttribute('controls')).toBe(true);
	});

	it('sets the document title and OG/Twitter meta tags from the share metadata', async () => {
		renderPage(baseMeta);

		expect(document.title).toBe('Sunset at the beach · Alcoves');
		const og = (prop: string) =>
			document.head.querySelector(`meta[property="${prop}"]`)?.getAttribute('content');
		const tw = (name: string) =>
			document.head.querySelector(`meta[name="${name}"]`)?.getAttribute('content');

		expect(og('og:title')).toBe('Sunset at the beach');
		expect(og('og:type')).toBe('video.other');
		expect(og('og:url')).toBe('https://alcoves.io/s/tok');
		expect(og('og:video')).toBe('/api/share/tok/video');
		expect(og('og:image')).toBe('/api/share/tok/thumbnail');
		expect(tw('twitter:card')).toBe('player');
		expect(tw('twitter:player')).toBe('https://alcoves.io/s/tok');
		expect(tw('twitter:image')).toBe('/api/share/tok/thumbnail');
	});

	it('shows the still-processing placeholder when the clip is not ready', async () => {
		const screen = renderPage({
			...baseMeta,
			videoUrl: undefined,
			thumbnailUrl: undefined,
			ready: false
		});

		await expect.element(screen.getByText('Still processing.')).toBeVisible();
		expect(screen.container.querySelector('video')).toBeNull();
	});

	it('links back to the source library on Alcoves', async () => {
		const screen = renderPage(baseMeta);
		const link = screen.container.querySelector('footer a');
		expect(link?.getAttribute('href')).toBe('https://alcoves.io/libraries/lib');
	});
});
