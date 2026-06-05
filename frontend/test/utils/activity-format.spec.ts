import { describe, it, expect } from "vitest";
import {
  groupActivities,
  formatActivity,
  relativeTime,
  type ActivityGroup,
} from "~/utils/activity-format";
import type { Activity } from "~~/shared/types/api";

// Helper for creating Activity rows in tests.
function makeActivity(over: Partial<Activity> = {}): Activity {
  return {
    id: over.id ?? `id-${Math.random().toString(36).slice(2)}`,
    libraryId: over.libraryId ?? "lib-1",
    libraryName: over.libraryName,
    actor: over.actor ?? { id: "u1", displayName: "Alice", avatarUrl: null },
    action: over.action ?? "file.created",
    subjectType: over.subjectType ?? "file",
    subjectId: over.subjectId ?? "f1",
    metadata: over.metadata ?? {},
    createdAt: over.createdAt ?? new Date().toISOString(),
    dismissed: over.dismissed ?? false,
  };
}

const ISO = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

describe("groupActivities", () => {
  it("returns empty when given empty input", () => {
    expect(groupActivities([])).toEqual([]);
  });

  it("does not group two different actions", () => {
    const rows = [
      makeActivity({ id: "1", action: "file.created", createdAt: ISO(0) }),
      makeActivity({ id: "2", action: "folder.created", createdAt: ISO(1000) }),
    ];
    const groups = groupActivities(rows);
    expect(groups).toHaveLength(2);
  });

  it("groups two consecutive file.created from same actor + parent", () => {
    const rows = [
      makeActivity({ id: "1", action: "file.created", metadata: { parentFolderId: "p1" }, createdAt: ISO(0) }),
      makeActivity({ id: "2", action: "file.created", metadata: { parentFolderId: "p1" }, createdAt: ISO(60_000) }),
    ];
    const groups = groupActivities(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[0].count).toBe(2);
  });

  it("does not group across actors", () => {
    const rows = [
      makeActivity({ id: "1", actor: { id: "A", displayName: "A", avatarUrl: null }, createdAt: ISO(0) }),
      makeActivity({ id: "2", actor: { id: "B", displayName: "B", avatarUrl: null }, createdAt: ISO(1000) }),
    ];
    expect(groupActivities(rows)).toHaveLength(2);
  });

  it("does not group across different parent folders", () => {
    const rows = [
      makeActivity({ id: "1", metadata: { parentFolderId: "p1" }, createdAt: ISO(0) }),
      makeActivity({ id: "2", metadata: { parentFolderId: "p2" }, createdAt: ISO(60_000) }),
    ];
    expect(groupActivities(rows)).toHaveLength(2);
  });

  it("does not group beyond the 5-minute window", () => {
    const rows = [
      makeActivity({ id: "1", createdAt: ISO(0) }),
      makeActivity({ id: "2", createdAt: ISO(6 * 60 * 1000) }),
    ];
    expect(groupActivities(rows)).toHaveLength(2);
  });

  it("caps a group at 20 items", () => {
    const rows: Activity[] = [];
    for (let i = 0; i < 25; i++) {
      rows.push(makeActivity({ id: `i${i}`, createdAt: ISO(i * 1000) }));
    }
    const groups = groupActivities(rows);
    expect(groups[0].items.length).toBe(20);
    expect(groups.length).toBeGreaterThan(1);
  });

  it("never groups system events", () => {
    const rows = [
      makeActivity({ id: "1", actor: null, action: "system.waveform_ready", createdAt: ISO(0) }),
      makeActivity({ id: "2", actor: null, action: "system.waveform_ready", createdAt: ISO(1000) }),
    ];
    expect(groupActivities(rows)).toHaveLength(2);
  });

  it("sums metadata.count across file.deleted bulk rows", () => {
    const rows = [
      makeActivity({ id: "1", action: "file.deleted", metadata: { count: 3 }, createdAt: ISO(0) }),
      makeActivity({ id: "2", action: "file.deleted", metadata: { count: 5 }, createdAt: ISO(60_000) }),
    ];
    const groups = groupActivities(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(8);
  });
});

describe("formatActivity", () => {
  function group(action: Activity["action"], metadata: Record<string, unknown> = {}, count = 1): ActivityGroup {
    const head = makeActivity({ action, metadata });
    const items: Activity[] = [head];
    for (let i = 1; i < count; i++) items.push(makeActivity({ action, metadata }));
    return { head, items, count };
  }

  it("formats single file.created with the file name", () => {
    const out = formatActivity(group("file.created", { name: "photo.jpg" }));
    expect(out.text).toBe("Alice added photo.jpg");
    expect(out.icon).toMatch(/file-plus/);
  });

  it("formats bulk file.created as a count", () => {
    const out = formatActivity(group("file.created", {}, 5));
    expect(out.text).toBe("Alice added 5 files");
  });

  it("formats system.waveform_ready without an actor name", () => {
    const head = makeActivity({
      action: "system.waveform_ready",
      actor: null,
      metadata: { fileName: "song.mp3" },
    });
    const out = formatActivity({ head, items: [head], count: 1 });
    expect(out.text).toBe("Waveform ready for song.mp3");
    expect(out.icon).toMatch(/pulse/);
  });

  it("formats folder.renamed showing old -> new", () => {
    const out = formatActivity(group("folder.renamed", { oldName: "x", newName: "y" }));
    expect(out.text).toContain("x");
    expect(out.text).toContain("y");
  });

  it("formats member.joined with the joiner's display name", () => {
    const head = makeActivity({
      action: "member.joined",
      actor: { id: "u2", displayName: "Bob", avatarUrl: null },
      metadata: { displayName: "Bob" },
    });
    const out = formatActivity({ head, items: [head], count: 1 });
    expect(out.text).toBe("Bob joined");
  });

  it("provides a deep-link href for file.created", () => {
    const out = formatActivity(group("file.created", { name: "n" }));
    expect(out.href).toMatch(/^\/libraries\//);
  });

  it("provides no href for file.deleted", () => {
    const out = formatActivity(group("file.deleted", { name: "n" }));
    expect(out.href).toBeNull();
  });
});

describe("relativeTime", () => {
  it("formats seconds ago", () => {
    const now = Date.parse("2026-01-01T00:00:30Z");
    const t = "2026-01-01T00:00:00Z";
    expect(relativeTime(t, now)).toBe("30s");
  });

  it("formats minutes ago", () => {
    const now = Date.parse("2026-01-01T00:05:00Z");
    const t = "2026-01-01T00:00:00Z";
    expect(relativeTime(t, now)).toBe("5m");
  });

  it("returns empty string on bad input", () => {
    expect(relativeTime("not-a-date")).toBe("");
  });
});
