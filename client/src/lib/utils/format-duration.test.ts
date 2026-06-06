import { describe, it, expect } from 'vitest';
import { formatDuration } from './format-duration';

describe('formatDuration', () => {
	it('renders sub-minute durations as m:ss', () => {
		expect(formatDuration(42)).toBe('0:42');
		expect(formatDuration(5)).toBe('0:05');
		expect(formatDuration(1)).toBe('0:01');
	});

	it('renders minutes as m:ss without leading zero on minutes', () => {
		expect(formatDuration(247)).toBe('4:07');
		expect(formatDuration(600)).toBe('10:00');
		expect(formatDuration(60)).toBe('1:00');
	});

	it('renders hour-plus durations as h:mm:ss', () => {
		expect(formatDuration(3600)).toBe('1:00:00');
		expect(formatDuration(3729)).toBe('1:02:09');
		expect(formatDuration(7384)).toBe('2:03:04');
		// minutes padded to two digits when an hour is present
		expect(formatDuration(3661)).toBe('1:01:01');
	});

	it('rounds fractional seconds to the nearest second', () => {
		expect(formatDuration(59.6)).toBe('1:00');
		expect(formatDuration(12.4)).toBe('0:12');
		expect(formatDuration(3599.5)).toBe('1:00:00');
	});

	it('returns null for missing, invalid, or non-positive input', () => {
		expect(formatDuration(null)).toBeNull();
		expect(formatDuration(undefined)).toBeNull();
		expect(formatDuration(-1)).toBeNull();
		expect(formatDuration(Number.NaN)).toBeNull();
		expect(formatDuration(Number.POSITIVE_INFINITY)).toBeNull();
		expect(formatDuration(Number.NEGATIVE_INFINITY)).toBeNull();
		// 0 (and anything that rounds to 0:00) means unknown / still-processing —
		// hide the badge rather than render a misleading 0:00.
		expect(formatDuration(0)).toBeNull();
		expect(formatDuration(0.4)).toBeNull();
	});
});
