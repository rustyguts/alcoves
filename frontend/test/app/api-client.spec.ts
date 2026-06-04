import { describe, it, expect, vi, beforeEach } from "vitest";

const apiFetch = vi.fn(() => Promise.resolve(undefined));

vi.mock("~/utils/api-fetch", () => ({
  apiFetch: (...a: unknown[]) => apiFetch(...a),
  apiUrl: (path: string) => `HOST${path}`,
  ApiError: class ApiError extends Error {},
}));

import { api } from "~/api";

type Case = { name: string; call: () => unknown; path: string; method?: string };

const FD = new FormData();

const cases: Case[] = [
  // auth
  { name: "auth.session", call: () => api.auth.session(), path: "/api/_auth/session" },
  { name: "auth.login", call: () => api.auth.login({ email: "a", password: "b" }), path: "/api/auth/login", method: "POST" },
  { name: "auth.register", call: () => api.auth.register({ name: "a", email: "b", password: "c" }), path: "/api/auth/register", method: "POST" },
  { name: "auth.logout", call: () => api.auth.logout(), path: "/api/auth/logout", method: "POST" },
  { name: "auth.updateMe", call: () => api.auth.updateMe({ displayName: "x" }), path: "/api/auth/me", method: "PATCH" },
  { name: "auth.uploadAvatar", call: () => api.auth.uploadAvatar(FD), path: "/api/auth/me/avatar", method: "POST" },
  { name: "auth.listSessions", call: () => api.auth.listSessions(), path: "/api/auth/sessions" },
  { name: "auth.revokeSession", call: () => api.auth.revokeSession("s1"), path: "/api/auth/sessions/s1", method: "DELETE" },
  { name: "auth.providers", call: () => api.auth.providers(), path: "/api/auth/providers" },
  // libraries
  { name: "libraries.list", call: () => api.libraries.list(), path: "/api/libraries" },
  { name: "libraries.create", call: () => api.libraries.create({ name: "L" }), path: "/api/libraries", method: "POST" },
  { name: "libraries.get", call: () => api.libraries.get("l"), path: "/api/libraries/l" },
  { name: "libraries.update", call: () => api.libraries.update("l", { name: "n" }), path: "/api/libraries/l", method: "PATCH" },
  { name: "libraries.delete", call: () => api.libraries.delete("l"), path: "/api/libraries/l", method: "DELETE" },
  // files
  { name: "files.list", call: () => api.files.list("l", { folder: "f" }), path: "/api/libraries/l/files" },
  { name: "files.get", call: () => api.files.get("l", "f"), path: "/api/libraries/l/files/f" },
  { name: "files.update", call: () => api.files.update("l", "f", { name: "n" }), path: "/api/libraries/l/files/f", method: "PATCH" },
  { name: "files.delete", call: () => api.files.delete("l", "f"), path: "/api/libraries/l/files/f", method: "DELETE" },
  { name: "files.restore", call: () => api.files.restore("l", { fileIds: ["f"] }), path: "/api/libraries/l/files/restore", method: "POST" },
  { name: "files.purge", call: () => api.files.purge("l"), path: "/api/libraries/l/files/purge", method: "POST" },
  { name: "files.playbackSources", call: () => api.files.playbackSources("l", "f"), path: "/api/libraries/l/files/f/playback-sources" },
  { name: "files.generateProxy", call: () => api.files.generateProxy("l", "f"), path: "/api/libraries/l/files/f/proxy", method: "POST" },
  { name: "files.transcribe", call: () => api.files.transcribe("l", "f"), path: "/api/libraries/l/files/f/transcribe", method: "POST" },
  { name: "files.transcript", call: () => api.files.transcript("l", "f"), path: "/api/libraries/l/files/f/transcript" },
  { name: "files.generateWaveform", call: () => api.files.generateWaveform("l", "f"), path: "/api/libraries/l/files/f/waveform", method: "POST" },
  { name: "files.waveform", call: () => api.files.waveform("l", "f"), path: "/api/libraries/l/files/f/waveform" },
  { name: "files.audioDetect", call: () => api.files.audioDetect("l", "f"), path: "/api/libraries/l/files/f/audio-detect", method: "POST" },
  { name: "files.audioDetections", call: () => api.files.audioDetections("l", "f"), path: "/api/libraries/l/files/f/audio-detections" },
  { name: "files.bulkTranscribe", call: () => api.files.bulkTranscribe("l", ["f"]), path: "/api/libraries/l/files/bulk-transcribe", method: "POST" },
  { name: "files.bulkAudioDetect", call: () => api.files.bulkAudioDetect("l"), path: "/api/libraries/l/files/bulk-audio-detect", method: "POST" },
  { name: "files.reprocessVideoThumbnails", call: () => api.files.reprocessVideoThumbnails("l"), path: "/api/libraries/l/files/video-thumbnails/reprocess", method: "POST" },
  // folders
  { name: "folders.list", call: () => api.folders.list("l"), path: "/api/libraries/l/folders" },
  { name: "folders.create", call: () => api.folders.create("l", { name: "n" }), path: "/api/libraries/l/folders", method: "POST" },
  { name: "folders.update", call: () => api.folders.update("l", "fo", { name: "n" }), path: "/api/libraries/l/folders/fo", method: "PATCH" },
  { name: "folders.delete", call: () => api.folders.delete("l", "fo"), path: "/api/libraries/l/folders/fo", method: "DELETE" },
  { name: "folders.move", call: () => api.folders.move("l", "fo", { parentFolderId: null }), path: "/api/libraries/l/folders/fo/move", method: "POST" },
  { name: "folders.restore", call: () => api.folders.restore("l", { folderIds: ["fo"] }), path: "/api/libraries/l/folders/restore", method: "POST" },
  { name: "folders.purge", call: () => api.folders.purge("l"), path: "/api/libraries/l/folders/purge", method: "POST" },
  // tags
  { name: "tags.list", call: () => api.tags.list("l"), path: "/api/libraries/l/tags" },
  { name: "tags.create", call: () => api.tags.create("l", { name: "n" }), path: "/api/libraries/l/tags", method: "POST" },
  { name: "tags.update", call: () => api.tags.update("l", "t", { name: "n" }), path: "/api/libraries/l/tags/t", method: "PATCH" },
  { name: "tags.delete", call: () => api.tags.delete("l", "t"), path: "/api/libraries/l/tags/t", method: "DELETE" },
  { name: "tags.syncFileTags", call: () => api.tags.syncFileTags("l", "f", { tagIds: [] }), path: "/api/libraries/l/files/f/tags", method: "PUT" },
  { name: "tags.syncFolderTags", call: () => api.tags.syncFolderTags("l", "fo", { tagIds: [] }), path: "/api/libraries/l/folders/fo/tags", method: "PUT" },
  // highlightFilters
  { name: "highlightFilters.list", call: () => api.highlightFilters.list("l"), path: "/api/libraries/l/highlight-filters" },
  { name: "highlightFilters.create", call: () => api.highlightFilters.create("l", { name: "n", expression: "e", color: "#fff" }), path: "/api/libraries/l/highlight-filters", method: "POST" },
  { name: "highlightFilters.update", call: () => api.highlightFilters.update("l", "h", { name: "n" }), path: "/api/libraries/l/highlight-filters/h", method: "PATCH" },
  { name: "highlightFilters.remove", call: () => api.highlightFilters.remove("l", "h"), path: "/api/libraries/l/highlight-filters/h", method: "DELETE" },
  // members
  { name: "members.list", call: () => api.members.list("l"), path: "/api/libraries/l/users" },
  { name: "members.createInviteLink", call: () => api.members.createInviteLink("l"), path: "/api/libraries/l/users/invite-link", method: "POST" },
  { name: "members.updateRole", call: () => api.members.updateRole("l", "u", { role: "admin" }), path: "/api/libraries/l/users/u", method: "PATCH" },
  { name: "members.remove", call: () => api.members.remove("l", "u"), path: "/api/libraries/l/users/u", method: "DELETE" },
  { name: "members.revokeInvite", call: () => api.members.revokeInvite("l", "i"), path: "/api/libraries/l/users/invites/i", method: "DELETE" },
  // people
  { name: "people.list", call: () => api.people.list("l"), path: "/api/libraries/l/people" },
  { name: "people.update", call: () => api.people.update("l", "p", { name: "n" }), path: "/api/libraries/l/people/p", method: "PATCH" },
  { name: "people.listFaces", call: () => api.people.listFaces("l", "p"), path: "/api/libraries/l/people/p/faces" },
  { name: "people.splitFace", call: () => api.people.splitFace("l", "p", "fc"), path: "/api/libraries/l/people/p/faces/fc/split", method: "POST" },
  { name: "people.merge", call: () => api.people.merge("l", { personIds: [] }), path: "/api/libraries/l/people/merge", method: "POST" },
  { name: "people.reprocess", call: () => api.people.reprocess("l"), path: "/api/libraries/l/face-recognition/reprocess", method: "POST" },
  // objects
  { name: "objects.labels", call: () => api.objects.labels("l"), path: "/api/libraries/l/objects/labels" },
  { name: "objects.reprocess", call: () => api.objects.reprocess("l"), path: "/api/libraries/l/object-detection/reprocess", method: "POST" },
  // downloads
  { name: "downloads.estimate", call: () => api.downloads.estimate("l", { fileIds: [], folderIds: [] }), path: "/api/libraries/l/download-estimate", method: "POST" },
  // search
  { name: "search.query", call: () => api.search.query({ q: "hi" }), path: "/api/search" },
  // invites
  { name: "invites.lookup", call: () => api.invites.lookup("t"), path: "/api/invites/t" },
  { name: "invites.accept", call: () => api.invites.accept("t"), path: "/api/invites/t/accept", method: "POST" },
  // admin
  { name: "admin.stats", call: () => api.admin.stats(), path: "/api/admin/stats" },
  { name: "admin.listUsers", call: () => api.admin.listUsers(), path: "/api/admin/users" },
  { name: "admin.updateUserRole", call: () => api.admin.updateUserRole("u", { role: "owner" }), path: "/api/admin/users/u", method: "PATCH" },
  { name: "admin.getSettings", call: () => api.admin.getSettings(), path: "/api/admin/settings" },
  { name: "admin.updateSettings", call: () => api.admin.updateSettings({}), path: "/api/admin/settings", method: "PATCH" },
  { name: "admin.controlJob", call: () => api.admin.controlJob("default", "j1", { action: "retry" }), path: "/api/admin/jobs/default/j1", method: "POST" },
  { name: "admin.purgeQueue", call: () => api.admin.purgeQueue("default"), path: "/api/admin/jobs/default/purge", method: "POST" },
  // moments
  { name: "moments.list", call: () => api.moments.list("l", "f"), path: "/api/libraries/l/files/f/moments" },
  { name: "moments.create", call: () => api.moments.create("l", "f", { name: "n", startSeconds: 0, endSeconds: 1 }), path: "/api/libraries/l/files/f/moments", method: "POST" },
  { name: "moments.get", call: () => api.moments.get("l", "f", "m"), path: "/api/libraries/l/files/f/moments/m" },
  { name: "moments.update", call: () => api.moments.update("l", "f", "m", { name: "n" }), path: "/api/libraries/l/files/f/moments/m", method: "PATCH" },
  { name: "moments.delete", call: () => api.moments.delete("l", "f", "m"), path: "/api/libraries/l/files/f/moments/m", method: "DELETE" },
  { name: "moments.syncTags", call: () => api.moments.syncTags("l", "f", "m", ["t"]), path: "/api/libraries/l/files/f/moments/m/tags", method: "PUT" },
  { name: "moments.export", call: () => api.moments.export("l", "f", "m"), path: "/api/libraries/l/files/f/moments/m/export", method: "POST" },
  { name: "moments.createShare", call: () => api.moments.createShare("l", "f", "m"), path: "/api/libraries/l/files/f/moments/m/shares", method: "POST" },
  { name: "moments.listShares", call: () => api.moments.listShares("l", "f", "m"), path: "/api/libraries/l/files/f/moments/m/shares" },
  { name: "moments.revokeShare", call: () => api.moments.revokeShare("l", "f", "m", "tok"), path: "/api/libraries/l/files/f/moments/m/shares/tok", method: "DELETE" },
  // meta
  { name: "meta.registrationMode", call: () => api.meta.registrationMode(), path: "/api/_meta/registration-mode" },
];

describe("api client", () => {
  beforeEach(() => apiFetch.mockClear());

  it.each(cases)("$name hits $path", ({ call, path, method }) => {
    call();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [calledPath, opts] = apiFetch.mock.calls[0] as [string, { method?: string } | undefined];
    expect(calledPath).toBe(path);
    if (method) expect(opts?.method).toBe(method);
    else expect(opts?.method).toBeUndefined();
  });

  it("builds people thumbnail URLs via apiUrl, encoding the version", () => {
    expect(api.people.thumbnailUrl("l", "p")).toBe("HOST/api/libraries/l/people/p/thumbnail");
    expect(api.people.thumbnailUrl("l", "p", "v 1")).toBe(
      "HOST/api/libraries/l/people/p/thumbnail?v=v%201",
    );
  });

  it("builds a moment download URL via apiUrl", () => {
    expect(api.moments.downloadUrl("l", "f", "m")).toBe(
      "HOST/api/libraries/l/files/f/moments/m/download",
    );
  });
});
