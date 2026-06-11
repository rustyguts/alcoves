import { describe, it, expect, vi } from 'vitest';
import { load } from './+page.server';
import type { ShareMetadata } from './+page.server';

const meta: ShareMetadata = {
	token: 'tok',
	title: 'A shared moment',
	description: 'A clip from the trip',
	shareUrl: 'https://alcoves.io/s/tok',
	appUrl: 'https://alcoves.io/libraries/lib',
	videoUrl: '/api/share/tok/video',
	thumbnailUrl: '/api/share/tok/thumbnail',
	ready: true
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (fetch: any) => load({ params: { token: 'tok' }, fetch } as any);

describe('s/[token] +page.server load', () => {
	it('fetches /api/share/:token and returns the metadata on 200', async () => {
		const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => meta });
		const result = (await call(fetch)) as { meta: ShareMetadata };
		expect(fetch).toHaveBeenCalledWith('/api/share/tok');
		expect(result.meta).toEqual(meta);
	});

	it('throws a 404 when the share is not found', async () => {
		const fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
		await expect(call(fetch)).rejects.toMatchObject({ status: 404 });
	});
});
