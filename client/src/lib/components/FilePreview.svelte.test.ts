import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import FilePreview from './FilePreview.svelte';
import type { LibraryFile } from '$lib/types/api';

// `$lib/api` provides the typed client + apiUrl. apiUrl is the identity (no
// PUBLIC_API_ORIGIN) so we can assert the relative paths the component builds.
const apiFilesGet = vi.fn();
const apiPlaybackSources = vi.fn();
const apiGenerateProxy = vi.fn();

vi.mock('$lib/api', () => ({
	apiUrl: (p: string) => p,
	api: {
		files: {
			get: (...a: unknown[]) => apiFilesGet(...a),
			playbackSources: (...a: unknown[]) => apiPlaybackSources(...a),
			generateProxy: (...a: unknown[]) => apiGenerateProxy(...a)
		}
	}
}));

// The text-preview path uses makeApiFetch — stub it so no real network happens.
const textFetch = vi.fn();
vi.mock('$lib/api/fetch', () => ({
	makeApiFetch:
		() =>
		(...a: unknown[]) =>
			textFetch(...a)
}));

function makeFile(over: Partial<LibraryFile> = {}): LibraryFile {
	return {
		id: 'f1',
		libraryId: 'lib-1',
		parentFolderId: null,
		name: 'test.txt',
		mimeType: 'text/plain',
		size: 100,
		kind: 'file',
		duration: null,
		width: null,
		height: null,
		proxyStatus: null,
		owner: null,
		tags: [],
		createdAt: '2025-01-01T00:00:00Z',
		updatedAt: '2025-01-01T00:00:00Z',
		...over
	} as LibraryFile;
}

beforeEach(() => {
	apiFilesGet.mockReset().mockResolvedValue(makeFile());
	apiPlaybackSources.mockReset().mockResolvedValue({ defaultSourceId: '', sources: [] });
	apiGenerateProxy.mockReset().mockResolvedValue(undefined);
	textFetch.mockReset().mockResolvedValue('');
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('FilePreview', () => {
	it('renders nothing when closed', async () => {
		const file = makeFile({ mimeType: 'image/jpeg', name: 'photo.jpg' });
		const screen = render(FilePreview, {
			props: { file, libraryId: 'lib-1', files: [file], open: false }
		});
		expect(screen.container.querySelector('[role="dialog"]')).toBeNull();
	});

	it('renders an image preview for image files', async () => {
		const file = makeFile({ mimeType: 'image/jpeg', name: 'photo.jpg' });
		const screen = render(FilePreview, {
			props: { file, libraryId: 'lib-1', files: [file], open: true }
		});
		const img = screen.container.querySelector('img[alt="photo.jpg"]');
		expect(img).not.toBeNull();
		// Uses the shared preview variant query string.
		expect(img!.getAttribute('src')).toContain('/api/files/proxy/lib-1/f1?');
		expect(img!.getAttribute('src')).toContain('format=jpeg');
	});

	it('constrains low-resolution images to their natural size', async () => {
		const file = makeFile({ mimeType: 'image/jpeg', name: 'small.jpg', width: 640, height: 480 });
		const screen = render(FilePreview, {
			props: { file, libraryId: 'lib-1', files: [file], open: true }
		});
		const style = screen.container.querySelector('img[alt="small.jpg"]')!.getAttribute('style');
		expect(style).toContain('max-height: 480px');
		expect(style).toContain('max-width: 640px');
	});

	it('lets large images use the full preview area (no size clamp)', async () => {
		const file = makeFile({ mimeType: 'image/jpeg', name: 'big.jpg', width: 2560, height: 1440 });
		const screen = render(FilePreview, {
			props: { file, libraryId: 'lib-1', files: [file], open: true }
		});
		const style = screen.container.querySelector('img[alt="big.jpg"]')!.getAttribute('style');
		expect(style).toBeNull();
	});

	it('renders an iframe for PDF files', async () => {
		const file = makeFile({ mimeType: 'application/pdf', name: 'doc.pdf' });
		const screen = render(FilePreview, {
			props: { file, libraryId: 'lib-1', files: [file], open: true }
		});
		const frame = screen.container.querySelector('iframe');
		expect(frame).not.toBeNull();
		expect(frame!.getAttribute('src')).toBe('/api/libraries/lib-1/files/f1?inline=true');
	});

	it('renders a native video element for video files', async () => {
		const file = makeFile({ mimeType: 'video/mp4', name: 'clip.mp4' });
		const screen = render(FilePreview, {
			props: { file, libraryId: 'lib-1', files: [file], open: true }
		});
		const video = screen.container.querySelector('video');
		expect(video).not.toBeNull();
		// No playback source → direct inline URL.
		expect(video!.getAttribute('src')).toBe('/api/libraries/lib-1/files/f1?inline=true');
	});

	it('renders a native audio element for audio files', async () => {
		const file = makeFile({ mimeType: 'audio/mpeg', name: 'song.mp3' });
		const screen = render(FilePreview, {
			props: { file, libraryId: 'lib-1', files: [file], open: true }
		});
		expect(screen.container.querySelector('audio')).not.toBeNull();
	});

	it('shows an unsupported message for unknown mime types', async () => {
		const file = makeFile({ mimeType: 'application/octet-stream', name: 'data.bin' });
		const screen = render(FilePreview, {
			props: { file, libraryId: 'lib-1', files: [file], open: true }
		});
		expect(screen.container.textContent).toContain('Preview not available');
		expect(screen.container.textContent).toContain('application/octet-stream');
	});

	it('shows the file name in the header', async () => {
		const file = makeFile({ name: 'my-document.txt', mimeType: 'image/jpeg' });
		const screen = render(FilePreview, {
			props: { file, libraryId: 'lib-1', files: [file], open: true }
		});
		expect(screen.container.textContent).toContain('my-document.txt');
	});

	it('hides prev on the first file and next on the last file', async () => {
		const files = [
			makeFile({ id: 'f1', mimeType: 'image/jpeg' }),
			makeFile({ id: 'f2', mimeType: 'image/jpeg' })
		];
		const first = render(FilePreview, {
			props: { file: files[0]!, libraryId: 'lib-1', files, open: true }
		});
		expect(first.container.querySelector('[aria-label="Previous file"]')).toBeNull();
		expect(first.container.querySelector('[aria-label="Next file"]')).not.toBeNull();

		const last = render(FilePreview, {
			props: { file: files[1]!, libraryId: 'lib-1', files, open: true }
		});
		expect(last.container.querySelector('[aria-label="Next file"]')).toBeNull();
		expect(last.container.querySelector('[aria-label="Previous file"]')).not.toBeNull();
	});

	it('fires onnavigate with the next file when clicking next', async () => {
		const files = [
			makeFile({ id: 'f1', name: 'first.jpg', mimeType: 'image/jpeg' }),
			makeFile({ id: 'f2', name: 'second.jpg', mimeType: 'image/jpeg' })
		];
		const onnavigate = vi.fn();
		const screen = render(FilePreview, {
			props: { file: files[0]!, libraryId: 'lib-1', files, open: true, onnavigate }
		});
		(screen.container.querySelector('[aria-label="Next file"]') as HTMLButtonElement).click();
		expect(onnavigate).toHaveBeenCalledWith(files[1]);
	});

	it('fires onnavigate on ArrowRight / ArrowLeft keys', async () => {
		const files = [
			makeFile({ id: 'f1', mimeType: 'image/jpeg' }),
			makeFile({ id: 'f2', mimeType: 'image/jpeg' }),
			makeFile({ id: 'f3', mimeType: 'image/jpeg' })
		];
		const onnavigate = vi.fn();
		render(FilePreview, {
			props: { file: files[1]!, libraryId: 'lib-1', files, open: true, onnavigate }
		});
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
		await tick();
		expect(onnavigate).toHaveBeenLastCalledWith(files[2]);

		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
		await tick();
		expect(onnavigate).toHaveBeenLastCalledWith(files[0]);
	});

	it('closes via the close button when there is no pushed history', async () => {
		// popCount starts at 0 only if pushState is unavailable; stub history so the
		// open effect does not push, then assert the bindable open flips to false.
		const pushSpy = vi.spyOn(history, 'pushState').mockImplementation(() => {});
		const props = $state({
			file: makeFile({ mimeType: 'image/jpeg' }),
			libraryId: 'lib-1',
			files: [] as LibraryFile[],
			open: true
		});
		props.files = [props.file];
		const screen = render(FilePreview, { props });
		// One history entry was pushed on open → closing calls history.back, not open=false.
		const backSpy = vi.spyOn(history, 'back').mockImplementation(() => {});
		(screen.container.querySelector('[aria-label="Close preview"]') as HTMLButtonElement).click();
		await tick();
		expect(backSpy).toHaveBeenCalled();
		pushSpy.mockRestore();
		backSpy.mockRestore();
	});

	it('renders text content once the text fetch resolves', async () => {
		textFetch.mockResolvedValue('hello from the file');
		const file = makeFile({ mimeType: 'text/plain', name: 'readme.txt' });
		const screen = render(FilePreview, {
			props: { file, libraryId: 'lib-1', files: [file], open: true }
		});
		await vi.waitFor(() => {
			expect(screen.container.querySelector('pre')?.textContent).toContain('hello from the file');
		});
		expect(textFetch).toHaveBeenCalledWith('/api/libraries/lib-1/files/f1?inline=true', {
			responseType: 'text'
		});
	});

	it('requests proxy generation when Create Proxy is clicked', async () => {
		const file = makeFile({ id: 'vid', mimeType: 'video/mp4', name: 'clip.mp4' });
		const screen = render(FilePreview, {
			props: { file, libraryId: 'lib-1', files: [file], open: true }
		});
		const btn = [...screen.container.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('Create Proxy')
		) as HTMLButtonElement;
		expect(btn).toBeTruthy();
		btn.click();
		await vi.waitFor(() => {
			expect(apiGenerateProxy).toHaveBeenCalledWith('lib-1', 'vid');
		});
	});

	it('shows a processing overlay with percent and ETA for an in-progress proxy', async () => {
		const file = makeFile({
			id: 'vid',
			mimeType: 'video/mp4',
			name: 'clip.mp4',
			proxyStatus: 'processing',
			proxyProgress: 50,
			proxyEtaSeconds: 3661
		});
		// refreshProxyState re-reads the file; keep the same processing state.
		apiFilesGet.mockResolvedValue(file);
		const screen = render(FilePreview, {
			props: { file, libraryId: 'lib-1', files: [file], open: true }
		});
		await vi.waitFor(() => {
			expect(screen.container.textContent).toContain('Preparing video preview');
		});
		expect(screen.container.textContent).toContain('50%');
		// 3661s → 1h 1m
		expect(screen.container.textContent).toContain('1h 1m');
	});

	it('clamps over-100 proxy progress to 100%', async () => {
		const file = makeFile({
			id: 'vid',
			mimeType: 'video/mp4',
			proxyStatus: 'processing',
			proxyProgress: 250,
			proxyEtaSeconds: null
		});
		apiFilesGet.mockResolvedValue(file);
		const screen = render(FilePreview, {
			props: { file, libraryId: 'lib-1', files: [file], open: true }
		});
		await vi.waitFor(() => {
			expect(screen.container.textContent).toContain('100%');
		});
	});

	it('formats the ETA in minutes and seconds when under an hour', async () => {
		const file = makeFile({
			id: 'vid',
			mimeType: 'video/mp4',
			proxyStatus: 'processing',
			proxyProgress: 10,
			proxyEtaSeconds: 125
		});
		apiFilesGet.mockResolvedValue(file);
		const screen = render(FilePreview, {
			props: { file, libraryId: 'lib-1', files: [file], open: true }
		});
		await vi.waitFor(() => {
			// 125s → 2m 5s
			expect(screen.container.textContent).toContain('ETA 2m 5s');
		});
	});

	it('formats the ETA in seconds only when under a minute', async () => {
		const file = makeFile({
			id: 'vid',
			mimeType: 'video/mp4',
			proxyStatus: 'processing',
			proxyProgress: 90,
			proxyEtaSeconds: 45
		});
		apiFilesGet.mockResolvedValue(file);
		const screen = render(FilePreview, {
			props: { file, libraryId: 'lib-1', files: [file], open: true }
		});
		await vi.waitFor(() => {
			expect(screen.container.textContent).toContain('ETA 45s');
		});
	});

	it('omits the ETA label when the ETA is zero or negative', async () => {
		const file = makeFile({
			id: 'vid',
			mimeType: 'video/mp4',
			proxyStatus: 'processing',
			proxyProgress: 10,
			proxyEtaSeconds: 0
		});
		apiFilesGet.mockResolvedValue(file);
		const screen = render(FilePreview, {
			props: { file, libraryId: 'lib-1', files: [file], open: true }
		});
		await vi.waitFor(() => {
			expect(screen.container.textContent).toContain('Preparing video preview');
		});
		expect(screen.container.textContent).not.toContain('ETA');
	});

	it('treats NaN proxy progress as 0%', async () => {
		const file = makeFile({
			id: 'vid',
			mimeType: 'video/mp4',
			proxyStatus: 'processing',
			proxyProgress: Number.NaN,
			proxyEtaSeconds: null
		});
		apiFilesGet.mockResolvedValue(file);
		const screen = render(FilePreview, {
			props: { file, libraryId: 'lib-1', files: [file], open: true }
		});
		await vi.waitFor(() => {
			expect(screen.container.textContent).toContain('Preparing video preview');
		});
		expect(screen.container.textContent).toContain('0%');
	});

	it('renders a playback-source selector and uses the source stream url for video', async () => {
		apiPlaybackSources.mockResolvedValue({
			defaultSourceId: 's-proxy',
			sources: [
				{
					id: 's-proxy',
					name: '720p',
					mimeType: 'video/mp4',
					kind: 'proxy',
					streamUrl: '/stream/proxy.mp4',
					createdAt: '2025-01-01T00:00:00Z'
				},
				{
					id: 's-src',
					name: 'original',
					mimeType: 'video/quicktime',
					kind: 'source',
					streamUrl: '/stream/source.mov',
					createdAt: '2025-01-01T00:00:00Z'
				}
			]
		});
		const file = makeFile({ id: 'vid', mimeType: 'video/mp4', name: 'clip.mp4' });
		const screen = render(FilePreview, {
			props: { file, libraryId: 'lib-1', files: [file], open: true }
		});
		await vi.waitFor(() => {
			expect(screen.container.querySelector('select')).not.toBeNull();
		});
		const select = screen.container.querySelector('select') as HTMLSelectElement;
		// Both source kinds render labelled options.
		const labels = [...select.querySelectorAll('option')].map((o) => o.textContent?.trim());
		expect(labels).toContain('Proxy - 720p');
		expect(labels).toContain('Source - original');
		// The default source's stream url is used by the <video>.
		const video = screen.container.querySelector('video') as HTMLVideoElement;
		expect(video.getAttribute('src')).toBe('/stream/proxy.mp4');

		// Switching the selector writes back through bind:value and swaps the stream.
		select.value = 's-src';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		await tick();
		expect(video.getAttribute('src')).toBe('/stream/source.mov');
	});

	it('refreshes playback sources when a proxy reaches the ready state', async () => {
		const file = makeFile({
			id: 'vid',
			mimeType: 'video/mp4',
			name: 'clip.mp4',
			proxyStatus: 'ready'
		});
		apiFilesGet.mockResolvedValue(file);
		render(FilePreview, {
			props: { file, libraryId: 'lib-1', files: [file], open: true }
		});
		// The open effect + the proxyStatus==='ready' effect both call it.
		await vi.waitFor(() => {
			expect(apiPlaybackSources.mock.calls.length).toBeGreaterThanOrEqual(2);
		});
	});

	it('clears playback sources when fetching them fails', async () => {
		apiPlaybackSources.mockRejectedValue(new Error('boom'));
		const file = makeFile({ id: 'vid', mimeType: 'video/mp4', name: 'clip.mp4' });
		const screen = render(FilePreview, {
			props: { file, libraryId: 'lib-1', files: [file], open: true }
		});
		await vi.waitFor(() => {
			expect(apiPlaybackSources).toHaveBeenCalled();
		});
		// No selector renders when the list is empty.
		expect(screen.container.querySelector('select')).toBeNull();
	});

	it('keeps the last-known proxy state when refresh fails', async () => {
		apiFilesGet.mockRejectedValue(new Error('transient'));
		const file = makeFile({
			id: 'vid',
			mimeType: 'video/mp4',
			name: 'clip.mp4',
			proxyStatus: 'processing',
			proxyProgress: 33,
			proxyEtaSeconds: null
		});
		const screen = render(FilePreview, {
			props: { file, libraryId: 'lib-1', files: [file], open: true }
		});
		// Seeded state survives the failed refresh.
		await vi.waitFor(() => {
			expect(screen.container.textContent).toContain('33%');
		});
	});

	it('shows null text content (spinner) when the text fetch rejects', async () => {
		textFetch.mockRejectedValue(new Error('nope'));
		const file = makeFile({ mimeType: 'text/plain', name: 'broken.txt' });
		const screen = render(FilePreview, {
			props: { file, libraryId: 'lib-1', files: [file], open: true }
		});
		await vi.waitFor(() => {
			expect(textFetch).toHaveBeenCalled();
		});
		// No <pre> rendered; the loading spinner branch is shown instead.
		expect(screen.container.querySelector('pre')).toBeNull();
	});

	it('downloads the file via a synthesized anchor when Download is clicked', async () => {
		const click = vi.fn();
		const realCreate = document.createElement.bind(document);
		const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
			const el = realCreate(tag) as HTMLElement;
			if (tag === 'a') (el as HTMLAnchorElement).click = click;
			return el;
		});
		const file = makeFile({ id: 'dl', mimeType: 'image/jpeg', name: 'pic.jpg' });
		const screen = render(FilePreview, {
			props: { file, libraryId: 'lib-1', files: [file], open: true }
		});
		(screen.container.querySelector('[aria-label="Download file"]') as HTMLButtonElement).click();
		expect(click).toHaveBeenCalled();
		createSpy.mockRestore();
	});

	it('records natural dimensions and fades in on image load', async () => {
		const file = makeFile({ mimeType: 'image/jpeg', name: 'photo.jpg' });
		const screen = render(FilePreview, {
			props: { file, libraryId: 'lib-1', files: [file], open: true }
		});
		const img = screen.container.querySelector('img[alt="photo.jpg"]') as HTMLImageElement;
		expect(img.className).toContain('opacity-0');
		Object.defineProperty(img, 'naturalWidth', { value: 800, configurable: true });
		Object.defineProperty(img, 'naturalHeight', { value: 600, configurable: true });
		img.dispatchEvent(new Event('load'));
		await tick();
		expect(img.className).toContain('opacity-100');
		// Loaded dimensions feed the low-res size clamp.
		expect(img.getAttribute('style')).toContain('max-width: 800px');
	});

	it('closes via the backdrop click on the dialog itself', async () => {
		const backSpy = vi.spyOn(history, 'back').mockImplementation(() => {});
		const file = makeFile({ mimeType: 'image/jpeg', name: 'photo.jpg' });
		const screen = render(FilePreview, {
			props: { file, libraryId: 'lib-1', files: [file], open: true }
		});
		const dialog = screen.container.querySelector('[role="dialog"]') as HTMLElement;
		dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		await tick();
		expect(backSpy).toHaveBeenCalled();
		backSpy.mockRestore();
	});

	it('does not close when a click originates on a child element', async () => {
		const backSpy = vi.spyOn(history, 'back').mockImplementation(() => {});
		const file = makeFile({ mimeType: 'image/jpeg', name: 'photo.jpg' });
		const screen = render(FilePreview, {
			props: { file, libraryId: 'lib-1', files: [file], open: true }
		});
		const img = screen.container.querySelector('img[alt="photo.jpg"]') as HTMLElement;
		img.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		await tick();
		expect(backSpy).not.toHaveBeenCalled();
		backSpy.mockRestore();
	});

	it('closes on the Escape key (history.back when an entry was pushed)', async () => {
		const backSpy = vi.spyOn(history, 'back').mockImplementation(() => {});
		const file = makeFile({ mimeType: 'image/jpeg', name: 'photo.jpg' });
		render(FilePreview, {
			props: { file, libraryId: 'lib-1', files: [file], open: true }
		});
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		await tick();
		expect(backSpy).toHaveBeenCalled();
		backSpy.mockRestore();
	});

	it('ignores keydown events while the preview is closed', async () => {
		const onnavigate = vi.fn();
		const files = [
			makeFile({ id: 'f1', mimeType: 'image/jpeg' }),
			makeFile({ id: 'f2', mimeType: 'image/jpeg' })
		];
		render(FilePreview, {
			props: { file: files[0]!, libraryId: 'lib-1', files, open: false, onnavigate }
		});
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
		await tick();
		expect(onnavigate).not.toHaveBeenCalled();
	});

	it('closes the preview when a popstate event fires after opening', async () => {
		const props = $state({
			file: makeFile({ mimeType: 'image/jpeg', name: 'photo.jpg' }),
			libraryId: 'lib-1',
			files: [] as LibraryFile[],
			open: true
		});
		props.files = [props.file];
		render(FilePreview, { props });
		// The open effect pushed one history entry → popCount > 0, so popstate closes.
		window.dispatchEvent(new PopStateEvent('popstate'));
		await tick();
		expect(props.open).toBe(false);
	});

	it('re-seeds per-file proxy state when navigating to a different file', async () => {
		const vid1 = makeFile({
			id: 'v1',
			mimeType: 'video/mp4',
			name: 'one.mp4',
			proxyStatus: 'processing',
			proxyProgress: 20,
			proxyEtaSeconds: null
		});
		const vid2 = makeFile({
			id: 'v2',
			mimeType: 'video/mp4',
			name: 'two.mp4',
			proxyStatus: null
		});
		// refreshProxyState echoes whatever file it is asked about.
		apiFilesGet.mockImplementation((_lib: string, id: string) =>
			Promise.resolve(id === 'v1' ? vid1 : vid2)
		);
		const props = $state({
			file: vid1,
			libraryId: 'lib-1',
			files: [vid1, vid2] as LibraryFile[],
			open: true
		});
		const screen = render(FilePreview, { props });
		await vi.waitFor(() => {
			expect(screen.container.textContent).toContain('Preparing video preview');
		});
		// Switch files → the reset effect clears the processing overlay.
		props.file = vid2;
		await vi.waitFor(() => {
			expect(screen.container.textContent).not.toContain('Preparing video preview');
		});
	});

	it('polls the proxy state on an interval while a proxy is processing', async () => {
		const file = makeFile({
			id: 'vid',
			mimeType: 'video/mp4',
			name: 'clip.mp4',
			proxyStatus: 'processing',
			proxyProgress: 10,
			proxyEtaSeconds: null
		});
		apiFilesGet.mockResolvedValue(file);
		render(FilePreview, {
			props: { file, libraryId: 'lib-1', files: [file], open: true }
		});
		// The open effect kicks one refresh; wait until the poller is armed.
		await vi.waitFor(() => {
			expect(apiFilesGet).toHaveBeenCalled();
		});
		const callsBefore = apiFilesGet.mock.calls.length;
		// The component arms a 2s setInterval; wait for it to fire and re-read state.
		await vi.waitFor(
			() => {
				expect(apiFilesGet.mock.calls.length).toBeGreaterThan(callsBefore);
			},
			{ timeout: 4000, interval: 100 }
		);
	});

	it('preloads adjacent image files when open', async () => {
		const created: string[] = [];
		const RealImage = globalThis.Image;
		const FakeImage = function (this: { crossOrigin: string }) {
			this.crossOrigin = '';
			Object.defineProperty(this, 'src', {
				set(v: string) {
					created.push(v);
				}
			});
		};
		// @ts-expect-error test stub
		globalThis.Image = FakeImage;
		const files = [
			makeFile({ id: 'p1', mimeType: 'image/jpeg', name: 'a.jpg' }),
			makeFile({ id: 'p2', mimeType: 'image/jpeg', name: 'b.jpg' }),
			makeFile({ id: 'p3', mimeType: 'image/jpeg', name: 'c.jpg' })
		];
		render(FilePreview, {
			props: { file: files[1]!, libraryId: 'lib-1', files, open: true }
		});
		await tick();
		globalThis.Image = RealImage;
		// Adjacent (p1 + p3) preview URLs are preloaded.
		expect(created.some((u) => u.includes('/api/files/proxy/lib-1/p1'))).toBe(true);
		expect(created.some((u) => u.includes('/api/files/proxy/lib-1/p3'))).toBe(true);
	});
});
