import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { browser } from '$app/environment';
import { api, ApiError } from '$lib/api';
import type { DocRole, DocState } from '$lib/types/api';
import { fromBase64, toBase64 } from './base64';
import { userColor } from './user-colors';

/** A connected collaborator, derived from awareness states (self excluded). */
export interface DocPeer {
	clientId: number;
	userId: string;
	name: string;
	color: string;
}

export interface DocProviderOptions {
	getLibraryId: () => string;
	getFileId: () => string;
	getUser: () => { id: string; name: string } | null;
	/** Test seam — defaults to `new WebSocket(url)`. */
	createSocket?: (url: string) => WebSocket;
}

const FLUSH_DEBOUNCE_MS = 400;
const FLUSH_MAX_WAIT_MS = 2000;
const RETRY_MAX_MS = 30_000;
const COMPACT_AFTER_MS = 60_000;
const COMPACT_BUSY_RETRY_MS = 5_000;
const POLL_INTERVAL_MS = 5_000;
const AWARENESS_THROTTLE_MS = 100;
const AWARENESS_REBROADCAST_MS = 15_000;
const RECONNECT_MAX_MS = 30_000;
// A single-port deployment's proxy can't upgrade WebSockets and may leave the
// handshake hanging forever (no close event) — cut it off and lean on polling.
const WS_CONNECT_TIMEOUT_MS = 8_000;
const WS_OPEN = 1; // WebSocket.OPEN without depending on the global

/**
 * Bridges a Y.Doc to the live-document backend:
 *
 * - **Writes** go over HTTP POST (debounced + merged via `Y.mergeUpdates`,
 *   one request in flight, backoff retry — the in-session offline buffer).
 * - **Reads** arrive on the per-document WebSocket; a sequence gap triggers
 *   replay over `GET .../doc/updates?since=` (the DB log is the source of
 *   truth, so drop-on-full fan-out is safe). While the socket is down the
 *   provider polls the same endpoint.
 * - **Awareness** (cursors/presence) is throttled onto the socket and never
 *   persisted.
 * - **Compaction**: after local edits, an editor periodically PUTs a merged
 *   snapshot + the markdown text; the server materializes the blob. A 409
 *   means someone else compacted — benign.
 *
 * Yjs objects (`Y.Doc`, `Awareness`) are plain fields, NEVER `$state` —
 * Svelte 5 deep proxies corrupt their internals. Reactivity is bridged
 * through scalars (`contentVersion`, `peers`, status flags).
 *
 * Store conventions: factory + getters, no `$effect` inside; the page calls
 * `load()` in onMount and `dispose()` in onDestroy.
 */
export function createDocProvider(opts: DocProviderOptions) {
	const createSocket = opts.createSocket ?? ((url: string) => new WebSocket(url));

	// Yjs internals — plain fields (see above).
	let ydoc = new Y.Doc();
	let ytext = ydoc.getText('content');
	let awareness = new awarenessProtocol.Awareness(ydoc);
	const REMOTE_ORIGIN = 'alcoves-remote';

	// Reactive scalars for the UI.
	let loaded = $state(false);
	// Bumped whenever the Y.Doc is REPLACED (init race lost, server-side
	// reset) — consumers keyed on it (the CodeMirror wrapper) rebind.
	let generation = $state(0);
	let role = $state<DocRole>('viewer');
	let connected = $state(false); // WebSocket health (read path)
	let online = $state(true); // write-path health (POST failures flip this)
	let pendingCount = $state(0);
	let contentVersion = $state(0);
	let peers = $state<DocPeer[]>([]);
	let loadError = $state<string | null>(null);

	// Sync bookkeeping (non-reactive).
	// lastSeq is a CONTIGUOUS-PREFIX cursor: "every update with seq ≤ lastSeq
	// is applied to this Y.Doc." Everything (applyRemote/replay/noteWriteAck)
	// must preserve that — never jump it past an unapplied gap, or a
	// compaction would prune updates the snapshot doesn't include.
	let lastSeq = 0;
	// seeded = the server holds canonical CRDT state we've synced to. false =
	// we're showing provisional local content (a viewer, or an editor mid-seed)
	// and must ADOPT the canonical state (resync) rather than merge onto it.
	let seeded = false;
	let buffer: Uint8Array[] = [];
	let firstBufferedAt = 0;
	let flushTimer: ReturnType<typeof setTimeout> | null = null;
	let inflight = false;
	let retryAttempt = 0;
	let replaying = false;
	let replayAgain = false;
	let hadLocalFlush = false;
	let compactTimer: ReturnType<typeof setTimeout> | null = null;
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let ws: WebSocket | null = null;
	let wsClosed = false;
	let reconnectAttempt = 0;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let wsConnectTimer: ReturnType<typeof setTimeout> | null = null;
	let awarenessSendTimer: ReturnType<typeof setTimeout> | null = null;
	let awarenessRebroadcast: ReturnType<typeof setInterval> | null = null;
	let disposed = false;
	let resyncing = false;

	const statusLabel = $derived.by(() => {
		if (!loaded) return 'Loading…';
		if (role === 'viewer') return 'Read-only';
		if (!online) return 'Offline — retrying';
		if (pendingCount > 0 || inflight) return 'Saving…';
		return 'All changes saved';
	});

	function libraryId() {
		return opts.getLibraryId();
	}
	function fileId() {
		return opts.getFileId();
	}

	// ── Initial load + seeding ────────────────────────────────────────────

	async function load(): Promise<void> {
		try {
			seeded = false;
			const state = await api.documents.get(libraryId(), fileId());
			role = state.role ?? 'viewer';
			if (state.exists) {
				applyState(state);
			} else if (role === 'editor') {
				await seedFromText(state.text ?? '');
			} else {
				// Viewer on an unseeded doc: render the blob text locally,
				// read-only. This is PROVISIONAL — the moment an editor seeds
				// the doc we adopt the canonical state (seeded stays false).
				seedLocalOnly(state.text ?? '');
			}
			attachDocListeners();
			setupAwareness();
			loaded = true;
			contentVersion++;
			// Poll from the start — the socket's open handler stops it. This is
			// the read path until (and unless) a WebSocket actually opens.
			startPolling();
			connect();
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load document';
			throw err;
		}
	}

	/** Apply one remote update, tolerating a corrupt/undecodable payload.
	 * Returns false when it could not be applied so callers still ADVANCE past
	 * it — a single poison-pill row must not stall the read path forever. */
	function applyRemoteUpdate(data: string): boolean {
		try {
			Y.applyUpdate(ydoc, fromBase64(data), REMOTE_ORIGIN);
			return true;
		} catch (err) {
			console.error('doc-provider: skipping undecodable update', err);
			return false;
		}
	}

	/** Apply a full server state (snapshot + updates) to the current doc. */
	function applyState(state: DocState) {
		if (state.snapshot) applyRemoteUpdate(state.snapshot);
		let cursor = state.snapshotSeq;
		for (const u of state.updates) {
			applyRemoteUpdate(u.data);
			cursor = u.seq;
		}
		lastSeq = Math.max(state.hasMore ? cursor : state.seq, cursor);
		seeded = true;
		// A paged initial state finishes over the replay endpoint.
		if (state.hasMore) {
			lastSeq = cursor;
			void replay();
		}
	}

	/** Editor path for an unseeded .md: build the doc from the blob text and
	 * race to init; the loser discards its local doc and adopts the winner. */
	async function seedFromText(text: string): Promise<void> {
		if (text) ytext.insert(0, text);
		const update = Y.encodeStateAsUpdate(ydoc);
		try {
			await api.documents.init(libraryId(), fileId(), { update: toBase64(update) });
			lastSeq = 1;
			seeded = true;
		} catch (err) {
			if (err instanceof ApiError && err.status === 409) {
				// Lost the race — throw away the local doc entirely (its inserts
				// would duplicate the winner's content on merge) and resync.
				resetDoc();
				const winner =
					err.data && (err.data as unknown as DocState).exists !== undefined
						? (err.data as unknown as DocState)
						: await api.documents.get(libraryId(), fileId());
				role = winner.role ?? role;
				applyState(winner); // sets seeded = true
				return;
			}
			throw err;
		}
	}

	/** Viewer path for an unseeded doc: provisional local content, nothing
	 * posted. seeded stays false so the first canonical update triggers an
	 * adopt-the-winner resync instead of merging (which would duplicate). */
	function seedLocalOnly(text: string) {
		if (text) ytext.insert(0, text);
		lastSeq = 0;
		seeded = false;
	}

	function resetDoc() {
		awareness.destroy();
		ydoc.destroy();
		ydoc = new Y.Doc();
		ytext = ydoc.getText('content');
		awareness = new awarenessProtocol.Awareness(ydoc);
	}

	/** True for the 409 the server returns once a document's CRDT state was
	 * dropped (replaced by a non-CRDT writer, e.g. the MCP tools). */
	function isDocResetError(err: unknown): boolean {
		if (!(err instanceof ApiError) || err.status !== 409) return false;
		const dataMsg = (err.data as { message?: string } | null)?.message ?? '';
		return /not initialized/i.test(`${err.message} ${dataMsg}`);
	}

	/** Rebuild from the server after a reset: the document was intentionally
	 * replaced, so local unposted edits are superseded (like a file overwrite).
	 * Bumps `generation` so the editor rebinds to the fresh Y.Doc. */
	async function resync(): Promise<void> {
		if (resyncing || disposed) return;
		resyncing = true;
		try {
			if (flushTimer) {
				clearTimeout(flushTimer);
				flushTimer = null;
			}
			buffer = [];
			firstBufferedAt = 0;
			pendingCount = 0;
			lastSeq = 0;
			seeded = false;
			hadLocalFlush = false;
			resetDoc();
			const state = await api.documents.get(libraryId(), fileId());
			role = state.role ?? role;
			if (state.exists) {
				applyState(state);
			} else if (role === 'editor') {
				await seedFromText(state.text ?? '');
			} else {
				seedLocalOnly(state.text ?? '');
			}
			attachDocListeners();
			setupAwareness();
			generation++;
			contentVersion++;
			online = true;
		} catch {
			// The next poll/frame retries.
		} finally {
			resyncing = false;
		}
	}

	// ── Local edits → debounced merged POSTs ─────────────────────────────

	function attachDocListeners() {
		ydoc.on('update', (update: Uint8Array, origin: unknown) => {
			contentVersion++;
			if (origin === REMOTE_ORIGIN) return;
			if (role !== 'editor') return;
			buffer.push(update);
			pendingCount = buffer.length;
			if (!firstBufferedAt) firstBufferedAt = Date.now();
			scheduleFlush();
		});
	}

	function scheduleFlush() {
		if (flushTimer) clearTimeout(flushTimer);
		const waited = Date.now() - firstBufferedAt;
		const delay = Math.max(0, Math.min(FLUSH_DEBOUNCE_MS, FLUSH_MAX_WAIT_MS - waited));
		flushTimer = setTimeout(() => {
			flushTimer = null;
			void flush();
		}, delay);
	}

	async function flush(): Promise<void> {
		if (inflight || buffer.length === 0 || disposed) return;
		inflight = true;
		const toSend = buffer.length === 1 ? buffer[0] : Y.mergeUpdates(buffer);
		buffer = [];
		firstBufferedAt = 0;
		pendingCount = 1;
		try {
			const { seq } = await api.documents.postUpdate(libraryId(), fileId(), {
				data: toBase64(toSend)
			});
			noteWriteAck(seq);
			online = true;
			retryAttempt = 0;
			hadLocalFlush = true;
			pendingCount = buffer.length;
			armCompaction();
			inflight = false;
			if (buffer.length > 0) scheduleFlush();
		} catch (err) {
			if (isDocResetError(err)) {
				// The document was replaced server-side — this update belongs
				// to the discarded state; resync instead of retrying.
				inflight = false;
				void resync();
				return;
			}
			// Keep the merged update at the front so nothing is lost; retry
			// with backoff. This is the in-session offline buffer.
			buffer.unshift(toSend);
			pendingCount = buffer.length;
			online = false;
			inflight = false;
			retryAttempt++;
			const delay = Math.min(RETRY_MAX_MS, 1000 * Math.pow(2, retryAttempt - 1));
			if (flushTimer) clearTimeout(flushTimer);
			flushTimer = setTimeout(() => {
				flushTimer = null;
				void flush();
			}, delay);
		}
	}

	// ── Remote updates: WS fast path + HTTP replay ───────────────────────

	/** Fold a write ack's server-assigned seq into lastSeq WITHOUT breaking the
	 * contiguous-prefix invariant. A gap (seq > lastSeq+1) means a concurrent
	 * editor's update landed between our reads and our write — do NOT jump
	 * lastSeq; replay pulls the intervening updates (our own echoed update
	 * re-applies idempotently in Yjs). Jumping lastSeq here would silently drop
	 * that concurrent edit and then let a compaction prune it — permanent
	 * multi-user data loss. */
	function noteWriteAck(seq: number): void {
		if (seq === lastSeq + 1) {
			lastSeq = seq;
		} else if (seq > lastSeq + 1) {
			void replay();
		}
		// seq <= lastSeq: already covered — no-op.
	}

	function applyRemote(seq: number, data: string) {
		// Provisional local content (unseeded viewer): the doc just became
		// canonically seeded — adopt it wholesale instead of merging onto our
		// local seed (which would duplicate the content).
		if (!seeded) {
			void resync();
			return;
		}
		if (seq <= lastSeq) return; // duplicate/echo
		if (seq === lastSeq + 1) {
			// Advance even if the payload was undecodable (best-effort): a
			// poison-pill update must not stall every later frame behind a gap.
			applyRemoteUpdate(data);
			lastSeq = seq;
			return;
		}
		void replay(); // gap — recover from the log
	}

	async function replay(): Promise<void> {
		if (disposed) return;
		if (replaying) {
			replayAgain = true;
			return;
		}
		replaying = true;
		try {
			for (;;) {
				const page = await api.documents.updatesSince(libraryId(), fileId(), lastSeq);
				// A successful page while we hold no canonical state means the
				// doc was just seeded — adopt it rather than layering updates
				// onto provisional local content (which would duplicate).
				if (!seeded) {
					void resync();
					return;
				}
				for (const u of page.updates) {
					if (u.seq <= lastSeq) continue;
					applyRemoteUpdate(u.data);
					lastSeq = u.seq;
				}
				if (!page.hasMore && !replayAgain) break;
				replayAgain = false;
			}
		} catch (err) {
			if (isDocResetError(err)) {
				// 409 "not initialized": a seeded doc was reset (resync); a
				// provisional viewer's doc just isn't seeded yet — no-op, which
				// avoids a resync churn loop while waiting for an editor to seed.
				if (seeded) void resync();
				return;
			}
			// Poll/reconnect paths will retry.
		} finally {
			replaying = false;
		}
	}

	function connect() {
		if (!browser || disposed) return;
		if (ws && ws.readyState === WS_OPEN) return;
		wsClosed = false;
		let socket: WebSocket;
		try {
			socket = createSocket(api.documents.wsUrl(libraryId(), fileId()));
		} catch {
			scheduleReconnect();
			return;
		}
		ws = socket;
		if (wsConnectTimer) clearTimeout(wsConnectTimer);
		wsConnectTimer = setTimeout(() => {
			wsConnectTimer = null;
			if (socket.readyState !== WS_OPEN) {
				try {
					socket.close(); // fires close → reconnect backoff; polling covers reads
				} catch {
					// ignore
				}
			}
		}, WS_CONNECT_TIMEOUT_MS);
		socket.addEventListener('open', () => {
			connected = true;
			reconnectAttempt = 0;
			if (wsConnectTimer) {
				clearTimeout(wsConnectTimer);
				wsConnectTimer = null;
			}
			stopPolling();
			broadcastLocalAwareness();
		});
		socket.addEventListener('message', (ev) => {
			try {
				const frame = JSON.parse((ev as MessageEvent).data as string);
				switch (frame?.type) {
					case 'hello':
						if (typeof frame.seq === 'number' && frame.seq > lastSeq) void replay();
						break;
					case 'update':
						applyRemote(frame.seq, frame.data);
						break;
					case 'awareness':
						awarenessProtocol.applyAwarenessUpdate(
							awareness,
							fromBase64(frame.data),
							REMOTE_ORIGIN
						);
						break;
					case 'reset':
						void resync();
						break;
					case 'ping':
						socket.send(JSON.stringify({ type: 'pong' }));
						break;
				}
			} catch {
				// ignore malformed frame
			}
		});
		socket.addEventListener('close', () => {
			connected = false;
			ws = null;
			if (!wsClosed) {
				scheduleReconnect();
				startPolling();
			}
		});
		socket.addEventListener('error', () => {
			try {
				socket.close();
			} catch {
				// ignore
			}
		});
	}

	function scheduleReconnect() {
		if (wsClosed || disposed) return;
		reconnectAttempt++;
		const base = Math.min(RECONNECT_MAX_MS, 1000 * Math.pow(2, reconnectAttempt - 1));
		const delay = base * (0.75 + Math.random() * 0.5);
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;
			connect();
		}, delay);
	}

	/** WS-less fallback: poll the replay endpoint so edits keep streaming in
	 * (e.g. single-port deployments where the proxy can't upgrade). */
	function startPolling() {
		if (pollTimer || disposed) return;
		pollTimer = setInterval(() => void replay(), POLL_INTERVAL_MS);
	}

	function stopPolling() {
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
	}

	// ── Awareness (presence/cursors) ─────────────────────────────────────

	function setupAwareness() {
		// Re-runnable across resyncs: the fresh Awareness starts with no
		// listeners, but the rebroadcast interval must not double up.
		if (awarenessRebroadcast) {
			clearInterval(awarenessRebroadcast);
			awarenessRebroadcast = null;
		}
		const user = opts.getUser();
		if (user) {
			const { color, colorLight } = userColor(user.id);
			awareness.setLocalStateField('user', {
				name: user.name,
				color,
				colorLight,
				userId: user.id
			});
		}
		awareness.on(
			'update',
			({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
				rebuildPeers();
				// Broadcast only our own state changes; remote applies carry
				// remote client ids and must not echo.
				const changed = [...added, ...updated, ...removed];
				if (changed.includes(ydoc.clientID)) queueAwarenessSend();
			}
		);
		awarenessRebroadcast = setInterval(() => {
			// y-protocols prunes peers silent >30s; keep our presence alive.
			if (awareness.getLocalState() !== null) queueAwarenessSend();
		}, AWARENESS_REBROADCAST_MS);
	}

	function queueAwarenessSend() {
		if (awarenessSendTimer) return;
		awarenessSendTimer = setTimeout(() => {
			awarenessSendTimer = null;
			broadcastLocalAwareness();
		}, AWARENESS_THROTTLE_MS);
	}

	function broadcastLocalAwareness() {
		if (!ws || ws.readyState !== WS_OPEN) return;
		const data = awarenessProtocol.encodeAwarenessUpdate(awareness, [ydoc.clientID]);
		ws.send(JSON.stringify({ type: 'awareness', data: toBase64(data) }));
	}

	function rebuildPeers() {
		const next: DocPeer[] = [];
		for (const [clientId, s] of awareness.getStates()) {
			if (clientId === ydoc.clientID) continue;
			const user = (s as { user?: { name?: string; color?: string; userId?: string } }).user;
			if (!user) continue;
			next.push({
				clientId,
				userId: user.userId ?? '',
				name: user.name ?? 'Someone',
				color: user.color ?? '#888888'
			});
		}
		peers = next;
	}

	// ── Compaction + materialization ─────────────────────────────────────

	function armCompaction() {
		if (compactTimer || role !== 'editor' || disposed) return;
		compactTimer = setTimeout(() => {
			compactTimer = null;
			void compact();
		}, COMPACT_AFTER_MS);
	}

	async function compact(opts2?: { keepalive?: boolean }): Promise<void> {
		if (role !== 'editor' || !hadLocalFlush || lastSeq === 0) return;
		if (!opts2?.keepalive && (buffer.length > 0 || inflight)) {
			// Mid-typing — wait for a quiet moment.
			compactTimer = setTimeout(() => {
				compactTimer = null;
				void compact();
			}, COMPACT_BUSY_RETRY_MS);
			return;
		}
		try {
			await api.documents.snapshot(
				libraryId(),
				fileId(),
				{
					snapshot: toBase64(Y.encodeStateAsUpdate(ydoc)),
					upTo: lastSeq,
					text: ytext.toString()
				},
				opts2
			);
		} catch {
			// 409 = someone else compacted (or nothing new) — benign. Other
			// failures are recovered by the next cycle; the update log is
			// never lost.
		}
	}

	// ── Teardown ─────────────────────────────────────────────────────────

	function dispose() {
		if (disposed) return;
		disposed = true;
		if (flushTimer) clearTimeout(flushTimer);
		if (compactTimer) clearTimeout(compactTimer);
		if (reconnectTimer) clearTimeout(reconnectTimer);
		if (wsConnectTimer) clearTimeout(wsConnectTimer);
		if (awarenessSendTimer) clearTimeout(awarenessSendTimer);
		if (awarenessRebroadcast) clearInterval(awarenessRebroadcast);
		stopPolling();

		// Best-effort final writes. keepalive lets the request outlive the page
		// (a plain fetch is killed on tab close). noteWriteAck keeps lastSeq a
		// safe contiguous cursor so the follow-up compaction can't prune a
		// concurrent editor's update that we haven't applied.
		if (role === 'editor' && buffer.length > 0) {
			const toSend = buffer.length === 1 ? buffer[0] : Y.mergeUpdates(buffer);
			buffer = [];
			void api.documents
				.postUpdate(libraryId(), fileId(), { data: toBase64(toSend) }, { keepalive: true })
				.then(({ seq }) => {
					noteWriteAck(seq); // disposed → won't replay; only advances if contiguous
					hadLocalFlush = true;
				})
				.then(() => compact({ keepalive: true }))
				.catch(() => {});
		} else if (role === 'editor' && hadLocalFlush) {
			void compact({ keepalive: true });
		}

		// Announce departure so remote cursors disappear immediately.
		awareness.setLocalState(null);
		broadcastLocalAwareness();

		wsClosed = true;
		if (ws) {
			try {
				ws.close();
			} catch {
				// ignore
			}
			ws = null;
		}
		connected = false;
		awareness.destroy();
		ydoc.destroy();
	}

	return {
		get ydoc() {
			return ydoc;
		},
		get ytext() {
			return ytext;
		},
		get awareness() {
			return awareness;
		},
		get loaded() {
			return loaded;
		},
		get generation() {
			return generation;
		},
		get role() {
			return role;
		},
		get connected() {
			return connected;
		},
		get online() {
			return online;
		},
		get pendingCount() {
			return pendingCount;
		},
		get contentVersion() {
			return contentVersion;
		},
		get peers() {
			return peers;
		},
		get loadError() {
			return loadError;
		},
		get statusLabel() {
			return statusLabel;
		},
		load,
		dispose,
		/** Exposed for tests. */
		flushNow: flush,
		compactNow: compact
	};
}

export type DocProvider = ReturnType<typeof createDocProvider>;
