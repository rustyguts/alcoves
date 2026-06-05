/**
 * Format a duration in seconds as a YouTube-style label.
 *
 * Under an hour, renders `m:ss` (e.g. `4:07`, `0:42`). At an hour or more,
 * renders `h:mm:ss` (e.g. `1:02:09`). Returns `null` for missing, negative,
 * or non-finite input so callers can hide the badge entirely.
 */
export function formatDuration(seconds: number | null | undefined): string | null {
	if (seconds == null || !Number.isFinite(seconds) || seconds < 0) {
		return null;
	}

	const total = Math.round(seconds);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const secs = total % 60;

	const pad = (n: number) => n.toString().padStart(2, "0");

	if (hours > 0) {
		return `${hours}:${pad(minutes)}:${pad(secs)}`;
	}
	return `${minutes}:${pad(secs)}`;
}
