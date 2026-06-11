import { describe, it, expect } from 'vitest';
import {
	groupActivities,
	formatActivity,
	relativeTime,
	type ActivityGroup
} from '$lib/utils/activity-format';
import type { Activity } from '$lib/types/api';

// Helper for creating Activity rows in tests. Use the `'actor' in over`
// check so callers can pass `actor: null` explicitly without it being
// overridden by the default.
function makeActivity(over: Partial<Activity> = {}): Activity {
	return {
		id: over.id ?? `id-${Math.random().toString(36).slice(2)}`,
		libraryId: over.libraryId ?? 'lib-1',
		libraryName: over.libraryName,
		actor:
			'actor' in over ? (over.actor ?? null) : { id: 'u1', displayName: 'Alice', avatarUrl: null },
		action: over.action ?? 'file.created',
		subjectType: over.subjectType ?? 'file',
		subjectId: 'subjectId' in over ? (over.subjectId ?? null) : 'f1',
		metadata: over.metadata ?? {},
		createdAt: over.createdAt ?? new Date().toISOString(),
		dismissed: over.dismissed ?? false
	};
}

const ISO = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

describe('groupActivities', () => {
	it('returns empty when given empty input', () => {
		expect(groupActivities([])).toEqual([]);
	});

	it('does not group two different actions', () => {
		const rows = [
			makeActivity({ id: '1', action: 'file.created', createdAt: ISO(0) }),
			makeActivity({ id: '2', action: 'folder.created', createdAt: ISO(1000) })
		];
		const groups = groupActivities(rows);
		expect(groups).toHaveLength(2);
	});

	it('groups two consecutive file.created from same actor + parent', () => {
		const rows = [
			makeActivity({
				id: '1',
				action: 'file.created',
				metadata: { parentFolderId: 'p1' },
				createdAt: ISO(0)
			}),
			makeActivity({
				id: '2',
				action: 'file.created',
				metadata: { parentFolderId: 'p1' },
				createdAt: ISO(60_000)
			})
		];
		const groups = groupActivities(rows);
		expect(groups).toHaveLength(1);
		expect(groups[0].items).toHaveLength(2);
		expect(groups[0].count).toBe(2);
	});

	it('does not group across actors', () => {
		const rows = [
			makeActivity({
				id: '1',
				actor: { id: 'A', displayName: 'A', avatarUrl: null },
				createdAt: ISO(0)
			}),
			makeActivity({
				id: '2',
				actor: { id: 'B', displayName: 'B', avatarUrl: null },
				createdAt: ISO(1000)
			})
		];
		expect(groupActivities(rows)).toHaveLength(2);
	});

	it('does not group across different parent folders', () => {
		const rows = [
			makeActivity({ id: '1', metadata: { parentFolderId: 'p1' }, createdAt: ISO(0) }),
			makeActivity({ id: '2', metadata: { parentFolderId: 'p2' }, createdAt: ISO(60_000) })
		];
		expect(groupActivities(rows)).toHaveLength(2);
	});

	it('does not group across different libraries', () => {
		const rows = [
			makeActivity({ id: '1', libraryId: 'lib-1', createdAt: ISO(0) }),
			makeActivity({ id: '2', libraryId: 'lib-2', createdAt: ISO(60_000) })
		];
		expect(groupActivities(rows)).toHaveLength(2);
	});

	it('does not group beyond the 5-minute window', () => {
		const rows = [
			makeActivity({ id: '1', createdAt: ISO(0) }),
			makeActivity({ id: '2', createdAt: ISO(6 * 60 * 1000) })
		];
		expect(groupActivities(rows)).toHaveLength(2);
	});

	it('does not group when a timestamp is unparseable (NaN window guard)', () => {
		const rows = [
			makeActivity({ id: '1', createdAt: 'not-a-date' }),
			makeActivity({ id: '2', createdAt: 'also-bad' })
		];
		expect(groupActivities(rows)).toHaveLength(2);
	});

	it('caps a group at 20 items', () => {
		const rows: Activity[] = [];
		for (let i = 0; i < 25; i++) {
			rows.push(makeActivity({ id: `i${i}`, createdAt: ISO(i * 1000) }));
		}
		const groups = groupActivities(rows);
		expect(groups[0].items.length).toBe(20);
		expect(groups.length).toBeGreaterThan(1);
	});

	it('does not merge a non-mergeable action even when consecutive', () => {
		const rows = [
			makeActivity({ id: '1', action: 'folder.renamed', createdAt: ISO(0) }),
			makeActivity({ id: '2', action: 'folder.renamed', createdAt: ISO(1000) })
		];
		expect(groupActivities(rows)).toHaveLength(2);
	});

	it('never groups system events', () => {
		const rows = [
			makeActivity({ id: '1', actor: null, action: 'system.waveform_ready', createdAt: ISO(0) }),
			makeActivity({ id: '2', actor: null, action: 'system.waveform_ready', createdAt: ISO(1000) })
		];
		expect(groupActivities(rows)).toHaveLength(2);
	});

	it('groups consecutive rows from two actorless rows (null actor ids match)', () => {
		const rows = [
			makeActivity({ id: '1', actor: null, action: 'file.created', createdAt: ISO(0) }),
			makeActivity({ id: '2', actor: null, action: 'file.created', createdAt: ISO(1000) })
		];
		const groups = groupActivities(rows);
		expect(groups).toHaveLength(1);
		expect(groups[0].items).toHaveLength(2);
	});

	it('sums metadata.count across file.deleted bulk rows', () => {
		const rows = [
			makeActivity({ id: '1', action: 'file.deleted', metadata: { count: 3 }, createdAt: ISO(0) }),
			makeActivity({
				id: '2',
				action: 'file.deleted',
				metadata: { count: 5 },
				createdAt: ISO(60_000)
			})
		];
		const groups = groupActivities(rows);
		expect(groups).toHaveLength(1);
		expect(groups[0].count).toBe(8);
	});

	it('treats a non-positive metadata.count as 1', () => {
		const rows = [
			makeActivity({ id: '1', action: 'file.deleted', metadata: { count: 0 }, createdAt: ISO(0) }),
			makeActivity({
				id: '2',
				action: 'file.deleted',
				metadata: { count: -4 },
				createdAt: ISO(60_000)
			})
		];
		const groups = groupActivities(rows);
		expect(groups).toHaveLength(1);
		expect(groups[0].count).toBe(2);
	});
});

describe('formatActivity', () => {
	function group(
		action: Activity['action'],
		over: Partial<Activity> = {},
		count = 1
	): ActivityGroup {
		const head = makeActivity({ action, ...over });
		const items: Activity[] = [head];
		for (let i = 1; i < count; i++) items.push(makeActivity({ action, ...over }));
		return { head, items, count };
	}

	it('formats single file.created with the file name', () => {
		const out = formatActivity(group('file.created', { metadata: { name: 'photo.jpg' } }));
		expect(out.text).toBe('Alice added photo.jpg');
		expect(out.icon).toMatch(/file-plus/);
	});

	it('falls back to "a file" for file.created without a name', () => {
		const out = formatActivity(group('file.created', { metadata: {} }));
		expect(out.text).toBe('Alice added a file');
	});

	it('formats bulk file.created as a count', () => {
		const out = formatActivity(group('file.created', {}, 5));
		expect(out.text).toBe('Alice added 5 files');
	});

	it('links bulk file.created to the parent folder from metadata', () => {
		const out = formatActivity(group('file.created', { metadata: { parentFolderId: 'pf1' } }, 4));
		expect(out.href).toBe('/libraries/lib-1?folderId=pf1');
	});

	it('links bulk file.created to a folder subject when present', () => {
		const out = formatActivity(
			group('file.created', { subjectType: 'folder', subjectId: 'fo9' }, 4)
		);
		expect(out.href).toBe('/libraries/lib-1?folderId=fo9');
	});

	it('links bulk file.created to the library root when no parent folder', () => {
		const out = formatActivity(group('file.created', {}, 4));
		expect(out.href).toBe('/libraries/lib-1');
	});

	it('provides a deep-link href for single file.created', () => {
		const out = formatActivity(group('file.created', { metadata: { name: 'n' } }));
		expect(out.href).toBe('/libraries/lib-1?fileId=f1');
	});

	it('returns a null file href when the subject is not a file', () => {
		const out = formatActivity(
			group('system.waveform_ready', { subjectType: 'folder', metadata: { fileName: 'x' } })
		);
		expect(out.href).toBeNull();
	});

	it('returns a null file href when the subjectId is missing', () => {
		const out = formatActivity(
			group('system.waveform_ready', { subjectId: null, metadata: { fileName: 'x' } })
		);
		expect(out.href).toBeNull();
	});

	it('formats single file.deleted with the file name and no href', () => {
		const out = formatActivity(group('file.deleted', { metadata: { name: 'n' } }));
		expect(out.text).toBe('Alice deleted n');
		expect(out.href).toBeNull();
	});

	it('falls back to "a file" for file.deleted without a name', () => {
		const out = formatActivity(group('file.deleted', { metadata: {} }));
		expect(out.text).toBe('Alice deleted a file');
	});

	it('formats bulk file.deleted as a count with no href', () => {
		const out = formatActivity(group('file.deleted', {}, 3));
		expect(out.text).toBe('Alice deleted 3 files');
		expect(out.href).toBeNull();
	});

	it('formats folder.created with a folder deep-link', () => {
		const out = formatActivity(
			group('folder.created', {
				subjectType: 'folder',
				subjectId: 'fo1',
				metadata: { name: 'Trips' }
			})
		);
		expect(out.text).toBe('Alice created folder Trips');
		expect(out.href).toBe('/libraries/lib-1?folderId=fo1');
	});

	it('formats folder.renamed showing old -> new', () => {
		const out = formatActivity(
			group('folder.renamed', { metadata: { oldName: 'x', newName: 'y' } })
		);
		expect(out.text).toContain('x');
		expect(out.text).toContain('y');
		expect(out.icon).toMatch(/pencil/);
	});

	it('falls back for folder.renamed without names', () => {
		const out = formatActivity(group('folder.renamed', { subjectType: 'folder', metadata: {} }));
		expect(out.text).toBe('Alice renamed a folder → ');
	});

	it('formats folder.deleted with no href', () => {
		const out = formatActivity(group('folder.deleted', { metadata: { name: 'Old' } }));
		expect(out.text).toBe('Alice deleted folder Old');
		expect(out.href).toBeNull();
	});

	it('formats tag.created linking to the tags page', () => {
		const out = formatActivity(group('tag.created', { metadata: { name: 'blue' } }));
		expect(out.text).toBe('Alice created tag blue');
		expect(out.href).toBe('/libraries/lib-1/tags');
	});

	it('formats moment.created with an editor deep-link', () => {
		const out = formatActivity(
			group('moment.created', { subjectId: 'm1', metadata: { name: 'Goal', fileId: 'f9' } })
		);
		expect(out.text).toBe('Alice created moment Goal');
		expect(out.href).toBe('/libraries/lib-1/edit/f9?momentId=m1');
	});

	it('formats moment.created, falling back to the library href without fileId', () => {
		const out = formatActivity(group('moment.created', { metadata: { name: 'Goal' } }));
		expect(out.href).toBe('/libraries/lib-1');
	});

	it('formats moment.shared with an editor deep-link', () => {
		const out = formatActivity(
			group('moment.shared', {
				subjectId: 'm1',
				metadata: { momentName: 'Clip', fileId: 'f9' }
			})
		);
		expect(out.text).toBe('Alice shared moment Clip');
		expect(out.href).toBe('/libraries/lib-1/edit/f9?momentId=m1');
	});

	it('formats moment.shared, falling back to the library href without fileId', () => {
		const out = formatActivity(group('moment.shared', { metadata: { momentName: 'Clip' } }));
		expect(out.text).toBe('Alice shared moment Clip');
		expect(out.href).toBe('/libraries/lib-1');
	});

	it('formats member.joined with the joiner display name and settings href', () => {
		const head = makeActivity({
			action: 'member.joined',
			actor: { id: 'u2', displayName: 'Bob', avatarUrl: null },
			metadata: { displayName: 'Bob' }
		});
		const out = formatActivity({ head, items: [head], count: 1 });
		expect(out.text).toBe('Bob joined');
		expect(out.href).toBe('/libraries/lib-1/settings');
	});

	it('formats member.joined falling back to the actor name', () => {
		const out = formatActivity(group('member.joined', { metadata: {} }));
		expect(out.text).toBe('Alice joined');
	});

	it('formats member.removed', () => {
		const out = formatActivity(group('member.removed', { metadata: { displayName: 'Bob' } }));
		expect(out.text).toBe('Alice removed Bob');
		expect(out.href).toBe('/libraries/lib-1/settings');
	});

	it('formats member.removed falling back to "a member"', () => {
		const out = formatActivity(group('member.removed', { metadata: {} }));
		expect(out.text).toBe('Alice removed a member');
	});

	it('formats system.waveform_ready without an actor name', () => {
		const head = makeActivity({
			action: 'system.waveform_ready',
			actor: null,
			metadata: { fileName: 'song.mp3' }
		});
		const out = formatActivity({ head, items: [head], count: 1 });
		expect(out.text).toBe('Waveform ready for song.mp3');
		expect(out.icon).toMatch(/pulse/);
	});

	it('formats system.waveform_ready falling back to "a file"', () => {
		const out = formatActivity(group('system.waveform_ready', { actor: null, metadata: {} }));
		expect(out.text).toBe('Waveform ready for a file');
	});

	it('formats system.transcribe_ready and system.video_proxy_ready', () => {
		expect(
			formatActivity(group('system.transcribe_ready', { metadata: { fileName: 'a.mp4' } })).text
		).toBe('Transcript ready for a.mp4');
		expect(
			formatActivity(group('system.video_proxy_ready', { metadata: { fileName: 'b.mp4' } })).text
		).toBe('Video processed for b.mp4');
	});

	it('falls back to "a file" for system.transcribe_ready / video_proxy_ready without a name', () => {
		expect(formatActivity(group('system.transcribe_ready', { metadata: {} })).text).toBe(
			'Transcript ready for a file'
		);
		expect(formatActivity(group('system.video_proxy_ready', { metadata: {} })).text).toBe(
			'Video processed for a file'
		);
	});

	it('falls back to a generic bell for unknown actions', () => {
		const out = formatActivity(group('something.weird' as Activity['action']));
		expect(out.icon).toMatch(/bell/);
		expect(out.text).toContain('something.weird');
		expect(out.href).toBeNull();
	});

	it("uses 'System' when there is no actor", () => {
		const out = formatActivity(group('file.deleted', { actor: null, metadata: { name: 'x' } }));
		expect(out.text).toBe('System deleted x');
	});

	it('treats null metadata as an empty object', () => {
		const head = makeActivity({ action: 'file.created' });
		// Force metadata to null to hit the `?? {}` fallback branch.
		(head as { metadata: unknown }).metadata = null;
		const out = formatActivity({ head, items: [head], count: 1 });
		expect(out.text).toBe('Alice added a file');
	});
});

describe('relativeTime', () => {
	it('formats seconds ago', () => {
		const now = Date.parse('2026-01-01T00:00:30Z');
		const t = '2026-01-01T00:00:00Z';
		expect(relativeTime(t, now)).toBe('30s');
	});

	it('formats minutes ago', () => {
		const now = Date.parse('2026-01-01T00:05:00Z');
		const t = '2026-01-01T00:00:00Z';
		expect(relativeTime(t, now)).toBe('5m');
	});

	it('uses Date.now() as the default reference', () => {
		const out = relativeTime(new Date().toISOString());
		expect(out).toMatch(/^\d+s$/);
	});

	it('returns empty string on bad input', () => {
		expect(relativeTime('not-a-date')).toBe('');
	});
});

describe('relativeTime — unit ladder', () => {
	const base = Date.parse('2026-06-01T00:00:00Z');
	const ago = (seconds: number) =>
		relativeTime(new Date(base - seconds * 1000).toISOString(), base);

	it('climbs through m/h/d/w/mo/y', () => {
		expect(ago(90)).toBe('1m');
		expect(ago(3 * 3600)).toBe('3h');
		expect(ago(2 * 86400)).toBe('2d');
		expect(ago(14 * 86400)).toBe('2w');
		expect(ago(60 * 86400)).toMatch(/mo$/);
		expect(ago(400 * 86400)).toMatch(/y$/);
	});

	it('returns a year-capped value for very old timestamps', () => {
		expect(ago(4000 * 86400)).toMatch(/y$/);
	});

	it('clamps future timestamps to 0s', () => {
		expect(relativeTime(new Date(base + 5000).toISOString(), base)).toBe('0s');
	});
});
