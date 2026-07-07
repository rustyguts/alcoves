import { describe, expect, it } from 'vitest';
import { fromBase64, toBase64 } from './base64';

describe('base64', () => {
	it('round-trips empty input', () => {
		expect(toBase64(new Uint8Array())).toBe('');
		expect(fromBase64('')).toEqual(new Uint8Array());
	});

	it('round-trips small binary data', () => {
		const bytes = new Uint8Array([0, 1, 2, 255, 128, 64]);
		expect(fromBase64(toBase64(bytes))).toEqual(bytes);
	});

	it('round-trips data larger than the chunk size', () => {
		// 0x8000 is the internal chunk; cross it by a margin.
		const bytes = new Uint8Array(0x8000 * 2 + 17);
		for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31) & 0xff;
		expect(fromBase64(toBase64(bytes))).toEqual(bytes);
	});

	it('matches Go encoding/json base64 for a known vector', () => {
		// json.Marshal([]byte{1,2,3}) → "AQID"
		expect(toBase64(new Uint8Array([1, 2, 3]))).toBe('AQID');
		expect(fromBase64('AQID')).toEqual(new Uint8Array([1, 2, 3]));
	});

	it('throws on malformed base64', () => {
		expect(() => fromBase64('!!!not-base64!!!')).toThrow();
	});
});
