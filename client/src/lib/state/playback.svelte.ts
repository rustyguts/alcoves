/**
 * Playback store — the editor's single source of truth for player state.
 *
 * The player component feeds state in through the `on*` methods and registers
 * an imperative controller; transport bar, timeline and shortcuts all read the
 * getters and call the verbs. Every controller call is null-safe so shortcuts
 * pressed before the player mounts are no-ops instead of crashes.
 *
 * Convention: no $effect in here — the page drives loop checks by calling
 * `applyLoop(selectedMoment)` from its own $effect.
 */

export interface PlaybackController {
	seek: (seconds: number) => void;
	togglePlay: () => void;
	play: () => void;
	pause: () => void;
	setRate: (rate: number) => void;
	setMuted: (muted: boolean) => void;
	setVolume: (volume: number) => void;
	enterFullscreen: () => void;
}

/** Frame stepping assumes ~30fps; labeled "~1 frame" in the UI. */
export const FRAME_SECONDS = 1 / 30;
export const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
/** J / L / arrow-key jump distance. */
export const JUMP_SECONDS = 5;

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

export function createPlayback() {
	let controller: PlaybackController | null = null;
	// A play pressed before the player has mounted (dynamic import still in
	// flight) is remembered and fired once the controller registers, instead of
	// being a silently dead button.
	let pendingPlay = false;

	let currentTime = $state(0);
	let duration = $state(0);
	let paused = $state(true);
	let rate = $state(1);
	let muted = $state(false);
	let volume = $state(1);
	let loop = $state(false);

	function seek(seconds: number) {
		const upper = duration > 0 ? duration : Number.POSITIVE_INFINITY;
		const clamped = Math.min(upper, Math.max(0, seconds));
		// Optimistic local update keeps the playhead snappy; the player's own
		// time event will confirm (or correct) it a tick later.
		currentTime = clamped;
		controller?.seek(clamped);
	}

	return {
		get currentTime() {
			return currentTime;
		},
		get duration() {
			return duration;
		},
		get paused() {
			return paused;
		},
		get rate() {
			return rate;
		},
		get muted() {
			return muted;
		},
		get volume() {
			return volume;
		},
		get loop() {
			return loop;
		},

		setController(c: PlaybackController | null) {
			controller = c;
			if (c && pendingPlay) {
				pendingPlay = false;
				c.play();
			}
		},

		// — feeds from the player —
		onTime(seconds: number) {
			currentTime = seconds;
		},
		onDuration(seconds: number) {
			duration = seconds;
		},
		onPaused(value: boolean) {
			paused = value;
		},
		onRate(value: number) {
			rate = value;
		},
		onVolume(value: number, isMuted: boolean) {
			volume = value;
			muted = isMuted;
		},

		// — verbs —
		seek,
		togglePlay() {
			if (!controller) {
				pendingPlay = !pendingPlay;
				return;
			}
			controller.togglePlay();
		},
		stepFrame(frames: number) {
			seek(currentTime + frames * FRAME_SECONDS);
		},
		jump(seconds: number) {
			seek(currentTime + seconds);
		},
		setRate(value: number) {
			rate = value;
			controller?.setRate(value);
		},
		toggleMute() {
			muted = !muted;
			controller?.setMuted(muted);
		},
		setVolume(value: number) {
			volume = clamp01(value);
			if (volume > 0 && muted) {
				muted = false;
				controller?.setMuted(false);
			}
			controller?.setVolume(volume);
		},
		toggleLoop() {
			loop = !loop;
		},
		disarmLoop() {
			loop = false;
		},
		enterFullscreen() {
			controller?.enterFullscreen();
		},

		/**
		 * Loop the selected moment: when armed and playback runs past the
		 * selection's end, wrap back to its start. Called from a page $effect.
		 * Only acts while actually PLAYING — a paused user must still be able to
		 * park the playhead beyond the selection (scrub, jump, set a new
		 * out-point) without the loop yanking it back.
		 */
		applyLoop(selection: { startSeconds: number; endSeconds: number } | null) {
			if (!loop || !selection || paused) return;
			if (currentTime >= selection.endSeconds) seek(selection.startSeconds);
		}
	};
}
