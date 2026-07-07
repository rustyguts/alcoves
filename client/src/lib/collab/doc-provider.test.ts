import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import type { DocState } from '$lib/types/api';
import { fromBase64, toBase64 } from './base64';

const mocks = vi.hoisted(() => {
	class MockApiError extends Error {
		status: number;
		data: Record<string, unknown> | null;
		constructor(status: number, data: Record<string, unknown> | null = null) {
			// Mirrors the real ApiError: the body's message wins when present.
			super((data?.message as string) ?? `Request failed with status ${status}`);
			this.status = status;
			this.data = data;
		}
	}
	return {
		MockApiError,
		get: vi.fn(),
		init: vi.fn(),
		postUpdate: vi.fn(),
		updatesSince: vi.fn(),
		snapshot: vi.fn(),
		wsUrl: vi.fn(() => 'ws://test/api/libraries/L1/files/F1/doc/ws')
	};
});

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$lib/api', () => ({
	ApiError: mocks.MockApiError,
	api: {
		documents: {
			get: mocks.get,
			init: mocks.init,
			postUpdate: mocks.postUpdate,
			updatesSince: mocks.updatesSince,
			snapshot: mocks.snapshot,
			wsUrl: mocks.wsUrl
		}
	}
}));

import { createDocProvider, type DocProvider } from './doc-provider.svelte';

class FakeWebSocket {
	static instances: FakeWebSocket[] = [];
	static last(): FakeWebSocket {
		return FakeWebSocket.instances.at(-1)!;
	}
	url: string;
	readyState = 0;
	sent: string[] = [];
	private listeners: Record<string, Array<(ev?: unknown) => void>> = {};
	constructor(url: string) {
		this.url = url;
		FakeWebSocket.instances.push(this);
	}
	addEventListener(type: string, cb: (ev?: unknown) => void) {
		(this.listeners[type] ??= []).push(cb);
	}
	send(data: string) {
		this.sent.push(data);
	}
	close() {
		this.readyState = 3;
		this.emit('close');
	}
	emit(type: string, ev?: unknown) {
		(this.listeners[type] ?? []).forEach((cb) => cb(ev));
	}
	doOpen() {
		this.readyState = 1;
		this.emit('open');
	}
	doFrame(frame: unknown) {
		this.emit('message', { data: JSON.stringify(frame) });
	}
}

/** Build a source doc and capture each transaction as an incremental update. */
function sourceDoc(): { doc: Y.Doc; edit: (fn: (t: Y.Text) => void) => string } {
	const doc = new Y.Doc();
	const text = doc.getText('content');
	let captured = '';
	doc.on('update', (u: Uint8Array) => {
		captured = toBase64(u);
	});
	return {
		doc,
		edit(fn) {
			fn(text);
			return captured;
		}
	};
}

function existingState(overrides: Partial<DocState> = {}): DocState {
	return {
		exists: true,
		role: 'editor',
		seq: 0,
		snapshotSeq: 0,
		snapshot: null,
		updates: [],
		hasMore: false,
		...overrides
	};
}

function newProvider(): DocProvider {
	return createDocProvider({
		getLibraryId: () => 'L1',
		getFileId: () => 'F1',
		getUser: () => ({ id: 'user-1', name: 'Rusty' }),
		createSocket: (url) => new FakeWebSocket(url) as unknown as WebSocket
	});
}

let provider: DocProvider | null = null;

beforeEach(() => {
	vi.useFakeTimers();
	FakeWebSocket.instances = [];
	mocks.get.mockReset();
	mocks.init.mockReset();
	mocks.postUpdate.mockReset();
	mocks.updatesSince.mockReset();
	mocks.snapshot.mockReset();
});

afterEach(() => {
	provider?.dispose();
	provider = null;
	vi.useRealTimers();
});

describe('load', () => {
	it('applies snapshot + updates from an existing doc', async () => {
		const src = sourceDoc();
		const u1 = src.edit((t) => t.insert(0, 'Hello'));
		const u2 = src.edit((t) => t.insert(5, ' world'));
		mocks.get.mockResolvedValue(
			existingState({
				seq: 2,
				updates: [
					{ seq: 1, data: u1 },
					{ seq: 2, data: u2 }
				]
			})
		);
		provider = newProvider();
		await provider.load();
		expect(provider.ytext.toString()).toBe('Hello world');
		expect(provider.loaded).toBe(true);
		expect(provider.role).toBe('editor');
		expect(provider.statusLabel).toBe('All changes saved');
	});

	it('pages an initial state with hasMore via the replay endpoint', async () => {
		const src = sourceDoc();
		const u1 = src.edit((t) => t.insert(0, 'a'));
		const u2 = src.edit((t) => t.insert(1, 'b'));
		mocks.get.mockResolvedValue(
			existingState({ seq: 2, updates: [{ seq: 1, data: u1 }], hasMore: true })
		);
		mocks.updatesSince.mockResolvedValue({
			seq: 2,
			updates: [{ seq: 2, data: u2 }],
			hasMore: false
		});
		provider = newProvider();
		await provider.load();
		await vi.advanceTimersByTimeAsync(0);
		expect(mocks.updatesSince).toHaveBeenCalledWith('L1', 'F1', 1);
		expect(provider.ytext.toString()).toBe('ab');
	});

	it('seeds an unseeded doc from blob text and posts init', async () => {
		mocks.get.mockResolvedValue({ exists: false, role: 'editor', text: '# Seed me' });
		mocks.init.mockResolvedValue({ seq: 1 });
		provider = newProvider();
		await provider.load();
		expect(provider.ytext.toString()).toBe('# Seed me');
		expect(mocks.init).toHaveBeenCalledTimes(1);
		// The posted update reproduces the text on a fresh doc.
		const posted = (mocks.init.mock.calls[0][2] as { update: string }).update;
		const replica = new Y.Doc();
		Y.applyUpdate(replica, fromBase64(posted));
		expect(replica.getText('content').toString()).toBe('# Seed me');
	});

	it('discards the local doc and adopts the winner on init 409', async () => {
		const winnerSrc = sourceDoc();
		const w1 = winnerSrc.edit((t) => t.insert(0, 'WINNER'));
		const winner = existingState({ seq: 1, updates: [{ seq: 1, data: w1 }] });
		mocks.get.mockResolvedValue({ exists: false, role: 'editor', text: '# Loser seed' });
		mocks.init.mockRejectedValue(
			new mocks.MockApiError(409, winner as unknown as Record<string, unknown>)
		);
		provider = newProvider();
		await provider.load();
		// Local seed text is gone — only the winner's content survives.
		expect(provider.ytext.toString()).toBe('WINNER');
	});

	it('gives viewers a local read-only doc without posting init', async () => {
		mocks.get.mockResolvedValue({ exists: false, role: 'viewer', text: 'view me' });
		provider = newProvider();
		await provider.load();
		expect(provider.ytext.toString()).toBe('view me');
		expect(provider.role).toBe('viewer');
		expect(provider.statusLabel).toBe('Read-only');
		expect(mocks.init).not.toHaveBeenCalled();

		// Viewer edits (shouldn't happen — editor is read-only) never POST.
		provider.ytext.insert(0, 'x');
		await vi.advanceTimersByTimeAsync(5000);
		expect(mocks.postUpdate).not.toHaveBeenCalled();
	});
});

describe('local edits → POST queue', () => {
	async function loadedEditor(): Promise<DocProvider> {
		mocks.get.mockResolvedValue({ exists: false, role: 'editor', text: '' });
		mocks.init.mockResolvedValue({ seq: 1 });
		provider = newProvider();
		await provider.load();
		return provider;
	}

	it('debounces and merges multiple edits into one POST', async () => {
		const p = await loadedEditor();
		mocks.postUpdate.mockResolvedValue({ seq: 2 });

		p.ytext.insert(0, 'Hel');
		await vi.advanceTimersByTimeAsync(100);
		p.ytext.insert(3, 'lo');
		expect(p.statusLabel).toBe('Saving…');
		await vi.advanceTimersByTimeAsync(500);

		expect(mocks.postUpdate).toHaveBeenCalledTimes(1);
		const sent = (mocks.postUpdate.mock.calls[0][2] as { data: string }).data;
		const replica = new Y.Doc();
		Y.applyUpdate(replica, fromBase64(sent));
		expect(replica.getText('content').toString()).toBe('Hello');
		expect(p.statusLabel).toBe('All changes saved');
	});

	it('keeps the buffer and retries with backoff on POST failure', async () => {
		const p = await loadedEditor();
		mocks.postUpdate
			.mockRejectedValueOnce(new mocks.MockApiError(500))
			.mockResolvedValueOnce({ seq: 2 });

		p.ytext.insert(0, 'data');
		await vi.advanceTimersByTimeAsync(500);
		expect(mocks.postUpdate).toHaveBeenCalledTimes(1);
		expect(p.online).toBe(false);
		expect(p.statusLabel).toBe('Offline — retrying');

		await vi.advanceTimersByTimeAsync(1100);
		expect(mocks.postUpdate).toHaveBeenCalledTimes(2);
		expect(p.online).toBe(true);
		// Nothing lost: the retried payload still reproduces the edit.
		const sent = (mocks.postUpdate.mock.calls[1][2] as { data: string }).data;
		const replica = new Y.Doc();
		Y.applyUpdate(replica, fromBase64(sent));
		expect(replica.getText('content').toString()).toBe('data');
	});
});

describe('remote updates', () => {
	async function loadedWithSocket(): Promise<{ p: DocProvider; sock: FakeWebSocket }> {
		const src = sourceDoc();
		const u1 = src.edit((t) => t.insert(0, 'base'));
		mocks.get.mockResolvedValue(existingState({ seq: 1, updates: [{ seq: 1, data: u1 }] }));
		provider = newProvider();
		await provider.load();
		const sock = FakeWebSocket.last();
		sock.doOpen();
		// Reuse the same source doc to derive causally-consistent updates.
		return { p: provider, sock, ...({ src } as object) } as {
			p: DocProvider;
			sock: FakeWebSocket;
		} & { src: ReturnType<typeof sourceDoc> };
	}

	it('applies in-order frames and drops duplicates', async () => {
		const src = sourceDoc();
		const u1 = src.edit((t) => t.insert(0, 'base'));
		mocks.get.mockResolvedValue(existingState({ seq: 1, updates: [{ seq: 1, data: u1 }] }));
		provider = newProvider();
		await provider.load();
		const sock = FakeWebSocket.last();
		sock.doOpen();

		const u2 = src.edit((t) => t.insert(4, '!'));
		sock.doFrame({ type: 'update', seq: 2, data: u2 });
		expect(provider.ytext.toString()).toBe('base!');

		// Duplicate/stale frame: dropped without a replay fetch.
		sock.doFrame({ type: 'update', seq: 2, data: u2 });
		sock.doFrame({ type: 'update', seq: 1, data: u1 });
		expect(mocks.updatesSince).not.toHaveBeenCalled();
		expect(provider.ytext.toString()).toBe('base!');
	});

	it('recovers a seq gap through replay', async () => {
		const src = sourceDoc();
		const u1 = src.edit((t) => t.insert(0, 'base'));
		mocks.get.mockResolvedValue(existingState({ seq: 1, updates: [{ seq: 1, data: u1 }] }));
		provider = newProvider();
		await provider.load();
		const sock = FakeWebSocket.last();
		sock.doOpen();

		const u2 = src.edit((t) => t.insert(4, ' one'));
		const u3 = src.edit((t) => t.insert(8, ' two'));
		mocks.updatesSince.mockResolvedValue({
			seq: 3,
			updates: [
				{ seq: 2, data: u2 },
				{ seq: 3, data: u3 }
			],
			hasMore: false
		});

		// Frame 3 arrives while 2 was dropped → gap → replay from lastSeq=1.
		sock.doFrame({ type: 'update', seq: 3, data: u3 });
		await vi.advanceTimersByTimeAsync(0);
		expect(mocks.updatesSince).toHaveBeenCalledWith('L1', 'F1', 1);
		expect(provider.ytext.toString()).toBe('base one two');
	});

	it('replays when hello announces a newer seq', async () => {
		const { sock } = await loadedWithSocket();
		mocks.updatesSince.mockResolvedValue({ seq: 1, updates: [], hasMore: false });
		sock.doFrame({ type: 'hello', seq: 9 });
		await vi.advanceTimersByTimeAsync(0);
		expect(mocks.updatesSince).toHaveBeenCalledWith('L1', 'F1', 1);
	});

	it('polls from load until a socket actually opens (hanging handshake)', async () => {
		const src = sourceDoc();
		const u1 = src.edit((t) => t.insert(0, 'base'));
		mocks.get.mockResolvedValue(existingState({ seq: 1, updates: [{ seq: 1, data: u1 }] }));
		mocks.updatesSince.mockResolvedValue({ seq: 1, updates: [], hasMore: false });
		provider = newProvider();
		await provider.load();
		// The fake socket never opens (single-port proxies can hang the
		// upgrade without a close event) — polling must still cover reads.
		await vi.advanceTimersByTimeAsync(5_100);
		expect(mocks.updatesSince).toHaveBeenCalled();

		// Once the socket opens, polling stops.
		const before = mocks.updatesSince.mock.calls.length;
		FakeWebSocket.last().doOpen();
		await vi.advanceTimersByTimeAsync(11_000);
		expect(mocks.updatesSince.mock.calls.length).toBe(before);
	});

	it('cuts off a handshake that never completes and retries', async () => {
		const src = sourceDoc();
		const u1 = src.edit((t) => t.insert(0, 'base'));
		mocks.get.mockResolvedValue(existingState({ seq: 1, updates: [{ seq: 1, data: u1 }] }));
		mocks.updatesSince.mockResolvedValue({ seq: 1, updates: [], hasMore: false });
		provider = newProvider();
		await provider.load();
		expect(FakeWebSocket.instances).toHaveLength(1);

		// 8s connect timeout closes the zombie socket; backoff dials again.
		await vi.advanceTimersByTimeAsync(8_100);
		expect(FakeWebSocket.instances[0].readyState).toBe(3);
		await vi.advanceTimersByTimeAsync(2_000);
		expect(FakeWebSocket.instances.length).toBeGreaterThan(1);
	});

	it('answers pings and polls while disconnected', async () => {
		const { p, sock } = await loadedWithSocket();
		sock.doFrame({ type: 'ping' });
		expect(sock.sent.some((s) => JSON.parse(s).type === 'pong')).toBe(true);

		mocks.updatesSince.mockResolvedValue({ seq: 1, updates: [], hasMore: false });
		sock.close();
		expect(p.connected).toBe(false);
		await vi.advanceTimersByTimeAsync(POLL_ASSERT_MS);
		expect(mocks.updatesSince).toHaveBeenCalled();
	});
});

const POLL_ASSERT_MS = 5_100;

describe('awareness', () => {
	it('rebuilds peers from remote awareness and excludes self', async () => {
		const src = sourceDoc();
		const u1 = src.edit((t) => t.insert(0, 'x'));
		mocks.get.mockResolvedValue(existingState({ seq: 1, updates: [{ seq: 1, data: u1 }] }));
		provider = newProvider();
		await provider.load();
		const sock = FakeWebSocket.last();
		sock.doOpen();

		// A remote peer announces itself.
		const remoteDoc = new Y.Doc();
		const remoteAwareness = new awarenessProtocol.Awareness(remoteDoc);
		remoteAwareness.setLocalStateField('user', {
			name: 'Alice',
			color: '#ef4444',
			colorLight: '#ef444433',
			userId: 'user-2'
		});
		const update = awarenessProtocol.encodeAwarenessUpdate(remoteAwareness, [remoteDoc.clientID]);
		sock.doFrame({ type: 'awareness', data: toBase64(update) });

		expect(provider.peers).toHaveLength(1);
		expect(provider.peers[0]).toMatchObject({ name: 'Alice', userId: 'user-2' });

		// Our own local state never appears in peers.
		expect(provider.peers.every((peer) => peer.userId !== 'user-1')).toBe(true);
	});

	it('broadcasts local awareness over the socket, throttled', async () => {
		const src = sourceDoc();
		const u1 = src.edit((t) => t.insert(0, 'x'));
		mocks.get.mockResolvedValue(existingState({ seq: 1, updates: [{ seq: 1, data: u1 }] }));
		provider = newProvider();
		await provider.load();
		const sock = FakeWebSocket.last();
		sock.doOpen();
		sock.sent = [];

		provider.awareness.setLocalStateField('cursor', { anchor: 1, head: 2 });
		provider.awareness.setLocalStateField('cursor', { anchor: 2, head: 3 });
		await vi.advanceTimersByTimeAsync(150);
		const frames = sock.sent.map((s) => JSON.parse(s)).filter((f) => f.type === 'awareness');
		expect(frames).toHaveLength(1); // throttled into one send
	});
});

describe('concurrent-write correctness (C1)', () => {
	it('does not lose a concurrent edit when a write ack arrives with a seq gap', async () => {
		const src = sourceDoc();
		const u1 = src.edit((t) => t.insert(0, 'base'));
		mocks.get.mockResolvedValue(existingState({ seq: 1, updates: [{ seq: 1, data: u1 }] }));
		provider = newProvider();
		await provider.load();
		FakeWebSocket.last().doOpen();
		expect(provider.ytext.toString()).toBe('base');

		// Peer B edits concurrently on a replica of the seq-1 state → seq 2.
		const bReplica = new Y.Doc();
		Y.applyUpdate(bReplica, fromBase64(u1));
		let uB = '';
		bReplica.on('update', (u: Uint8Array) => (uB = toBase64(u)));
		bReplica.getText('content').insert(4, ' B');

		// Our own edit → server assigns seq 3 (a GAP: seq 2 = B's, not yet
		// received). The ack must NOT jump lastSeq to 3; it must replay.
		let uA = '';
		mocks.postUpdate.mockImplementation(async (_l: string, _f: string, body: { data: string }) => {
			uA = body.data;
			return { seq: 3 };
		});
		mocks.updatesSince.mockImplementation(async () => ({
			seq: 3,
			updates: [
				{ seq: 2, data: uB },
				{ seq: 3, data: uA }
			],
			hasMore: false
		}));

		provider.ytext.insert(4, ' A');
		await vi.advanceTimersByTimeAsync(500); // flush → ack seq 3 → gap → replay
		await vi.advanceTimersByTimeAsync(0);

		// Replay fetched from the true cursor (1), not the jumped ack seq.
		expect(mocks.updatesSince).toHaveBeenCalledWith('L1', 'F1', 1);
		// B's concurrent edit survived (was NOT silently dropped as a dup).
		const text = provider.ytext.toString();
		expect(text).toContain(' B');
		expect(text).toContain(' A');
	});
});

describe('undecodable update resilience (M3)', () => {
	it('skips a poison-pill update and keeps applying later frames', async () => {
		const src = sourceDoc();
		const u1 = src.edit((t) => t.insert(0, 'good'));
		mocks.get.mockResolvedValue(existingState({ seq: 1, updates: [{ seq: 1, data: u1 }] }));
		provider = newProvider();
		await provider.load();
		const sock = FakeWebSocket.last();
		sock.doOpen();

		// A corrupt seq-2 frame must not stall the read path behind a gap.
		sock.doFrame({ type: 'update', seq: 2, data: 'not-valid-base64-@@@' });
		// A valid seq-3 frame still applies (we advanced past the poison seq).
		const u3 = src.edit((t) => t.insert(4, '!'));
		sock.doFrame({ type: 'update', seq: 3, data: u3 });
		expect(provider.ytext.toString()).toBe('good!');
	});
});

describe('viewer on an unseeded doc (H1)', () => {
	it('adopts canonical content instead of duplicating when an editor seeds', async () => {
		mocks.get.mockResolvedValueOnce({ exists: false, role: 'viewer', text: 'blob text' });
		provider = newProvider();
		await provider.load();
		const sock = FakeWebSocket.last();
		sock.doOpen();
		expect(provider.ytext.toString()).toBe('blob text');
		expect(provider.role).toBe('viewer');

		// An editor seeds; the canonical seq-1 update ALSO contains "blob text".
		// Merging it onto the viewer's local seed would yield "blob textblob
		// text" — the viewer must ADOPT (resync) instead.
		const src = sourceDoc();
		const seed = src.edit((t) => t.insert(0, 'blob text'));
		mocks.get.mockResolvedValueOnce(
			existingState({ role: 'viewer', seq: 1, updates: [{ seq: 1, data: seed }] })
		);
		sock.doFrame({ type: 'update', seq: 1, data: seed });
		await vi.advanceTimersByTimeAsync(0);

		expect(provider.ytext.toString()).toBe('blob text');
	});

	it('does not churn-resync while the doc stays unseeded', async () => {
		mocks.get.mockResolvedValue({ exists: false, role: 'viewer', text: 'waiting' });
		// Every poll's replay hits 409 "not initialized" while unseeded.
		mocks.updatesSince.mockRejectedValue(
			new mocks.MockApiError(409, { message: 'Document not initialized' })
		);
		provider = newProvider();
		await provider.load();
		// WS never opens → polling drives replay across several intervals.
		await vi.advanceTimersByTimeAsync(20_000);
		// GET ran once (initial load) — a resync churn loop would GET per poll.
		expect(mocks.get).toHaveBeenCalledTimes(1);
		expect(provider.ytext.toString()).toBe('waiting');
	});
});

describe('reset / resync', () => {
	it('rebuilds from the server on a reset frame and bumps generation', async () => {
		const src = sourceDoc();
		const u1 = src.edit((t) => t.insert(0, 'old content'));
		mocks.get.mockResolvedValueOnce(existingState({ seq: 1, updates: [{ seq: 1, data: u1 }] }));
		provider = newProvider();
		await provider.load();
		const sock = FakeWebSocket.last();
		sock.doOpen();
		expect(provider.ytext.toString()).toBe('old content');
		const genBefore = provider.generation;

		// The server replaced the doc (e.g. MCP update_document): the next GET
		// returns the unseeded state with new text; init re-seeds.
		mocks.get.mockResolvedValueOnce({ exists: false, role: 'editor', text: 'MCP CONTENT' });
		mocks.init.mockResolvedValue({ seq: 1 });
		sock.doFrame({ type: 'reset' });
		await vi.advanceTimersByTimeAsync(0);

		expect(provider.ytext.toString()).toBe('MCP CONTENT');
		expect(provider.generation).toBe(genBefore + 1);
	});

	it('resyncs when an append hits the not-initialized 409', async () => {
		mocks.get.mockResolvedValueOnce({ exists: false, role: 'editor', text: 'before' });
		mocks.init.mockResolvedValue({ seq: 1 });
		provider = newProvider();
		await provider.load();

		// The doc got replaced server-side while we typed: POST 409s.
		mocks.postUpdate.mockRejectedValue(
			new mocks.MockApiError(409, { message: 'Document not initialized' })
		);
		mocks.get.mockResolvedValueOnce({ exists: false, role: 'editor', text: 'replaced' });
		provider.ytext.insert(6, ' typed');
		await vi.advanceTimersByTimeAsync(500);
		await vi.advanceTimersByTimeAsync(0);

		// Local edit superseded; content is the server's replacement.
		expect(provider.ytext.toString()).toBe('replaced');
		// No retry storm: one failed POST (+ the re-seed init), nothing pending.
		expect(mocks.postUpdate).toHaveBeenCalledTimes(1);
		expect(provider.pendingCount).toBe(0);
		expect(provider.statusLabel).toBe('All changes saved');
	});
});

describe('compaction', () => {
	it('PUTs a snapshot with upTo=lastSeq after local edits settle', async () => {
		mocks.get.mockResolvedValue({ exists: false, role: 'editor', text: '' });
		mocks.init.mockResolvedValue({ seq: 1 });
		mocks.postUpdate.mockResolvedValue({ seq: 2 });
		mocks.snapshot.mockResolvedValue({ snapshotSeq: 2 });
		provider = newProvider();
		await provider.load();

		provider.ytext.insert(0, '# Title');
		await vi.advanceTimersByTimeAsync(500); // flush
		await vi.advanceTimersByTimeAsync(60_000); // compaction timer

		expect(mocks.snapshot).toHaveBeenCalledTimes(1);
		const [lib, file, body] = mocks.snapshot.mock.calls[0] as [
			string,
			string,
			{ snapshot: string; upTo: number; text: string }
		];
		expect(lib).toBe('L1');
		expect(file).toBe('F1');
		expect(body.upTo).toBe(2);
		expect(body.text).toBe('# Title');
		const replica = new Y.Doc();
		Y.applyUpdate(replica, fromBase64(body.snapshot));
		expect(replica.getText('content').toString()).toBe('# Title');
	});

	it('treats a 409 snapshot conflict as benign', async () => {
		mocks.get.mockResolvedValue({ exists: false, role: 'editor', text: '' });
		mocks.init.mockResolvedValue({ seq: 1 });
		mocks.postUpdate.mockResolvedValue({ seq: 2 });
		mocks.snapshot.mockRejectedValue(new mocks.MockApiError(409));
		provider = newProvider();
		await provider.load();

		provider.ytext.insert(0, 'x');
		await vi.advanceTimersByTimeAsync(500);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(mocks.snapshot).toHaveBeenCalledTimes(1);
		expect(provider.statusLabel).toBe('All changes saved'); // no error surfaced
	});
});

describe('dispose', () => {
	it('flushes the pending buffer and compacts with keepalive', async () => {
		mocks.get.mockResolvedValue({ exists: false, role: 'editor', text: '' });
		mocks.init.mockResolvedValue({ seq: 1 });
		mocks.postUpdate.mockResolvedValue({ seq: 2 });
		mocks.snapshot.mockResolvedValue({ snapshotSeq: 2 });
		provider = newProvider();
		await provider.load();

		provider.ytext.insert(0, 'unsaved');
		provider.dispose(); // before the debounce fires
		await vi.advanceTimersByTimeAsync(0);

		expect(mocks.postUpdate).toHaveBeenCalledTimes(1);
		const sent = (mocks.postUpdate.mock.calls[0][2] as { data: string }).data;
		const replica = new Y.Doc();
		Y.applyUpdate(replica, fromBase64(sent));
		expect(replica.getText('content').toString()).toBe('unsaved');

		await vi.advanceTimersByTimeAsync(0);
		expect(mocks.snapshot).toHaveBeenCalledTimes(1);
		expect(mocks.snapshot.mock.calls[0][3]).toEqual({ keepalive: true });
		provider = null; // already disposed
	});

	it('is idempotent and stops all timers', async () => {
		mocks.get.mockResolvedValue({ exists: false, role: 'viewer', text: '' });
		provider = newProvider();
		await provider.load();
		provider.dispose();
		provider.dispose();
		await vi.advanceTimersByTimeAsync(120_000);
		expect(mocks.postUpdate).not.toHaveBeenCalled();
		expect(mocks.snapshot).not.toHaveBeenCalled();
		provider = null;
	});
});
