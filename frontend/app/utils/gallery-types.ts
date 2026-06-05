/**
 * Normalized shapes consumed by the reusable `JustifiedGallery` component.
 *
 * Callers (timeline, global search, …) map their own domain objects into these
 * so the gallery stays agnostic about where its tiles come from. The original
 * object travels along on `raw` and is handed back on `select`.
 */

export interface GalleryItem<T = unknown> {
	/** Stable key for the tile (use the file id). */
	id: string;
	libraryId: string;
	/** File id whose rendered image is the thumbnail, or null for an icon tile. */
	thumbnailFileId: string | null;
	/** Native aspect ratio (width / height); 1 when unknown. */
	aspect: number;
	/** MIME type, used to pick the fallback icon when there is no thumbnail. */
	mime: string;
	name: string;
	isVideo: boolean;
	/** Source dimensions, forwarded to the image proxy for a cache-aligned thumb. */
	sourceWidth?: number | null;
	sourceHeight?: number | null;
	/** Optional small corner label (e.g. matched object labels in search). */
	badge?: string | null;
	/** The original domain object, returned verbatim on `select`. */
	raw: T;
}

export interface GalleryGroup<T = unknown> {
	/** Stable key for the group. */
	key: string;
	/** Optional large heading rendered above the group (e.g. a month divider). */
	sectionLabel?: string | null;
	/** Sticky sub-heading for the group (e.g. a day, or a library name). */
	heading: string;
	/** Count shown next to the heading. */
	count: number;
	items: GalleryItem<T>[];
}
