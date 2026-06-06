/**
 * Highlight filter DSL parser.
 *
 * Grammar (informal):
 *   expression := orGroup ( "," orGroup )*
 *   orGroup    := andTerm ( ("&" | "AND") andTerm )*
 *   andTerm    := [ type ":" ] value [ ":" score ]
 *   type       := "audio" | "word"            // case-insensitive; default = audio
 *   value      := bareWord | quotedString
 *   score      := integer 0–100               // audio only
 *
 * Examples:
 *   screaming, yelling
 *   screaming:30, word:shit
 *   gunshot & word:fuck
 *   "machine gun":40, laughter:25
 *
 * Whitespace is insignificant outside quoted strings. Empty groups / tokens
 * are dropped silently (forgiving parser).
 */

export type TermType = 'audio' | 'word';

export interface Term {
	type: TermType;
	value: string;
	/** 0–1. For audio: minimum score. For word: ignored (always 0). */
	minScore: number;
}

export interface AndGroup {
	terms: Term[];
}

export interface ParsedExpression {
	groups: AndGroup[]; // OR-joined
	errors: string[];
}

const DEFAULT_AUDIO_SCORE = 0.2;

function tokenizeValue(input: string, i: number): { value: string; next: number } {
	if (input[i] === '"') {
		let j = i + 1;
		let value = '';
		while (j < input.length && input[j] !== '"') {
			value += input[j];
			j++;
		}
		if (input[j] === '"') j++;
		return { value, next: j };
	}
	let j = i;
	let value = '';
	while (j < input.length) {
		const ch = input[j]!;
		if (ch === ':' || ch === ',' || ch === '&' || ch === ' ' || ch === '\t') break;
		value += ch;
		j++;
	}
	return { value, next: j };
}

function parseTerm(raw: string): Term | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;

	// Detect leading type: "audio:" or "word:" (case-insensitive)
	let type: TermType = 'audio';
	let rest = trimmed;
	const colon = rest.indexOf(':');
	if (colon > 0) {
		const head = rest.slice(0, colon).toLowerCase();
		if (head === 'audio') {
			type = 'audio';
			rest = rest.slice(colon + 1).trim();
		} else if (head === 'word' || head === 'keyword' || head === 'text') {
			type = 'word';
			rest = rest.slice(colon + 1).trim();
		}
	}

	// Now `rest` is either `value` or `value:score` (or `"v with spaces":score`)
	const v = tokenizeValue(rest, 0);
	const value = v.value.trim();
	const after = rest.slice(v.next).trim();

	let minScore = type === 'audio' ? DEFAULT_AUDIO_SCORE : 0;
	if (after.startsWith(':')) {
		const scoreStr = after.slice(1).trim();
		const n = parseFloat(scoreStr);
		if (!Number.isNaN(n)) {
			minScore = n > 1 ? n / 100 : n;
			if (minScore < 0) minScore = 0;
			if (minScore > 1) minScore = 1;
		}
	}

	if (!value) return null;
	return { type, value: value.toLowerCase(), minScore };
}

function splitTopLevel(s: string, delimiters: RegExp): string[] {
	const out: string[] = [];
	const depth = 0;
	let inQuotes = false;
	let start = 0;
	for (let i = 0; i < s.length; i++) {
		const ch = s[i]!;
		if (ch === '"') inQuotes = !inQuotes;
		if (inQuotes) continue;
		if (depth === 0 && delimiters.test(ch)) {
			out.push(s.slice(start, i));
			start = i + 1;
		}
	}
	out.push(s.slice(start));
	return out;
}

function splitAnd(group: string): string[] {
	// Split on "&" or whitespace " AND " (case-insensitive)
	const normalized = group.replace(/\s+AND\s+/gi, '&');
	return splitTopLevel(normalized, /[&]/);
}

export function parseExpression(input: string): ParsedExpression {
	const errors: string[] = [];
	const expr = (input ?? '').replace(/\s+OR\s+/gi, ',');
	if (!expr.trim()) return { groups: [], errors };

	const orGroups = splitTopLevel(expr, /[,]/);
	const groups: AndGroup[] = [];
	for (const og of orGroups) {
		const andTokens = splitAnd(og);
		const terms: Term[] = [];
		for (const tok of andTokens) {
			const term = parseTerm(tok);
			if (term) terms.push(term);
			else if (tok.trim()) errors.push(`could not parse "${tok.trim()}"`);
		}
		if (terms.length > 0) groups.push({ terms });
	}
	return { groups, errors };
}

/** Format a term back into canonical DSL form. Useful for previews. */
export function formatTerm(t: Term): string {
	const value = /[\s]/.test(t.value) ? `"${t.value}"` : t.value;
	const head = t.type === 'word' ? 'word:' : '';
	if (t.type === 'audio' && t.minScore !== DEFAULT_AUDIO_SCORE) {
		return `${head}${value}:${Math.round(t.minScore * 100)}`;
	}
	return `${head}${value}`;
}
