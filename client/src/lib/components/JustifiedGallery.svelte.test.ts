import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import JustifiedGallery from './JustifiedGallery.svelte';
import type { GalleryGroup } from '$lib/utils/gallery-types';

// thumbnailFileId is null so tiles fall back to a mime icon (AppIcon) and we
// don't pull in AlcovesImage's image-proxy plumbing.
function group(over: Partial<GalleryGroup> & { key: string }): GalleryGroup {
	return {
		sectionLabel: null,
		heading: over.heading ?? over.key,
		count: over.items?.length ?? 0,
		items: [],
		...over
	};
}

const TIMELINE_GROUPS: GalleryGroup[] = [
	group({
		key: '2026-0-14',
		heading: 'Wed, Jan 14',
		items: [
			{
				id: 'a',
				libraryId: 'lib',
				thumbnailFileId: null,
				aspect: 1.5,
				mime: 'image/jpeg',
				name: 'a.jpg',
				isVideo: false,
				raw: {}
			},
			{
				id: 'b',
				libraryId: 'lib',
				thumbnailFileId: null,
				aspect: 1,
				mime: 'video/mp4',
				name: 'b.mp4',
				isVideo: true,
				durationLabel: '1:35',
				raw: {}
			}
		]
	}),
	group({
		key: '2025-11-23',
		heading: 'Dec 23, 2025',
		items: [
			{
				id: 'c',
				libraryId: 'lib',
				thumbnailFileId: null,
				aspect: 1.2,
				mime: 'image/jpeg',
				name: 'c.jpg',
				isVideo: false,
				raw: {}
			}
		]
	})
];

describe('JustifiedGallery — continuous (timeline) mode', () => {
	it('renders one heading section per day, each with a scroll anchor', async () => {
		const screen = render(JustifiedGallery, {
			props: { continuous: true, groups: TIMELINE_GROUPS }
		});
		const sections = screen.container.querySelectorAll('section[data-group-key]');
		expect(sections).toHaveLength(2);
		await expect.element(screen.getByText('Wed, Jan 14')).toBeInTheDocument();
		await expect.element(screen.getByText('Dec 23, 2025')).toBeInTheDocument();
		expect(sections[0]!.getAttribute('data-group-key')).toBe('2026-0-14');
	});

	it("shows a video's duration with no play icon", async () => {
		const screen = render(JustifiedGallery, {
			props: { continuous: true, groups: TIMELINE_GROUPS }
		});
		await expect.element(screen.getByText('1:35')).toBeInTheDocument();
		// The play badge AppIcon is the only icon carrying `size-3`; it must be absent.
		expect(screen.container.querySelector('svg.size-3')).toBeNull();
	});

	it('calls onselect with the raw item when a tile is clicked', async () => {
		const raw = { id: 'a', marker: true };
		const onselect = vi.fn();
		const groups: GalleryGroup[] = [
			group({
				key: 'k',
				heading: 'Day',
				items: [
					{
						id: 'a',
						libraryId: 'lib',
						thumbnailFileId: null,
						aspect: 1,
						mime: 'image/jpeg',
						name: 'a.jpg',
						isVideo: false,
						raw
					}
				]
			})
		];
		const screen = render(JustifiedGallery, { props: { continuous: true, groups, onselect } });
		await screen.container.querySelector('button')!.click();
		expect(onselect).toHaveBeenCalledTimes(1);
		expect(onselect).toHaveBeenCalledWith(raw);
	});
});

describe('JustifiedGallery — default (search) mode', () => {
	it('renders a badge and a duration-only video tile when duration is known', async () => {
		const groups: GalleryGroup[] = [
			group({
				key: 'lib-1',
				heading: 'My Library',
				items: [
					{
						id: 'v',
						libraryId: 'lib-1',
						thumbnailFileId: null,
						aspect: 1.6,
						mime: 'video/mp4',
						name: 'clip.mp4',
						isVideo: true,
						durationLabel: '0:42',
						badge: 'dog, beach',
						raw: {}
					}
				]
			})
		];
		const screen = render(JustifiedGallery, { props: { groups } });
		await expect.element(screen.getByText('My Library')).toBeInTheDocument();
		await expect.element(screen.getByText('0:42')).toBeInTheDocument();
		await expect.element(screen.getByText('dog, beach')).toBeInTheDocument();
		// Duration is known, so the play-badge icon (`size-3`) must NOT render.
		expect(screen.container.querySelector('svg.size-3')).toBeNull();
	});

	it('falls back to a play badge for a video with no known duration (search results)', async () => {
		// Global search results carry no duration; the tile must still be marked as
		// a video so it stays distinguishable from images.
		const groups: GalleryGroup[] = [
			group({
				key: 'lib-1',
				heading: 'My Library',
				items: [
					{
						id: 'v',
						libraryId: 'lib-1',
						thumbnailFileId: null,
						aspect: 1.6,
						mime: 'video/mp4',
						name: 'clip.mp4',
						isVideo: true,
						raw: {}
					}
				]
			})
		];
		const screen = render(JustifiedGallery, { props: { groups } });
		expect(screen.container.querySelector('svg.size-3')).not.toBeNull();
	});

	it('renders a large section divider when sectionLabel is set', async () => {
		const groups: GalleryGroup[] = [
			group({
				key: 'lib-1',
				heading: 'My Library',
				sectionLabel: 'June 2026',
				items: [
					{
						id: 'p',
						libraryId: 'lib-1',
						thumbnailFileId: null,
						aspect: 1,
						mime: 'image/jpeg',
						name: 'p.jpg',
						isVideo: false,
						raw: {}
					}
				]
			})
		];
		const screen = render(JustifiedGallery, { props: { groups } });
		const divider = screen.container.querySelector('h2');
		expect(divider).not.toBeNull();
		expect(divider!.textContent).toContain('June 2026');
	});
});
