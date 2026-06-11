import { describe, it, expect } from 'vitest';
import { parseVtt } from '$lib/utils/parse-vtt';

describe('parseVtt', () => {
	it('returns [] for nullish / empty input', () => {
		expect(parseVtt(null)).toEqual([]);
		expect(parseVtt(undefined)).toEqual([]);
		expect(parseVtt('')).toEqual([]);
	});

	it('parses a basic cue, skipping the WEBVTT header and cue identifiers', () => {
		const vtt = ['WEBVTT', '', '1', '00:00:01.000 --> 00:00:04.000', 'Hello world', ''].join('\n');
		expect(parseVtt(vtt)).toEqual([{ startSeconds: 1, endSeconds: 4, text: 'Hello world' }]);
	});

	it('handles the optional hours component', () => {
		const vtt = '01:02:03.000 --> 01:02:05.500\nwith hours';
		expect(parseVtt(vtt)).toEqual([{ startSeconds: 3723, endSeconds: 3725.5, text: 'with hours' }]);
	});

	it('tolerates missing milliseconds', () => {
		const vtt = '00:00:01 --> 00:00:02\nno millis';
		expect(parseVtt(vtt)).toEqual([{ startSeconds: 1, endSeconds: 2, text: 'no millis' }]);
	});

	it('tolerates CRLF line endings', () => {
		const vtt = 'WEBVTT\r\n\r\n00:00:00.000 --> 00:00:01.000\r\ncrlf\r\n';
		expect(parseVtt(vtt)).toEqual([{ startSeconds: 0, endSeconds: 1, text: 'crlf' }]);
	});

	it('strips inline tag markup and joins multi-line text with a space', () => {
		const vtt = '00:01:02.500 --> 00:01:05.000\n<v Roger>Second <b>line</b>\ncontinued';
		expect(parseVtt(vtt)).toEqual([
			{ startSeconds: 62.5, endSeconds: 65, text: 'Second line continued' }
		]);
	});

	it('drops cues whose text is empty after stripping', () => {
		const vtt =
			'00:00:01.000 --> 00:00:02.000\n<00:00:01.500>\n\n00:00:03.000 --> 00:00:04.000\nkept';
		expect(parseVtt(vtt)).toEqual([{ startSeconds: 3, endSeconds: 4, text: 'kept' }]);
	});

	it('parses multiple consecutive cues', () => {
		const vtt = [
			'WEBVTT',
			'',
			'00:00:00.000 --> 00:00:01.000',
			'one',
			'',
			'00:00:01.000 --> 00:00:02.000',
			'two'
		].join('\n');
		const cues = parseVtt(vtt);
		expect(cues).toHaveLength(2);
		expect(cues.map((c) => c.text)).toEqual(['one', 'two']);
	});

	it('pads short millisecond fragments correctly', () => {
		// '.5' -> 500ms, '.05' -> 050ms
		const vtt = '00:00:00.5 --> 00:00:01.05\npadding';
		expect(parseVtt(vtt)).toEqual([{ startSeconds: 0.5, endSeconds: 1.05, text: 'padding' }]);
	});

	it('does not match timestamps whose millisecond fragment exceeds three digits', () => {
		// The regex caps the ms fragment at 3 digits, so '.1234' makes the line non-matching
		// and the cue is skipped entirely.
		const vtt = '00:00:00.1234 --> 00:00:01.5678\ntruncate';
		expect(parseVtt(vtt)).toEqual([]);
	});

	it('skips NOTE blocks and other non-timestamp preamble lines', () => {
		const vtt = [
			'WEBVTT',
			'',
			'NOTE this is a comment',
			'spanning two lines',
			'',
			'cue-id-7',
			'00:00:05.000 --> 00:00:06.000',
			'after note'
		].join('\n');
		expect(parseVtt(vtt)).toEqual([{ startSeconds: 5, endSeconds: 6, text: 'after note' }]);
	});

	it('returns [] when there are no timestamp lines at all', () => {
		const vtt = ['WEBVTT', '', 'just some text', 'with no cues'].join('\n');
		expect(parseVtt(vtt)).toEqual([]);
	});

	it('handles a final cue with no trailing newline', () => {
		const vtt = '00:00:01.000 --> 00:00:02.000\nlast line no newline';
		expect(parseVtt(vtt)).toEqual([
			{ startSeconds: 1, endSeconds: 2, text: 'last line no newline' }
		]);
	});

	it('parses a single-digit minute/second timestamp form', () => {
		// minutes allow 1-2 digits per the regex
		const vtt = '1:02 --> 0:03\nshort form';
		const cues = parseVtt(vtt);
		expect(cues).toHaveLength(1);
		expect(cues[0]!.startSeconds).toBe(62);
		expect(cues[0]!.endSeconds).toBe(3);
		expect(cues[0]!.text).toBe('short form');
	});
});
