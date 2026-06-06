import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const toastMock = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('./toast', () => ({ toast: toastMock }));

import { createAsyncJob } from './async-job-status';

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('createAsyncJob', () => {
	it('polls while in flight and stops on terminal status', () => {
		const pollFn = vi.fn();
		const job = createAsyncJob({ pollFn, labels: { ready: 'R', failed: 'F' }, intervalMs: 1000 });

		job.sync('processing');
		vi.advanceTimersByTime(3000);
		expect(pollFn).toHaveBeenCalledTimes(3);

		job.sync('ready');
		vi.advanceTimersByTime(3000);
		expect(pollFn).toHaveBeenCalledTimes(3); // timer stopped
	});

	it('does not start a second timer when already polling', () => {
		const pollFn = vi.fn();
		const job = createAsyncJob({ pollFn, labels: { ready: 'R', failed: 'F' }, intervalMs: 1000 });
		job.sync('queued');
		job.sync('processing');
		vi.advanceTimersByTime(1000);
		expect(pollFn).toHaveBeenCalledTimes(1);
	});

	it('toasts success + runs onReady on a ready transition that was in flight', async () => {
		const onReady = vi.fn();
		const job = createAsyncJob({
			pollFn: vi.fn(),
			onReady,
			labels: { ready: 'Ready!', failed: 'F' }
		});
		job.sync('processing');
		job.sync('ready');
		expect(onReady).toHaveBeenCalledOnce();
		expect(toastMock.add).toHaveBeenCalledWith({ title: 'Ready!', color: 'success' });
	});

	it('toasts failure with the error description on a failed transition', () => {
		const job = createAsyncJob({ pollFn: vi.fn(), labels: { ready: 'R', failed: 'Failed!' } });
		job.sync('queued');
		job.sync('failed', 'disk full');
		expect(toastMock.add).toHaveBeenCalledWith({
			title: 'Failed!',
			description: 'disk full',
			color: 'error'
		});
	});

	it('does NOT toast when the status is already terminal on first observe', () => {
		const onReady = vi.fn();
		const job = createAsyncJob({ pollFn: vi.fn(), onReady, labels: { ready: 'R', failed: 'F' } });
		job.sync('ready'); // first observation, never was in flight
		expect(toastMock.add).not.toHaveBeenCalled();
		expect(onReady).toHaveBeenCalledOnce(); // onReady still fires
	});

	it('stop() clears the timer', () => {
		const pollFn = vi.fn();
		const job = createAsyncJob({ pollFn, labels: { ready: 'R', failed: 'F' }, intervalMs: 500 });
		job.sync('processing');
		job.stop();
		vi.advanceTimersByTime(2000);
		expect(pollFn).not.toHaveBeenCalled();
	});
});
