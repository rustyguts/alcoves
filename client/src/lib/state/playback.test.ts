import { describe, it, expect, vi } from 'vitest';
import {
	createPlayback,
	FRAME_SECONDS,
	JUMP_SECONDS,
	PLAYBACK_RATES,
	type PlaybackController
} from './playback.svelte';

function makeController() {
	return {
		seek: vi.fn<(seconds: number) => void>(),
		togglePlay: vi.fn<() => void>(),
		play: vi.fn<() => void>(),
		pause: vi.fn<() => void>(),
		setRate: vi.fn<(rate: number) => void>(),
		setMuted: vi.fn<(muted: boolean) => void>(),
		setVolume: vi.fn<(volume: number) => void>(),
		enterFullscreen: vi.fn<() => void>()
	} satisfies PlaybackController;
}

function makePlayback() {
	const controller = makeController();
	const playback = createPlayback();
	playback.setController(controller);
	return { playback, controller };
}

describe('createPlayback', () => {
	it('starts with neutral defaults', () => {
		const playback = createPlayback();
		expect(playback.currentTime).toBe(0);
		expect(playback.duration).toBe(0);
		expect(playback.paused).toBe(true);
		expect(playback.rate).toBe(1);
		expect(playback.muted).toBe(false);
		expect(playback.volume).toBe(1);
		expect(playback.loop).toBe(false);
	});

	it('exports the transport constants the UI is built around', () => {
		expect(FRAME_SECONDS).toBeCloseTo(1 / 30, 9);
		expect(JUMP_SECONDS).toBe(5);
		expect(PLAYBACK_RATES).toEqual([0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]);
	});

	describe('player feeds', () => {
		it('onTime updates currentTime', () => {
			const playback = createPlayback();
			playback.onTime(4.2);
			expect(playback.currentTime).toBe(4.2);
		});

		it('onDuration updates duration', () => {
			const playback = createPlayback();
			playback.onDuration(120);
			expect(playback.duration).toBe(120);
		});

		it('onPaused updates paused', () => {
			const playback = createPlayback();
			playback.onPaused(false);
			expect(playback.paused).toBe(false);
			playback.onPaused(true);
			expect(playback.paused).toBe(true);
		});

		it('onRate updates rate', () => {
			const playback = createPlayback();
			playback.onRate(1.5);
			expect(playback.rate).toBe(1.5);
		});

		it('onVolume updates volume and muted together', () => {
			const playback = createPlayback();
			playback.onVolume(0.3, true);
			expect(playback.volume).toBe(0.3);
			expect(playback.muted).toBe(true);
			playback.onVolume(0.8, false);
			expect(playback.volume).toBe(0.8);
			expect(playback.muted).toBe(false);
		});
	});

	describe('seek', () => {
		it('forwards the clamped time and updates currentTime optimistically', () => {
			const { playback, controller } = makePlayback();
			playback.onDuration(10);
			playback.seek(4);
			expect(playback.currentTime).toBe(4);
			expect(controller.seek).toHaveBeenCalledWith(4);
		});

		it('clamps below to 0', () => {
			const { playback, controller } = makePlayback();
			playback.onDuration(10);
			playback.seek(-3);
			expect(playback.currentTime).toBe(0);
			expect(controller.seek).toHaveBeenCalledWith(0);
		});

		it('clamps above to duration', () => {
			const { playback, controller } = makePlayback();
			playback.onDuration(10);
			playback.seek(99);
			expect(playback.currentTime).toBe(10);
			expect(controller.seek).toHaveBeenCalledWith(10);
		});

		it('applies no upper clamp while duration is unknown (0)', () => {
			const { playback, controller } = makePlayback();
			playback.seek(42);
			expect(playback.currentTime).toBe(42);
			expect(controller.seek).toHaveBeenCalledWith(42);
		});

		it('still updates currentTime with no controller attached', () => {
			const playback = createPlayback();
			playback.onDuration(10);
			expect(() => playback.seek(5)).not.toThrow();
			expect(playback.currentTime).toBe(5);
		});
	});

	describe('transport verbs', () => {
		it('togglePlay delegates to the controller', () => {
			const { playback, controller } = makePlayback();
			playback.togglePlay();
			expect(controller.togglePlay).toHaveBeenCalledTimes(1);
		});

		it('queues a play pressed before the controller registers and fires it on registration', () => {
			const playback = createPlayback();
			const controller = makeController();
			playback.togglePlay(); // no controller yet — remember the intent
			playback.setController(controller);
			expect(controller.play).toHaveBeenCalledTimes(1);
			expect(controller.togglePlay).not.toHaveBeenCalled();
		});

		it('a second pre-controller toggle cancels the queued play', () => {
			const playback = createPlayback();
			const controller = makeController();
			playback.togglePlay();
			playback.togglePlay(); // user changed their mind
			playback.setController(controller);
			expect(controller.play).not.toHaveBeenCalled();
		});

		it('jump seeks relative to the current time', () => {
			const { playback, controller } = makePlayback();
			playback.onDuration(60);
			playback.onTime(10);
			playback.jump(JUMP_SECONDS);
			expect(playback.currentTime).toBe(15);
			expect(controller.seek).toHaveBeenCalledWith(15);
		});

		it('jump clamps at 0 going backwards', () => {
			const { playback, controller } = makePlayback();
			playback.onDuration(60);
			playback.onTime(2);
			playback.jump(-5);
			expect(playback.currentTime).toBe(0);
			expect(controller.seek).toHaveBeenCalledWith(0);
		});

		it('stepFrame moves by n × FRAME_SECONDS', () => {
			const { playback, controller } = makePlayback();
			playback.onDuration(60);
			playback.onTime(1);
			playback.stepFrame(1);
			expect(playback.currentTime).toBeCloseTo(1 + FRAME_SECONDS, 9);
			playback.stepFrame(-2);
			expect(playback.currentTime).toBeCloseTo(1 - FRAME_SECONDS, 9);
			expect(controller.seek).toHaveBeenCalledTimes(2);
		});

		it('stepFrame clamps at the media bounds', () => {
			const { playback } = makePlayback();
			playback.onDuration(10);
			playback.onTime(0);
			playback.stepFrame(-1);
			expect(playback.currentTime).toBe(0);
			playback.onTime(10);
			playback.stepFrame(1);
			expect(playback.currentTime).toBe(10);
		});

		it('setRate updates state and the controller', () => {
			const { playback, controller } = makePlayback();
			playback.setRate(2);
			expect(playback.rate).toBe(2);
			expect(controller.setRate).toHaveBeenCalledWith(2);
		});

		it('enterFullscreen delegates to the controller', () => {
			const { playback, controller } = makePlayback();
			playback.enterFullscreen();
			expect(controller.enterFullscreen).toHaveBeenCalledTimes(1);
		});
	});

	describe('volume', () => {
		it('toggleMute flips muted and pushes it to the controller', () => {
			const { playback, controller } = makePlayback();
			playback.toggleMute();
			expect(playback.muted).toBe(true);
			expect(controller.setMuted).toHaveBeenCalledWith(true);
			playback.toggleMute();
			expect(playback.muted).toBe(false);
			expect(controller.setMuted).toHaveBeenLastCalledWith(false);
		});

		it('setVolume clamps into [0, 1]', () => {
			const { playback, controller } = makePlayback();
			playback.setVolume(2);
			expect(playback.volume).toBe(1);
			expect(controller.setVolume).toHaveBeenLastCalledWith(1);
			playback.setVolume(-0.5);
			expect(playback.volume).toBe(0);
			expect(controller.setVolume).toHaveBeenLastCalledWith(0);
		});

		it('setVolume above 0 unmutes when muted', () => {
			const { playback, controller } = makePlayback();
			playback.toggleMute();
			expect(playback.muted).toBe(true);
			controller.setMuted.mockClear();
			playback.setVolume(0.5);
			expect(playback.volume).toBe(0.5);
			expect(playback.muted).toBe(false);
			expect(controller.setMuted).toHaveBeenCalledWith(false);
			expect(controller.setVolume).toHaveBeenCalledWith(0.5);
		});

		it('setVolume(0) leaves an armed mute in place', () => {
			const { playback, controller } = makePlayback();
			playback.toggleMute();
			controller.setMuted.mockClear();
			playback.setVolume(0);
			expect(playback.muted).toBe(true);
			expect(controller.setMuted).not.toHaveBeenCalled();
			expect(controller.setVolume).toHaveBeenCalledWith(0);
		});

		it('setVolume while unmuted does not touch mute state', () => {
			const { playback, controller } = makePlayback();
			playback.setVolume(0.7);
			expect(playback.muted).toBe(false);
			expect(controller.setMuted).not.toHaveBeenCalled();
		});
	});

	describe('loop', () => {
		it('toggleLoop arms and disarms', () => {
			const playback = createPlayback();
			playback.toggleLoop();
			expect(playback.loop).toBe(true);
			playback.toggleLoop();
			expect(playback.loop).toBe(false);
		});

		it('disarmLoop always lands on false', () => {
			const playback = createPlayback();
			playback.toggleLoop();
			playback.disarmLoop();
			expect(playback.loop).toBe(false);
			playback.disarmLoop();
			expect(playback.loop).toBe(false);
		});

		it('applyLoop wraps to the selection start once playback passes its end', () => {
			const { playback, controller } = makePlayback();
			playback.onDuration(10);
			playback.onPaused(false);
			playback.toggleLoop();
			playback.onTime(5.5);
			playback.applyLoop({ startSeconds: 2, endSeconds: 5 });
			expect(playback.currentTime).toBe(2);
			expect(controller.seek).toHaveBeenCalledWith(2);
		});

		it('applyLoop wraps when exactly at the selection end', () => {
			const { playback, controller } = makePlayback();
			playback.onDuration(10);
			playback.onPaused(false);
			playback.toggleLoop();
			playback.onTime(5);
			playback.applyLoop({ startSeconds: 2, endSeconds: 5 });
			expect(playback.currentTime).toBe(2);
			expect(controller.seek).toHaveBeenCalledWith(2);
		});

		it('applyLoop never wraps while paused — the user can park the playhead past the end', () => {
			const { playback, controller } = makePlayback();
			playback.onDuration(10);
			playback.toggleLoop();
			playback.onTime(7); // paused (default) + beyond the selection end
			playback.applyLoop({ startSeconds: 2, endSeconds: 5 });
			expect(playback.currentTime).toBe(7);
			expect(controller.seek).not.toHaveBeenCalled();
		});

		it('applyLoop is a no-op while inside the selection', () => {
			const { playback, controller } = makePlayback();
			playback.onDuration(10);
			playback.toggleLoop();
			playback.onTime(3);
			playback.applyLoop({ startSeconds: 2, endSeconds: 5 });
			expect(playback.currentTime).toBe(3);
			expect(controller.seek).not.toHaveBeenCalled();
		});

		it('applyLoop is a no-op when the loop is not armed', () => {
			const { playback, controller } = makePlayback();
			playback.onDuration(10);
			playback.onTime(9);
			playback.applyLoop({ startSeconds: 2, endSeconds: 5 });
			expect(playback.currentTime).toBe(9);
			expect(controller.seek).not.toHaveBeenCalled();
		});

		it('applyLoop is a no-op without a selection', () => {
			const { playback, controller } = makePlayback();
			playback.onDuration(10);
			playback.toggleLoop();
			playback.onTime(9);
			playback.applyLoop(null);
			expect(playback.currentTime).toBe(9);
			expect(controller.seek).not.toHaveBeenCalled();
		});
	});

	describe('controller lifecycle', () => {
		it('every verb is null-safe with no controller registered', () => {
			const playback = createPlayback();
			expect(() => {
				playback.seek(1);
				playback.togglePlay();
				playback.stepFrame(1);
				playback.jump(5);
				playback.setRate(1.5);
				playback.toggleMute();
				playback.setVolume(0.4);
				playback.toggleLoop();
				playback.applyLoop({ startSeconds: 0, endSeconds: 1 });
				playback.disarmLoop();
				playback.enterFullscreen();
			}).not.toThrow();
			// Local state still tracked despite the missing controller.
			expect(playback.rate).toBe(1.5);
			expect(playback.volume).toBe(0.4);
			expect(playback.loop).toBe(false);
		});

		it('setVolume unmute path stays null-safe without a controller', () => {
			const playback = createPlayback();
			playback.toggleMute();
			expect(() => playback.setVolume(0.6)).not.toThrow();
			expect(playback.muted).toBe(false);
			expect(playback.volume).toBe(0.6);
		});

		it('setController(null) detaches the previous controller', () => {
			const { playback, controller } = makePlayback();
			playback.setController(null);
			playback.togglePlay();
			playback.seek(3);
			expect(controller.togglePlay).not.toHaveBeenCalled();
			expect(controller.seek).not.toHaveBeenCalled();
			expect(playback.currentTime).toBe(3);
		});

		it('a replacement controller receives subsequent verbs', () => {
			const { playback, controller } = makePlayback();
			const next = makeController();
			playback.setController(next);
			playback.togglePlay();
			expect(next.togglePlay).toHaveBeenCalledTimes(1);
			expect(controller.togglePlay).not.toHaveBeenCalled();
		});
	});
});
