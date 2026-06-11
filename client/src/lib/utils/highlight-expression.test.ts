import { describe, it, expect } from 'vitest';
import { parseExpression, formatTerm, type Term } from './highlight-expression';

describe('parseExpression', () => {
	it('returns empty groups for empty / whitespace / nullish input', () => {
		expect(parseExpression('')).toEqual({ groups: [], errors: [] });
		expect(parseExpression('   ')).toEqual({ groups: [], errors: [] });
		// @ts-expect-error exercising the nullish guard
		expect(parseExpression(undefined)).toEqual({ groups: [], errors: [] });
		// @ts-expect-error exercising the nullish guard
		expect(parseExpression(null)).toEqual({ groups: [], errors: [] });
	});

	it('splits OR groups on commas with default audio score', () => {
		const { groups, errors } = parseExpression('screaming, yelling');
		expect(errors).toEqual([]);
		expect(groups).toHaveLength(2);
		expect(groups[0]!.terms).toEqual([{ type: 'audio', value: 'screaming', minScore: 0.2 }]);
		expect(groups[1]!.terms).toEqual([{ type: 'audio', value: 'yelling', minScore: 0.2 }]);
	});

	it('parses an explicit audio score (percent form) into 0–1', () => {
		const { groups } = parseExpression('screaming:30');
		expect(groups[0]!.terms[0]).toEqual({ type: 'audio', value: 'screaming', minScore: 0.3 });
	});

	it('parses a fractional score directly', () => {
		const { groups } = parseExpression('screaming:0.45');
		expect(groups[0]!.terms[0]!.minScore).toBeCloseTo(0.45);
	});

	it('treats a score of exactly 1 as a fraction (not a percent)', () => {
		// n > 1 is false, so 1 is taken as-is rather than divided by 100
		const { groups } = parseExpression('screaming:1');
		expect(groups[0]!.terms[0]!.minScore).toBe(1);
	});

	it('treats a score of exactly 0 as a fraction', () => {
		const { groups } = parseExpression('screaming:0');
		expect(groups[0]!.terms[0]!.minScore).toBe(0);
	});

	it('clamps scores below 0 and above 100', () => {
		expect(parseExpression('a:-5').groups[0]!.terms[0]!.minScore).toBe(0);
		expect(parseExpression('a:250').groups[0]!.terms[0]!.minScore).toBe(1);
	});

	it('clamps a fractional score above 1 down to 1', () => {
		// 1.5 is > 1 → divided by 100 → 0.015, so use a value that stays > 1 only
		// via the percent branch; here exercise the minScore>1 clamp directly.
		// 150 → 1.5 → clamped to 1
		expect(parseExpression('a:150').groups[0]!.terms[0]!.minScore).toBe(1);
	});

	it('recognizes word/keyword/text type prefixes (word minScore 0)', () => {
		for (const prefix of ['word', 'keyword', 'text', 'WORD']) {
			const { groups } = parseExpression(`${prefix}:shit`);
			expect(groups[0]!.terms[0]).toEqual({ type: 'word', value: 'shit', minScore: 0 });
		}
	});

	it('recognizes an explicit audio: prefix', () => {
		const { groups } = parseExpression('audio:gunshot');
		expect(groups[0]!.terms[0]!.type).toBe('audio');
		expect(groups[0]!.terms[0]!.value).toBe('gunshot');
	});

	it('recognizes an uppercase AUDIO: prefix (case-insensitive head)', () => {
		const { groups } = parseExpression('AUDIO:gunshot');
		expect(groups[0]!.terms[0]).toEqual({ type: 'audio', value: 'gunshot', minScore: 0.2 });
	});

	it('treats an unknown type prefix as part of the value (audio default)', () => {
		// "foo:bar" — head "foo" is not a known type, so the colon is a score
		// separator instead; value is "foo", score "bar" is NaN → default.
		const { groups } = parseExpression('foo:bar');
		expect(groups[0]!.terms[0]).toEqual({ type: 'audio', value: 'foo', minScore: 0.2 });
	});

	it('handles an audio: prefix with an explicit score', () => {
		const { groups } = parseExpression('audio:gunshot:40');
		expect(groups[0]!.terms[0]).toEqual({ type: 'audio', value: 'gunshot', minScore: 0.4 });
	});

	it('handles a word: prefix with an explicit score (kept, not zeroed)', () => {
		// The score after a word value is still parsed by the generic logic.
		const { groups } = parseExpression('word:fuck:80');
		expect(groups[0]!.terms[0]!.type).toBe('word');
		expect(groups[0]!.terms[0]!.value).toBe('fuck');
		expect(groups[0]!.terms[0]!.minScore).toBe(0.8);
	});

	it('splits AND groups on & and on the word AND', () => {
		const amp = parseExpression('gunshot & word:fuck');
		expect(amp.groups).toHaveLength(1);
		expect(amp.groups[0]!.terms).toHaveLength(2);

		const word = parseExpression('gunshot AND word:fuck');
		expect(word.groups[0]!.terms).toHaveLength(2);
	});

	it('splits AND case-insensitively', () => {
		const { groups } = parseExpression('gunshot and laughter');
		expect(groups[0]!.terms.map((t) => t.value)).toEqual(['gunshot', 'laughter']);
	});

	it('treats OR keyword as a comma separator', () => {
		const { groups } = parseExpression('a OR b');
		expect(groups).toHaveLength(2);
	});

	it('treats OR keyword case-insensitively', () => {
		const { groups } = parseExpression('a or b');
		expect(groups).toHaveLength(2);
	});

	it('supports quoted multi-word values with a trailing score', () => {
		const { groups } = parseExpression('"machine gun":40, laughter:25');
		expect(groups[0]!.terms[0]).toEqual({ type: 'audio', value: 'machine gun', minScore: 0.4 });
		expect(groups[1]!.terms[0]!.value).toBe('laughter');
	});

	it('does not split commas inside quoted values', () => {
		const { groups } = parseExpression('"a, b, c"');
		expect(groups).toHaveLength(1);
		expect(groups[0]!.terms[0]!.value).toBe('a, b, c');
	});

	it('does not split & inside quoted values', () => {
		const { groups } = parseExpression('"a & b"');
		expect(groups).toHaveLength(1);
		expect(groups[0]!.terms[0]!.value).toBe('a & b');
	});

	it('handles a quoted value that is never closed', () => {
		const { groups } = parseExpression('"unterminated');
		expect(groups[0]!.terms[0]!.value).toBe('unterminated');
	});

	it('lowercases values', () => {
		const { groups } = parseExpression('SCREAMING');
		expect(groups[0]!.terms[0]!.value).toBe('screaming');
	});

	it('records an error for an unparseable token and drops empty groups', () => {
		const { groups, errors } = parseExpression(':30');
		expect(groups).toEqual([]);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain('could not parse');
		expect(errors[0]).toContain(':30');
	});

	it('ignores empty OR groups silently', () => {
		const { groups, errors } = parseExpression('screaming, , yelling');
		expect(groups).toHaveLength(2);
		expect(errors).toEqual([]);
	});

	it('ignores a bad score string but keeps the term', () => {
		const { groups } = parseExpression('screaming:abc');
		// parseFloat('abc') is NaN → falls back to the audio default
		expect(groups[0]!.terms[0]!.minScore).toBe(0.2);
	});

	it('falls back to the word default (0) when a word score is NaN', () => {
		const { groups } = parseExpression('word:hi:abc');
		expect(groups[0]!.terms[0]).toEqual({ type: 'word', value: 'hi', minScore: 0 });
	});

	it('drops a whitespace-only AND token without recording an error', () => {
		// The "& " produces an empty trailing token: parseTerm → null, but the
		// raw token is blank so no error is recorded.
		const { groups, errors } = parseExpression('gunshot & ');
		expect(groups).toHaveLength(1);
		expect(groups[0]!.terms).toHaveLength(1);
		expect(errors).toEqual([]);
	});

	it('parses a multi-group, multi-term expression end to end', () => {
		const { groups } = parseExpression('laughter:25 & word:bro, screaming:30 & word:wtf');
		expect(groups).toHaveLength(2);
		expect(groups[0]!.terms.map((t) => t.value)).toEqual(['laughter', 'bro']);
		expect(groups[1]!.terms.map((t) => t.value)).toEqual(['screaming', 'wtf']);
	});

	it('keeps word-class characters (apostrophes, hyphens, underscores) in bare values', () => {
		const { groups } = parseExpression("rock-n_roll's");
		expect(groups[0]!.terms[0]!.value).toBe("rock-n_roll's");
	});
});

describe('formatTerm', () => {
	const t = (over: Partial<Term>): Term => ({
		type: 'audio',
		value: 'scream',
		minScore: 0.2,
		...over
	});

	it('formats a default-score audio term as the bare value', () => {
		expect(formatTerm(t({}))).toBe('scream');
	});

	it('appends the score for a non-default audio term', () => {
		expect(formatTerm(t({ minScore: 0.3 }))).toBe('scream:30');
	});

	it('prefixes word terms and never appends a score', () => {
		expect(formatTerm(t({ type: 'word', value: 'shit', minScore: 0 }))).toBe('word:shit');
	});

	it('prefixes word terms even with a non-zero score (no score appended)', () => {
		expect(formatTerm(t({ type: 'word', value: 'shit', minScore: 0.9 }))).toBe('word:shit');
	});

	it('quotes values containing whitespace', () => {
		expect(formatTerm(t({ value: 'machine gun', minScore: 0.4 }))).toBe('"machine gun":40');
	});

	it('quotes a default-score audio value with whitespace (no score appended)', () => {
		expect(formatTerm(t({ value: 'machine gun', minScore: 0.2 }))).toBe('"machine gun"');
	});

	it('rounds the score to the nearest whole percent', () => {
		expect(formatTerm(t({ minScore: 0.456 }))).toBe('scream:46');
	});

	it('round-trips a parsed term back through formatTerm', () => {
		const parsed = parseExpression('laughter:25');
		expect(formatTerm(parsed.groups[0]!.terms[0]!)).toBe('laughter:25');
	});
});
