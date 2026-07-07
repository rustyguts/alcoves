/**
 * Stable per-user presence colors for the collaborative editor. The shape
 * matches what y-codemirror.next reads from `awareness.user`: `color` paints
 * the remote caret + name tag, `colorLight` the translucent selection.
 */

export interface UserColor {
	color: string;
	colorLight: string;
}

// Hand-picked for caret visibility on both light and dark editor surfaces.
const PALETTE: UserColor[] = [
	{ color: '#3b82f6', colorLight: '#3b82f633' }, // blue
	{ color: '#ef4444', colorLight: '#ef444433' }, // red
	{ color: '#22c55e', colorLight: '#22c55e33' }, // green
	{ color: '#f59e0b', colorLight: '#f59e0b33' }, // amber
	{ color: '#8b5cf6', colorLight: '#8b5cf633' }, // violet
	{ color: '#ec4899', colorLight: '#ec489933' }, // pink
	{ color: '#14b8a6', colorLight: '#14b8a633' }, // teal
	{ color: '#f97316', colorLight: '#f9731633' }, // orange
	{ color: '#06b6d4', colorLight: '#06b6d433' }, // cyan
	{ color: '#84cc16', colorLight: '#84cc1633' } // lime
];

/** Deterministically map a user id to a palette entry (FNV-1a hash). */
export function userColor(userId: string): UserColor {
	let hash = 0x811c9dc5;
	for (let i = 0; i < userId.length; i++) {
		hash ^= userId.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return PALETTE[(hash >>> 0) % PALETTE.length];
}
