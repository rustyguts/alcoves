import { describe, it, expect } from 'vitest';
import {
	IMAGE_VARIANTS,
	resolveVariant,
	proxyQueryString,
	type ResolvedTransform
} from './image-variants';

describe('resolveVariant', () => {
	it('returns the fixed box for a non-capped variant, ignoring source dims', () => {
		expect(resolveVariant('timeline')).toEqual({
			width: 384,
			height: 384,
			quality: 80,
			format: 'webp'
		});
		expect(resolveVariant('search', 10, 10)).toEqual({
			width: 80,
			height: 80,
			quality: 70,
			format: 'jpeg'
		});
	});

	it('clamps DOWN to the source size for a capped variant', () => {
		expect(resolveVariant('card', 500, 200)).toEqual({
			width: 500,
			height: 200,
			quality: 82,
			format: 'jpeg'
		});
	});

	it('never upscales a capped variant past its box', () => {
		expect(resolveVariant('card', 5000, 5000)).toEqual({
			width: 720,
			height: 360,
			quality: 82,
			format: 'jpeg'
		});
	});

	it('ignores zero/negative/unknown source dims when capping', () => {
		expect(resolveVariant('preview', 0, -1)).toEqual({
			width: 1920,
			height: 1080,
			quality: 90,
			format: 'jpeg'
		});
		expect(resolveVariant('preview', null, undefined)).toEqual({
			width: 1920,
			height: 1080,
			quality: 90,
			format: 'jpeg'
		});
	});

	it('exposes a stable, named variant registry', () => {
		expect(Object.keys(IMAGE_VARIANTS).sort()).toEqual([
			'card',
			'face',
			'preview',
			'search',
			'timeline'
		]);
	});
});

describe('proxyQueryString', () => {
	it('produces an alphabetically-sorted query string', () => {
		const t: ResolvedTransform = { width: 384, height: 384, quality: 80, format: 'webp' };
		expect(proxyQueryString(t)).toBe('format=webp&height=384&quality=80&width=384');
	});

	it('omits zero width/height but always includes format', () => {
		expect(proxyQueryString({ width: 0, height: 0, quality: 0, format: 'jpeg' })).toBe(
			'format=jpeg'
		);
		expect(proxyQueryString({ width: 100, height: 0, quality: 90, format: 'png' })).toBe(
			'format=png&quality=90&width=100'
		);
	});

	it('is deterministic regardless of property order', () => {
		const a = proxyQueryString({ format: 'jpeg', quality: 82, width: 720, height: 360 });
		const b = proxyQueryString({ width: 720, height: 360, format: 'jpeg', quality: 82 });
		expect(a).toBe(b);
	});
});
