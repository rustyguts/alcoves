import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AlcovesImage from './AlcovesImage.svelte';

describe('AlcovesImage', () => {
	it('builds a deterministic proxy src for a named variant', async () => {
		const screen = render(AlcovesImage, {
			props: { libraryId: 'L', fileId: 'F', variant: 'timeline', alt: 'pic' }
		});
		const img = screen.container.querySelector('img')!;
		expect(img.getAttribute('src')).toBe(
			'/api/files/proxy/L/F?format=webp&height=384&quality=80&width=384'
		);
		expect(img.getAttribute('alt')).toBe('pic');
		expect(img.getAttribute('crossorigin')).toBe('use-credentials');
		expect(img.getAttribute('loading')).toBe('lazy');
	});

	it('clamps a capped variant to the source dimensions', async () => {
		const screen = render(AlcovesImage, {
			props: { libraryId: 'L', fileId: 'F', variant: 'card', sourceWidth: 400, sourceHeight: 200 }
		});
		const img = screen.container.querySelector('img')!;
		expect(img.getAttribute('src')).toBe(
			'/api/files/proxy/L/F?format=jpeg&height=200&quality=82&width=400'
		);
	});

	it('lets explicit overrides win and omits zero dimensions', async () => {
		const screen = render(AlcovesImage, {
			props: { libraryId: 'L', fileId: 'F', format: 'png', quality: 50 }
		});
		const img = screen.container.querySelector('img')!;
		expect(img.getAttribute('src')).toBe('/api/files/proxy/L/F?format=png&quality=50');
	});

	it('shows a neutral placeholder class until the image loads, keeping caller classes', async () => {
		const screen = render(AlcovesImage, {
			props: { libraryId: 'L', fileId: 'F', variant: 'timeline', class: 'object-cover' }
		});
		const img = screen.container.querySelector('img')!;
		expect(img.getAttribute('class')).toContain('bg-surface-200-800');
		expect(img.getAttribute('class')).toContain('object-cover');
	});
});
