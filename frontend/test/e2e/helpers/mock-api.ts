import type { Page, Route } from "@playwright/test";
import { fulfillEmpty, fulfillJson, fulfillSSE } from "./fulfill";
import type { MockFile, MockFolder, MockState, MockTag } from "./types";

function serializeLibrary(lib: MockState["libraries"][number]) {
  return { ...lib };
}

function entriesForLibrary(state: MockState, libraryId: string, folderId: string | null) {
  const folders = state.folders.filter(
    (f) => f.libraryId === libraryId && (f.parentFolderId ?? null) === folderId && !f.trashedAt,
  );
  const files = state.files.filter(
    (f) => f.libraryId === libraryId && (f.parentFolderId ?? null) === folderId && !f.trashedAt,
  );
  return [...folders, ...files];
}

function trashedEntries(state: MockState, libraryId: string) {
  const folders = state.folders.filter((f) => f.libraryId === libraryId && f.trashedAt);
  const files = state.files.filter((f) => f.libraryId === libraryId && f.trashedAt);
  return [...folders, ...files];
}

export async function createMockApi(page: Page, state: MockState): Promise<void> {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const p = url.pathname;

    if (!p.startsWith("/api/")) {
      await route.continue();
      return;
    }

    for (const override of state.overrides) {
      const handled = await override(route, url);
      if (handled === true) return;
    }

    if (p === "/api/_auth/session") {
      if (state.loggedIn) {
        await fulfillJson(route, 200, { user: { ...state.currentUser } });
      } else {
        await fulfillJson(route, 200, {});
      }
      return;
    }

    if (p === "/api/health") {
      await fulfillJson(route, 200, { ok: true });
      return;
    }

    if (p === "/api/auth/providers") {
      await fulfillJson(route, 200, { google: state.googleAuthEnabled });
      return;
    }

    if (p === "/api/_meta/registration-mode") {
      await fulfillJson(route, 200, { mode: state.registrationMode });
      return;
    }

    if (p === "/api/auth/login" && request.method() === "POST") {
      const data = request.postDataJSON() as { email?: string; password?: string };
      if (data.email === state.currentUser.email && data.password === "password123") {
        state.loggedIn = true;
        await fulfillJson(route, 200, { ok: true });
      } else if (data.email === "owner@example.com" && data.password === "password123") {
        state.loggedIn = true;
        await fulfillJson(route, 200, { ok: true });
      } else {
        await fulfillJson(route, 401, { message: "Invalid email or password" });
      }
      return;
    }

    if (p === "/api/auth/register" && request.method() === "POST") {
      const data = request.postDataJSON() as {
        email?: string;
        password?: string;
        name?: string;
      };
      if (!data.email || !data.password || data.password.length < 8) {
        await fulfillJson(route, 400, { message: "Registration failed" });
      } else {
        state.loggedIn = true;
        state.currentUser = {
          ...state.currentUser,
          email: data.email,
          displayName: data.name ?? state.currentUser.displayName,
        };
        await fulfillJson(route, 200, { ok: true });
      }
      return;
    }

    if (p === "/api/auth/logout" && request.method() === "POST") {
      state.loggedIn = false;
      await fulfillJson(route, 200, { ok: true });
      return;
    }

    if (p === "/api/auth/me" && request.method() === "GET") {
      await fulfillJson(route, 200, { ...state.currentUser });
      return;
    }

    // Notifications endpoints: empty mocks so the bell + WS layer can mount
    // on every authenticated page without an unrelated test failing.
    if (p === "/api/notifications" && request.method() === "GET") {
      await fulfillJson(route, 200, { entries: [], nextCursor: null, unreadCount: 0 });
      return;
    }
    if (p === "/api/notifications/unread-count" && request.method() === "GET") {
      await fulfillJson(route, 200, { unreadCount: 0 });
      return;
    }
    if (p === "/api/notifications/dismiss-all" && request.method() === "POST") {
      await fulfillEmpty(route, 204);
      return;
    }
    {
      const m = p.match(/^\/api\/notifications\/([\w-]+)\/dismiss$/);
      if (m && request.method() === "POST") {
        await fulfillEmpty(route, 204);
        return;
      }
    }
    {
      const m = p.match(/^\/api\/libraries\/([\w-]+)\/feed$/);
      if (m && request.method() === "GET") {
        await fulfillJson(route, 200, { entries: [], nextCursor: null });
        return;
      }
    }

    if (p === "/api/auth/me" && request.method() === "PATCH") {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.currentUser = { ...state.currentUser, ...body };
      await fulfillJson(route, 200, { ...state.currentUser });
      return;
    }

    if (p === "/api/auth/sessions" && request.method() === "GET") {
      await fulfillJson(route, 200, state.sessions);
      return;
    }

    const sessionMatch = p.match(/^\/api\/auth\/sessions\/([\w-]+)$/);
    if (sessionMatch && request.method() === "DELETE") {
      state.sessions = state.sessions.filter((s) => s.id !== sessionMatch[1]);
      await fulfillEmpty(route, 204);
      return;
    }

    if (p === "/api/auth/avatar" && request.method() === "POST") {
      await fulfillJson(route, 200, { avatarUrl: "/avatar/user-owner.png" });
      return;
    }

    if (p === "/api/auth/tokens" && request.method() === "GET") {
      await fulfillJson(route, 200, state.accessTokens);
      return;
    }
    if (p === "/api/auth/tokens" && request.method() === "POST") {
      const created = {
        id: `token-${state.accessTokens.length + 1}`,
        name: "New token",
        lastUsedAt: null,
        expiresAt: null,
        createdAt: "2026-01-15T09:00:00.000Z",
      };
      state.accessTokens = [created, ...state.accessTokens];
      await fulfillJson(route, 201, { ...created, token: "alc_pat_examplePlaintextTokenValue" });
      return;
    }
    const tokenMatch = p.match(/^\/api\/auth\/tokens\/([\w-]+)$/);
    if (tokenMatch && request.method() === "DELETE") {
      state.accessTokens = state.accessTokens.filter((tk) => tk.id !== tokenMatch[1]);
      await fulfillJson(route, 200, { deleted: true });
      return;
    }

    if (p === "/api/libraries" && request.method() === "GET") {
      if (!state.loggedIn) {
        await fulfillJson(route, 401, { message: "Unauthorized" });
        return;
      }
      await fulfillJson(route, 200, state.libraries.map(serializeLibrary));
      return;
    }

    if (p === "/api/libraries" && request.method() === "POST") {
      const data = request.postDataJSON() as { name?: string };
      const newLib = {
        id: `lib-${Date.now()}`,
        name: data.name ?? "Untitled",
        emoji: null,
        isDefault: false,
        ownerId: state.currentUser.id,
        currentUserRole: "owner" as const,
        faceRecognitionEnabled: false,
        objectDetectionEnabled: false,
        createdAt: "2026-01-15T12:00:00.000Z",
        updatedAt: "2026-01-15T12:00:00.000Z",
      };
      state.libraries.push(newLib);
      await fulfillJson(route, 200, newLib);
      return;
    }

    const libMatch = p.match(/^\/api\/libraries\/([\w-]+)$/);
    if (libMatch) {
      const libId = libMatch[1]!;
      const lib = state.libraries.find((l) => l.id === libId);
      if (request.method() === "GET") {
        if (lib) await fulfillJson(route, 200, serializeLibrary(lib));
        else await fulfillJson(route, 404, { message: "Library not found" });
        return;
      }
      if (request.method() === "PATCH") {
        if (!lib) {
          await fulfillJson(route, 404, { message: "Library not found" });
          return;
        }
        const body = request.postDataJSON() as Record<string, unknown>;
        Object.assign(lib, body);
        await fulfillJson(route, 200, serializeLibrary(lib));
        return;
      }
      if (request.method() === "DELETE") {
        state.libraries = state.libraries.filter((l) => l.id !== libId);
        await fulfillEmpty(route, 204);
        return;
      }
    }

    const filesListMatch = p.match(/^\/api\/libraries\/([\w-]+)\/files$/);
    if (filesListMatch && request.method() === "GET") {
      const libId = filesListMatch[1]!;
      const folderId = url.searchParams.get("folder") ?? url.searchParams.get("folderId") ?? null;
      const trash = url.searchParams.get("trash") === "true";
      const entries = trash
        ? trashedEntries(state, libId)
        : entriesForLibrary(state, libId, folderId);

      const breadcrumbs: Array<{ id: string; name: string }> = [];
      if (folderId) {
        let current = state.folders.find((f) => f.id === folderId);
        const trail: Array<{ id: string; name: string }> = [];
        while (current) {
          trail.unshift({ id: current.id, name: current.name });
          current = current.parentFolderId
            ? state.folders.find((f) => f.id === current!.parentFolderId)
            : undefined;
        }
        breadcrumbs.push(...trail);
      }
      await fulfillJson(route, 200, {
        entries,
        breadcrumbs,
        nextCursor: null,
        totalCount: entries.length,
      });
      return;
    }

    const foldersCreateMatch = p.match(/^\/api\/libraries\/([\w-]+)\/folders$/);
    if (foldersCreateMatch && request.method() === "POST") {
      const data = request.postDataJSON() as { name?: string; parentFolderId?: string | null };
      const newFolder: MockFolder = {
        id: `folder-${Date.now()}`,
        libraryId: foldersCreateMatch[1]!,
        parentFolderId: data.parentFolderId ?? null,
        name: data.name ?? "New Folder",
        kind: "folder",
        trashedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        owner: {
          id: state.currentUser.id,
          displayName: state.currentUser.displayName,
          avatarUrl: state.currentUser.avatarUrl,
        },
        tags: [],
      };
      state.folders.push(newFolder);
      await fulfillJson(route, 200, newFolder);
      return;
    }

    const waveformMatch = p.match(/^\/api\/libraries\/([\w-]+)\/files\/([\w-]+)\/waveform$/);
    if (waveformMatch) {
      const fileId = waveformMatch[2]!;
      const file = state.files.find((f) => f.id === fileId);
      if (request.method() === "GET") {
        if (!file || file.waveformStatus !== "ready") {
          await fulfillJson(route, 404, { message: "Waveform not ready" });
          return;
        }
        await fulfillJson(route, 200, {
          peaks: file.waveformPeaks ?? [],
          peaksPerSecond: file.waveformPeaksPerSecond ?? 50,
          sampleRate: 16000,
        });
        return;
      }
      if (request.method() === "POST") {
        if (!file) {
          await fulfillJson(route, 404, { message: "File not found" });
          return;
        }
        file.waveformStatus = "queued";
        await fulfillJson(route, 202, file);
        return;
      }
    }

    const fileByIdMatch = p.match(/^\/api\/libraries\/([\w-]+)\/files\/([\w-]+)$/);
    if (fileByIdMatch) {
      const fileId = fileByIdMatch[2]!;
      const file = state.files.find((f) => f.id === fileId);
      if (request.method() === "GET") {
        if (file) await fulfillJson(route, 200, file);
        else await fulfillJson(route, 404, { message: "File not found" });
        return;
      }
      if (request.method() === "PATCH") {
        if (!file) {
          await fulfillJson(route, 404, { message: "File not found" });
          return;
        }
        Object.assign(file, request.postDataJSON() as Partial<MockFile>);
        await fulfillJson(route, 200, file);
        return;
      }
      if (request.method() === "DELETE") {
        state.files = state.files.filter((f) => f.id !== fileId);
        await fulfillEmpty(route, 204);
        return;
      }
    }

    const momentsMatch = p.match(/^\/api\/libraries\/([\w-]+)\/files\/([\w-]+)\/moments$/);
    if (momentsMatch) {
      const libId = momentsMatch[1]!;
      const fileId = momentsMatch[2]!;
      if (request.method() === "GET") {
        await fulfillJson(
          route,
          200,
          state.moments.filter((m) => m.libraryId === libId && m.fileId === fileId),
        );
        return;
      }
      if (request.method() === "POST") {
        const data = request.postDataJSON() as {
          name?: string;
          description?: string;
          startSeconds: number;
          endSeconds: number;
        };
        const now = new Date().toISOString();
        const moment = {
          id: `moment-${Date.now()}`,
          libraryId: libId,
          fileId,
          createdById: "user-owner",
          name: data.name ?? "",
          description: data.description ?? "",
          startSeconds: data.startSeconds,
          endSeconds: data.endSeconds,
          exportStatus: null,
          exportProgress: null,
          exportEtaSeconds: null,
          exportVersion: 1,
          exportedVersion: null,
          trashedAt: null,
          createdAt: now,
          updatedAt: now,
          tags: [],
        };
        state.moments.push(moment);
        await fulfillJson(route, 201, moment);
        return;
      }
    }

    const momentByIdMatch = p.match(
      /^\/api\/libraries\/([\w-]+)\/files\/([\w-]+)\/moments\/([\w-]+)$/,
    );
    if (momentByIdMatch) {
      const momentId = momentByIdMatch[3]!;
      const moment = state.moments.find((m) => m.id === momentId);
      if (request.method() === "GET") {
        if (moment) await fulfillJson(route, 200, moment);
        else await fulfillJson(route, 404, { message: "Moment not found" });
        return;
      }
      if (request.method() === "PATCH") {
        if (!moment) {
          await fulfillJson(route, 404, { message: "Moment not found" });
          return;
        }
        Object.assign(moment, request.postDataJSON() as Record<string, unknown>);
        moment.updatedAt = new Date().toISOString();
        await fulfillJson(route, 200, moment);
        return;
      }
      if (request.method() === "DELETE") {
        state.moments = state.moments.filter((m) => m.id !== momentId);
        await fulfillEmpty(route, 204);
        return;
      }
    }

    const tagsMatch = p.match(/^\/api\/libraries\/([\w-]+)\/tags$/);
    if (tagsMatch) {
      const libId = tagsMatch[1]!;
      if (request.method() === "GET") {
        await fulfillJson(
          route,
          200,
          state.tags.filter((t) => t.libraryId === libId),
        );
        return;
      }
      if (request.method() === "POST") {
        const data = request.postDataJSON() as { name?: string; color?: string };
        const newTag: MockTag = {
          id: `tag-${Date.now()}`,
          libraryId: libId,
          name: data.name ?? "Untitled",
          color: data.color ?? "#3B82F6",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        state.tags.push(newTag);
        await fulfillJson(route, 200, newTag);
        return;
      }
    }

    const tagByIdMatch = p.match(/^\/api\/libraries\/([\w-]+)\/tags\/([\w-]+)$/);
    if (tagByIdMatch) {
      const tagId = tagByIdMatch[2]!;
      const tag = state.tags.find((t) => t.id === tagId);
      if (request.method() === "PATCH") {
        if (!tag) {
          await fulfillJson(route, 404, { message: "Tag not found" });
          return;
        }
        Object.assign(tag, request.postDataJSON() as Partial<MockTag>);
        await fulfillJson(route, 200, tag);
        return;
      }
      if (request.method() === "DELETE") {
        state.tags = state.tags.filter((t) => t.id !== tagId);
        await fulfillEmpty(route, 204);
        return;
      }
    }

    const usersMatch = p.match(/^\/api\/libraries\/([\w-]+)\/users$/);
    if (usersMatch) {
      const libId = usersMatch[1]!;
      await fulfillJson(route, 200, {
        canManageUsers: true,
        members: state.members.filter((m) => m.libraryId === libId),
        pendingInvites: state.invites.filter(
          (i) => i.libraryId === libId && i.status === "pending",
        ),
      });
      return;
    }

    const invitesCreateMatch = p.match(/^\/api\/libraries\/([\w-]+)\/invites$/);
    if (invitesCreateMatch && request.method() === "POST") {
      const data = request.postDataJSON() as {
        role?: "member" | "viewer";
        invitedEmail?: string | null;
      };
      const newInvite = {
        id: `invite-${Date.now()}`,
        libraryId: invitesCreateMatch[1]!,
        role: data.role ?? "member",
        token: `token-${Date.now()}`,
        invitedEmail: data.invitedEmail ?? null,
        createdAt: new Date().toISOString(),
        expiresAt: "2026-03-01T00:00:00.000Z",
        status: "pending" as const,
      };
      state.invites.push(newInvite);
      await fulfillJson(route, 200, newInvite);
      return;
    }

    const inviteDeleteMatch = p.match(/^\/api\/libraries\/([\w-]+)\/invites\/([\w-]+)$/);
    if (inviteDeleteMatch && request.method() === "DELETE") {
      state.invites = state.invites.filter((i) => i.id !== inviteDeleteMatch[2]);
      await fulfillEmpty(route, 204);
      return;
    }

    const inviteLookupMatch = p.match(/^\/api\/invites\/([\w-]+)$/);
    if (inviteLookupMatch && request.method() === "GET") {
      const token = inviteLookupMatch[1]!;
      const invite = state.invites.find((i) => i.token === token);
      if (!invite) {
        await fulfillJson(route, 404, { message: "Invite not found" });
        return;
      }
      const lib =
        invite.library ??
        (() => {
          const l = state.libraries.find((x) => x.id === invite.libraryId);
          return l ? { id: l.id, name: l.name } : { id: invite.libraryId, name: "Library" };
        })();
      await fulfillJson(route, 200, {
        status: invite.status,
        role: invite.role,
        canAccept: invite.canAccept ?? invite.status === "pending",
        invitedEmail: invite.invitedEmail,
        library: lib,
        invitedBy: invite.invitedBy ?? {
          displayName: state.currentUser.displayName,
          avatarUrl: state.currentUser.avatarUrl,
        },
      });
      return;
    }

    const inviteAcceptMatch = p.match(/^\/api\/invites\/([\w-]+)\/accept$/);
    if (inviteAcceptMatch && request.method() === "POST") {
      const token = inviteAcceptMatch[1]!;
      const invite = state.invites.find((i) => i.token === token);
      if (!invite) {
        await fulfillJson(route, 404, { message: "Invite not found" });
        return;
      }
      invite.status = "accepted";
      const lib = state.libraries.find((l) => l.id === invite.libraryId);
      await fulfillJson(route, 200, {
        libraryId: invite.libraryId,
        libraryName: lib?.name ?? "Library",
      });
      return;
    }

    const peopleMatch = p.match(/^\/api\/libraries\/([\w-]+)\/people$/);
    if (peopleMatch && request.method() === "GET") {
      const libId = peopleMatch[1]!;
      await fulfillJson(route, 200, {
        people: state.people.filter((pp) => pp.libraryId === libId),
      });
      return;
    }

    const personMatch = p.match(/^\/api\/libraries\/([\w-]+)\/people\/([\w-]+)$/);
    if (personMatch) {
      const pid = personMatch[2]!;
      const person = state.people.find((pp) => pp.id === pid);
      if (request.method() === "GET") {
        if (!person) {
          await fulfillJson(route, 404, { message: "Person not found" });
          return;
        }
        await fulfillJson(route, 200, person);
        return;
      }
      if (request.method() === "PATCH") {
        if (person) {
          Object.assign(person, request.postDataJSON() as Partial<typeof person>);
          await fulfillJson(route, 200, person);
          return;
        }
      }
    }

    const personFacesMatch = p.match(/^\/api\/libraries\/([\w-]+)\/people\/([\w-]+)\/faces$/);
    if (personFacesMatch && request.method() === "GET") {
      await fulfillJson(route, 200, { faces: [] });
      return;
    }

    const objectsMatch = p.match(/^\/api\/libraries\/([\w-]+)\/objects\/labels$/);
    if (objectsMatch && request.method() === "GET") {
      await fulfillJson(route, 200, { labels: state.objectLabels });
      return;
    }

    if (p === "/api/admin/stats" && request.method() === "GET") {
      await fulfillJson(route, 200, state.adminStats);
      return;
    }

    if (p === "/api/admin/settings" && request.method() === "GET") {
      await fulfillJson(route, 200, state.appSettings);
      return;
    }

    if (p === "/api/admin/settings" && request.method() === "PATCH") {
      const patch = (request.postDataJSON() ?? {}) as Partial<typeof state.appSettings>;
      Object.assign(state.appSettings, patch);
      await fulfillJson(route, 200, state.appSettings);
      return;
    }

    // Public registration-mode probe (no auth) — the /register page blocks
    // form rendering until this resolves, so e2e tests need a stable mock.
    if (p === "/api/_meta/registration-mode" && request.method() === "GET") {
      await fulfillJson(route, 200, { mode: state.appSettings.registration_mode });
      return;
    }

    if (p === "/api/admin/users" && request.method() === "GET") {
      await fulfillJson(route, 200, state.adminUsers);
      return;
    }

    const adminUserMatch = p.match(/^\/api\/admin\/users\/([\w-]+)$/);
    if (adminUserMatch && request.method() === "PATCH") {
      const uid = adminUserMatch[1]!;
      const user = state.adminUsers.find((u) => u.id === uid);
      if (!user) {
        await fulfillJson(route, 404, { message: "User not found" });
        return;
      }
      Object.assign(user, request.postDataJSON() as Partial<typeof user>);
      await fulfillJson(route, 200, user);
      return;
    }

    if (p === "/api/admin/jobs/stream") {
      await fulfillSSE(route, [{ queues: state.queues, jobs: state.jobs }]);
      return;
    }

    const jobControlMatch = p.match(/^\/api\/admin\/jobs\/([^/]+)\/([\w-]+)\/control$/);
    if (jobControlMatch && request.method() === "POST") {
      await fulfillJson(route, 200, { ok: true });
      return;
    }

    const purgeMatch = p.match(/^\/api\/admin\/queues\/([^/]+)\/purge$/);
    if (purgeMatch && request.method() === "POST") {
      await fulfillJson(route, 200, { total: 0 });
      return;
    }

    if (p === "/api/search" && request.method() === "GET") {
      if (!state.loggedIn) {
        await fulfillJson(route, 401, { message: "Unauthorized" });
        return;
      }
      const query = url.searchParams.get("q") ?? "";
      const results = state.searchResults
        ? state.searchResults(query)
        : { query, totalCount: 0, results: [] };
      await fulfillJson(route, 200, results);
      return;
    }

    if (p === "/api/tus" && request.method() === "POST") {
      await route.fulfill({
        status: 201,
        headers: {
          Location: `${url.origin}/api/tus/mock-upload-${Date.now()}`,
          "Tus-Resumable": "1.0.0",
        },
        body: "",
      });
      return;
    }

    if (p.startsWith("/api/tus/") && request.method() === "PATCH") {
      await route.fulfill({
        status: 204,
        headers: {
          "Upload-Offset": String(request.postData()?.length ?? 0),
          "Tus-Resumable": "1.0.0",
        },
        body: "",
      });
      return;
    }

    if (p.startsWith("/api/files/")) {
      const pngBuffer = Buffer.from(
        "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D49444154789C6300010000000500010D0A2DB40000000049454E44AE426082",
        "hex",
      );
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: pngBuffer,
      });
      return;
    }

    if (
      p.startsWith("/api/avatar/") ||
      (p.startsWith("/api/libraries/") && p.includes("/people/") && p.endsWith("/thumbnail"))
    ) {
      const pngBuffer = Buffer.from(
        "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D49444154789C6300010000000500010D0A2DB40000000049454E44AE426082",
        "hex",
      );
      await route.fulfill({ status: 200, contentType: "image/png", body: pngBuffer });
      return;
    }

    await fulfillJson(route, 404, { message: `Unhandled API route: ${request.method()} ${p}` });
  });
}

export function addOverride(
  state: MockState,
  handler: (route: Route, url: URL) => Promise<boolean | void> | boolean | void,
) {
  state.overrides.push(handler);
}
