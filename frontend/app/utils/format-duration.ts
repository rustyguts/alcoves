/**
 * Format a duration in seconds as a YouTube-style label.
 *
 * Under an hour, renders `m:ss` (e.g. `4:07`, `0:42`). At an hour or more,
 * renders `h:mm:ss` (e.g. `1:02:09`). Returns `null` for missing, non-finite,
 * or non-positive input — including a value that rounds to `0:00`, which for a
 * library file means unknown / still-processing — so callers can hide the badge
 * entirely rather than render a misleading `0:00`.
 */
export function formatDuration(seconds: number | null | undefined): string | null {
	if (seconds == null || !Number.isFinite(seconds)) {
		return null;
	}

	const total = Math.round(seconds);
	if (total <= 0) {
		return null;
	}
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const secs = total % 60;

	const pad = (n: number) => n.toString().padStart(2, "0");

	if (hours > 0) {
		return `${hours}:${pad(minutes)}:${pad(secs)}`;
	}
	return `${minutes}:${pad(secs)}`;
}
