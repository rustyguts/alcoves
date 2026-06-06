import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApi } from './client';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];

const fetchStub = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
	calls.push({
		url: String(url),
		method: init?.method ?? 'GET',
		body: init?.body
	});
	return new Response('{}', { headers: { 'content-type': 'application/json' } });
}) as unknown as typeof globalThis.fetch;

const api = createApi(fetchStub);
const last = () => calls[calls.length - 1];

beforeEach(() => {
	calls = [];
});

describe('createApi — auth', () => {
	it('maps every auth method to method + path', async () => {
		await api.auth.session();
		expect(last()).toMatchObject({ url: '/api/_auth/session', method: 'GET' });
		await api.auth.login({ email: 'a@b.c', password: 'x' });
		expect(last()).toMatchObject({ url: '/api/auth/login', method: 'POST' });
		expect(last().body).toBe('{"email":"a@b.c","password":"x"}');
		await api.auth.register({ name: 'n', email: 'e', password: 'p' });
		expect(last()).toMatchObject({ url: '/api/auth/register', method: 'POST' });
		await api.auth.logout();
		expect(last()).toMatchObject({ url: '/api/auth/logout', method: 'POST' });
		await api.auth.updateMe({ displayName: 'N' });
		expect(last()).toMatchObject({ url: '/api/auth/me', method: 'PATCH' });
		await api.auth.uploadAvatar(new FormData());
		expect(last()).toMatchObject({ url: '/api/auth/me/avatar', method: 'POST' });
		await api.auth.listSessions();
		expect(last()).toMatchObject({ url: '/api/auth/sessions', method: 'GET' });
		await api.auth.revokeSession('s1');
		expect(last()).toMatchObject({ url: '/api/auth/sessions/s1', method: 'DELETE' });
		await api.auth.providers();
		expect(last()).toMatchObject({ url: '/api/auth/providers', method: 'GET' });
		await api.auth.listTokens();
		expect(last()).toMatchObject({ url: '/api/auth/tokens', method: 'GET' });
		await api.auth.createToken({ name: 't' });
		expect(last()).toMatchObject({ url: '/api/auth/tokens', method: 'POST' });
		await api.auth.revokeToken('t1');
		expect(last()).toMatchObject({ url: '/api/auth/tokens/t1', method: 'DELETE' });
	});
});

describe('createApi — libraries', () => {
	it('maps library methods', async () => {
		await api.libraries.list();
		expect(last()).toMatchObject({ url: '/api/libraries', method: 'GET' });
		await api.libraries.create({ name: 'L' });
		expect(last()).toMatchObject({ url: '/api/libraries', method: 'POST' });
		await api.libraries.get('L1');
		expect(last()).toMatchObject({ url: '/api/libraries/L1', method: 'GET' });
		await api.libraries.update('L1', { name: 'x' });
		expect(last()).toMatchObject({ url: '/api/libraries/L1', method: 'PATCH' });
		await api.libraries.delete('L1');
		expect(last()).toMatchObject({ url: '/api/libraries/L1', method: 'DELETE' });
		await api.libraries.timeline('L1', { type: 'media', limit: '50' });
		expect(last().url).toBe('/api/libraries/L1/timeline?type=media&limit=50');
		await api.libraries.timelineHistogram('L1', { type: 'all' });
		expect(last().url).toBe('/api/libraries/L1/timeline/histogram?type=all');
		await api.libraries.map('L1');
		expect(last()).toMatchObject({ url: '/api/libraries/L1/map', method: 'GET' });
		await api.libraries.feed('L1', { cursor: 'c1' });
		expect(last().url).toBe('/api/libraries/L1/feed?cursor=c1');
		await api.libraries.metadataReprocess('L1');
		expect(last()).toMatchObject({ url: '/api/libraries/L1/metadata/reprocess', method: 'POST' });
	});
});

describe('createApi — files', () => {
	it('maps file methods', async () => {
		await api.files.list('L', { folder: 'F', trashed: 'true' });
		expect(last().url).toBe('/api/libraries/L/files?folder=F&trashed=true');
		await api.files.get('L', 'F1');
		expect(last()).toMatchObject({ url: '/api/libraries/L/files/F1', method: 'GET' });
		await api.files.update('L', 'F1', { name: 'n' });
		expect(last()).toMatchObject({ url: '/api/libraries/L/files/F1', method: 'PATCH' });
		await api.files.delete('L', 'F1', { fileIds: ['a'] });
		expect(last()).toMatchObject({ url: '/api/libraries/L/files/F1', method: 'DELETE' });
		await api.files.restore('L', { fileIds: ['a'] });
		expect(last()).toMatchObject({ url: '/api/libraries/L/files/restore', method: 'POST' });
		await api.files.purge('L', { fileIds: ['a'] });
		expect(last()).toMatchObject({ url: '/api/libraries/L/files/purge', method: 'POST' });
		await api.files.playbackSources('L', 'F1');
		expect(last().url).toBe('/api/libraries/L/files/F1/playback-sources');
		await api.files.generateProxy('L', 'F1');
		expect(last()).toMatchObject({ url: '/api/libraries/L/files/F1/proxy', method: 'POST' });
		await api.files.transcribe('L', 'F1');
		expect(last()).toMatchObject({ url: '/api/libraries/L/files/F1/transcribe', method: 'POST' });
		await api.files.transcript('L', 'F1');
		expect(last().url).toBe('/api/libraries/L/files/F1/transcript');
		await api.files.generateWaveform('L', 'F1');
		expect(last()).toMatchObject({ url: '/api/libraries/L/files/F1/waveform', method: 'POST' });
		await api.files.waveform('L', 'F1');
		expect(last()).toMatchObject({ url: '/api/libraries/L/files/F1/waveform', method: 'GET' });
		await api.files.audioDetect('L', 'F1');
		expect(last()).toMatchObject({ url: '/api/libraries/L/files/F1/audio-detect', method: 'POST' });
		await api.files.audioDetections('L', 'F1');
		expect(last().url).toBe('/api/libraries/L/files/F1/audio-detections');
		await api.files.bulkTranscribe('L', ['a']);
		expect(last()).toMatchObject({ url: '/api/libraries/L/files/bulk-transcribe', method: 'POST' });
		expect(last().body).toBe('{"fileIds":["a"]}');
		await api.files.bulkTranscribe('L');
		expect(last().body).toBe('{"fileIds":[]}');
		await api.files.bulkAudioDetect('L', ['a']);
		expect(last().url).toBe('/api/libraries/L/files/bulk-audio-detect');
		await api.files.reprocessVideoThumbnails('L');
		expect(last().url).toBe('/api/libraries/L/files/video-thumbnails/reprocess');
	});
});

describe('createApi — folders / tags / highlightFilters', () => {
	it('maps folder methods', async () => {
		await api.folders.list('L');
		expect(last().url).toBe('/api/libraries/L/folders');
		await api.folders.create('L', { name: 'n' });
		expect(last()).toMatchObject({ url: '/api/libraries/L/folders', method: 'POST' });
		await api.folders.update('L', 'D1', { name: 'n' });
		expect(last()).toMatchObject({ url: '/api/libraries/L/folders/D1', method: 'PATCH' });
		await api.folders.delete('L', 'D1');
		expect(last()).toMatchObject({ url: '/api/libraries/L/folders/D1', method: 'DELETE' });
		await api.folders.move('L', 'D1', { parentFolderId: null });
		expect(last()).toMatchObject({ url: '/api/libraries/L/folders/D1/move', method: 'POST' });
		await api.folders.restore('L', { folderIds: ['a'] });
		expect(last().url).toBe('/api/libraries/L/folders/restore');
	});

	it('maps tag methods', async () => {
		await api.tags.list('L');
		expect(last().url).toBe('/api/libraries/L/tags');
		await api.tags.create('L', { name: 'n' });
		expect(last()).toMatchObject({ url: '/api/libraries/L/tags', method: 'POST' });
		await api.tags.update('L', 'T1', { color: '#fff' });
		expect(last()).toMatchObject({ url: '/api/libraries/L/tags/T1', method: 'PATCH' });
		await api.tags.delete('L', 'T1');
		expect(last()).toMatchObject({ url: '/api/libraries/L/tags/T1', method: 'DELETE' });
		await api.tags.syncFileTags('L', 'F1', { tagIds: ['a'] });
		expect(last()).toMatchObject({ url: '/api/libraries/L/files/F1/tags', method: 'PUT' });
		await api.tags.syncFolderTags('L', 'D1', { tagIds: ['a'] });
		expect(last()).toMatchObject({ url: '/api/libraries/L/folders/D1/tags', method: 'PUT' });
	});

	it('maps highlightFilter methods', async () => {
		await api.highlightFilters.list('L');
		expect(last().url).toBe('/api/libraries/L/highlight-filters');
		await api.highlightFilters.create('L', { name: 'n', expression: 'e' });
		expect(last()).toMatchObject({ url: '/api/libraries/L/highlight-filters', method: 'POST' });
		await api.highlightFilters.update('L', 'H1', { name: 'x' });
		expect(last()).toMatchObject({ url: '/api/libraries/L/highlight-filters/H1', method: 'PATCH' });
		await api.highlightFilters.remove('L', 'H1');
		expect(last()).toMatchObject({
			url: '/api/libraries/L/highlight-filters/H1',
			method: 'DELETE'
		});
	});
});

describe('createApi — members / people / objects / downloads', () => {
	it('maps member methods', async () => {
		await api.members.list('L');
		expect(last().url).toBe('/api/libraries/L/users');
		await api.members.createInviteLink('L');
		expect(last()).toMatchObject({ url: '/api/libraries/L/users/invite-link', method: 'POST' });
		expect(last().body).toBe('{}');
		await api.members.createInviteLink('L', { maxUses: 5 });
		expect(last().body).toBe('{"maxUses":5}');
		await api.members.updateRole('L', 'U1', { role: 'admin' });
		expect(last()).toMatchObject({ url: '/api/libraries/L/users/U1', method: 'PATCH' });
		await api.members.remove('L', 'U1');
		expect(last()).toMatchObject({ url: '/api/libraries/L/users/U1', method: 'DELETE' });
		await api.members.revokeInvite('L', 'I1');
		expect(last()).toMatchObject({ url: '/api/libraries/L/users/invites/I1', method: 'DELETE' });
	});

	it('maps people methods and builds the thumbnail URL', async () => {
		await api.people.list('L');
		expect(last().url).toBe('/api/libraries/L/people');
		await api.people.update('L', 'P1', { name: 'n' });
		expect(last()).toMatchObject({ url: '/api/libraries/L/people/P1', method: 'PATCH' });
		await api.people.listFaces('L', 'P1');
		expect(last().url).toBe('/api/libraries/L/people/P1/faces');
		await api.people.splitFace('L', 'P1', 'C1', { name: 'n' });
		expect(last()).toMatchObject({
			url: '/api/libraries/L/people/P1/faces/C1/split',
			method: 'POST'
		});
		await api.people.merge('L', { personIds: ['a', 'b'] });
		expect(last()).toMatchObject({ url: '/api/libraries/L/people/merge', method: 'POST' });
		await api.people.reprocess('L');
		expect(last().url).toBe('/api/libraries/L/face-recognition/reprocess');
		expect(api.people.thumbnailUrl('L', 'P1')).toBe('/api/libraries/L/people/P1/thumbnail');
		expect(api.people.thumbnailUrl('L', 'P1', 'v2')).toBe(
			'/api/libraries/L/people/P1/thumbnail?v=v2'
		);
	});

	it('maps object + download methods and builds the download URL', async () => {
		await api.objects.labels('L');
		expect(last().url).toBe('/api/libraries/L/objects/labels');
		await api.objects.reprocess('L');
		expect(last().url).toBe('/api/libraries/L/object-detection/reprocess');
		await api.downloads.estimate('L', { fileIds: ['a'], folderIds: [] });
		expect(last()).toMatchObject({ url: '/api/libraries/L/download-estimate', method: 'POST' });
		expect(api.downloads.url('L')).toBe('/api/libraries/L/download');
	});
});

describe('createApi — search / invites / admin / meta', () => {
	it('maps search + invites + meta', async () => {
		await api.search.query({ q: 'cat', limit: '10' });
		expect(last().url).toBe('/api/search?q=cat&limit=10');
		await api.invites.lookup('TK');
		expect(last().url).toBe('/api/invites/TK');
		await api.invites.accept('TK');
		expect(last()).toMatchObject({ url: '/api/invites/TK/accept', method: 'POST' });
		await api.meta.registrationMode();
		expect(last().url).toBe('/api/_meta/registration-mode');
	});

	it('maps admin methods (encoding queue names)', async () => {
		await api.admin.stats();
		expect(last().url).toBe('/api/admin/stats');
		await api.admin.listUsers();
		expect(last().url).toBe('/api/admin/users');
		await api.admin.updateUserRole('U1', { role: 'owner' });
		expect(last()).toMatchObject({ url: '/api/admin/users/U1', method: 'PATCH' });
		await api.admin.getSettings();
		expect(last().url).toBe('/api/admin/settings');
		await api.admin.updateSettings({ registration_mode: 'open' });
		expect(last()).toMatchObject({ url: '/api/admin/settings', method: 'PATCH' });
		await api.admin.controlJob('video-transcode', 'J1', { action: 'retry' });
		expect(last().url).toBe('/api/admin/jobs/video-transcode/J1');
		await api.admin.purgeQueue('image proxy');
		expect(last().url).toBe('/api/admin/jobs/image%20proxy/purge');
	});
});

describe('createApi — moments', () => {
	it('maps moment methods and builds the download URL', async () => {
		await api.moments.list('L', 'F1');
		expect(last().url).toBe('/api/libraries/L/files/F1/moments');
		await api.moments.create('L', 'F1', { startSeconds: 0, endSeconds: 1 });
		expect(last()).toMatchObject({ url: '/api/libraries/L/files/F1/moments', method: 'POST' });
		await api.moments.get('L', 'F1', 'M1');
		expect(last().url).toBe('/api/libraries/L/files/F1/moments/M1');
		await api.moments.update('L', 'F1', 'M1', { name: 'n' });
		expect(last()).toMatchObject({ url: '/api/libraries/L/files/F1/moments/M1', method: 'PATCH' });
		await api.moments.delete('L', 'F1', 'M1');
		expect(last()).toMatchObject({ url: '/api/libraries/L/files/F1/moments/M1', method: 'DELETE' });
		await api.moments.syncTags('L', 'F1', 'M1', ['t']);
		expect(last()).toMatchObject({
			url: '/api/libraries/L/files/F1/moments/M1/tags',
			method: 'PUT'
		});
		await api.moments.export('L', 'F1', 'M1');
		expect(last()).toMatchObject({
			url: '/api/libraries/L/files/F1/moments/M1/export',
			method: 'POST'
		});
		expect(api.moments.downloadUrl('L', 'F1', 'M1')).toBe(
			'/api/libraries/L/files/F1/moments/M1/download'
		);
		await api.moments.createShare('L', 'F1', 'M1');
		expect(last()).toMatchObject({
			url: '/api/libraries/L/files/F1/moments/M1/shares',
			method: 'POST'
		});
		await api.moments.listShares('L', 'F1', 'M1');
		expect(last().url).toBe('/api/libraries/L/files/F1/moments/M1/shares');
		await api.moments.revokeShare('L', 'F1', 'M1', 'TK');
		expect(last()).toMatchObject({
			url: '/api/libraries/L/files/F1/moments/M1/shares/TK',
			method: 'DELETE'
		});
	});
});
