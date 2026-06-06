import { describe, it, expect } from 'vitest';
import type { GalleryItem, GalleryGroup } from './gallery-types';

/**
 * `gallery-types` is a type-only module: it has no runtime exports, so there
 * are no executable lines to cover. These tests exist to exercise the import
 * and to lock the structural contract of the interfaces — a future shape change
 * (renamed/removed field, wrong type) fails compilation here.
 */
describe('gallery-types', () => {
	it('constructs a fully-populated GalleryItem', () => {
		const item: GalleryItem<{ source: string }> = {
			id: 'file-1',
			libraryId: 'lib-1',
			thumbnailFileId: 'file-1',
			aspect: 1.5,
			mime: 'image/jpeg',
			name: 'sunset.jpg',
			isVideo: false,
			durationLabel: null,
			sourceWidth: 1920,
			sourceHeight: 1280,
			badge: 'beach',
			raw: { source: 'timeline' }
		};

		expect(item.id).toBe('file-1');
		expect(item.libraryId).toBe('lib-1');
		expect(item.thumbnailFileId).toBe('file-1');
		expect(item.aspect).toBeCloseTo(1.5);
		expect(item.mime).toBe('image/jpeg');
		expect(item.name).toBe('sunset.jpg');
		expect(item.isVideo).toBe(false);
		expect(item.durationLabel).toBeNull();
		expect(item.sourceWidth).toBe(1920);
		expect(item.sourceHeight).toBe(1280);
		expect(item.badge).toBe('beach');
		expect(item.raw).toEqual({ source: 'timeline' });
	});

	it('constructs a minimal GalleryItem (optional fields omitted, null thumbnail)', () => {
		const item: GalleryItem = {
			id: 'file-2',
			libraryId: 'lib-1',
			thumbnailFileId: null,
			aspect: 1,
			mime: 'application/pdf',
			name: 'report.pdf',
			isVideo: false,
			raw: undefined
		};

		expect(item.thumbnailFileId).toBeNull();
		expect(item.aspect).toBe(1);
		expect(item.durationLabel).toBeUndefined();
		expect(item.sourceWidth).toBeUndefined();
		expect(item.sourceHeight).toBeUndefined();
		expect(item.badge).toBeUndefined();
	});

	it('constructs a video GalleryItem with a duration label', () => {
		const item: GalleryItem = {
			id: 'file-3',
			libraryId: 'lib-1',
			thumbnailFileId: 'file-3',
			aspect: 16 / 9,
			mime: 'video/mp4',
			name: 'clip.mp4',
			isVideo: true,
			durationLabel: '4:07',
			raw: undefined
		};

		expect(item.isVideo).toBe(true);
		expect(item.durationLabel).toBe('4:07');
	});

	it('constructs a GalleryGroup containing typed items', () => {
		const items: GalleryItem<number>[] = [
			{
				id: 'a',
				libraryId: 'lib-1',
				thumbnailFileId: 'a',
				aspect: 1,
				mime: 'image/png',
				name: 'a.png',
				isVideo: false,
				raw: 1
			},
			{
				id: 'b',
				libraryId: 'lib-1',
				thumbnailFileId: 'b',
				aspect: 1,
				mime: 'image/png',
				name: 'b.png',
				isVideo: false,
				raw: 2
			}
		];

		const group: GalleryGroup<number> = {
			key: '2025-06',
			sectionLabel: 'June 2025',
			heading: 'June 6',
			count: items.length,
			items
		};

		expect(group.key).toBe('2025-06');
		expect(group.sectionLabel).toBe('June 2025');
		expect(group.heading).toBe('June 6');
		expect(group.count).toBe(2);
		expect(group.items).toHaveLength(2);
		expect(group.items.map((i) => i.raw)).toEqual([1, 2]);
	});

	it('constructs a minimal GalleryGroup (no section label, empty items)', () => {
		const group: GalleryGroup = {
			key: 'empty',
			heading: 'No results',
			count: 0,
			items: []
		};

		expect(group.sectionLabel).toBeUndefined();
		expect(group.count).toBe(0);
		expect(group.items).toEqual([]);
	});
});
