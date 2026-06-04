---
title: "Sharing moments publicly"
description: "Create tokenized public links for video moment clips — shareable with anyone, no account required, with rich social media unfurls."
---

Moment sharing lets you turn any named video clip into a public link that anyone can open in a browser — no Alcoves account, no library membership, no login required. Paste the link into Slack, iMessage, Discord, or X and it unfurls into a video card. Open it in a browser and it plays inline.

Everything else in Alcoves requires authentication. Public sharing is the single deliberate exception — scoped tightly to one exported clip per link, gated behind a library-level toggle that only an owner or admin can enable.

## Prerequisites

Before a share link can exist, two things must be true:

1. **Sharing must be enabled on the library.** It is off by default. A library owner or admin enables it in **Library Settings → Sharing**. Until it is on, the Share button in the video editor is disabled for everyone in that library.
2. **The moment must be exported.** A moment is a named time-range clip you mark in the video editor. Before it can be shared, you need to export it — Alcoves transcodes the clip to MP4 in the background. You can trigger the export from the moment edit form.

:::tip
Export and sharing are decoupled on purpose. You can export a moment for your own use without ever sharing it, and you can share the same moment at multiple points in time as the clip evolves.
:::

## Creating a share link

1. Open the video editor for a file that has at least one moment.
2. Select the moment you want to share and open its edit form.
3. Click the **Share** button in the form header. If the clip has not been exported yet, do that first — the Share button will tell you.
4. In the Share modal, click **Create link**. Alcoves generates a unique URL of the form `https://your-instance/s/<token>`.
5. Copy the URL and share it however you like.

The share link appears immediately in the modal alongside any other active links for that moment. You can create multiple links for the same moment — each is independent and can be revoked separately.

:::note
If the **Create link** button is greyed out, sharing is not enabled for this library. An owner or admin can turn it on in **Library Settings → Sharing**.
:::

## What the recipient sees

Anyone who opens the link lands on a standalone video player page. There is no Alcoves header, sidebar, or login prompt — just a dark-themed player with the moment's title, the exported clip, and a link back to the library for authenticated users.

If the clip is still being transcoded when someone opens the link, they see a "Still processing" placeholder. The page does not auto-refresh — they can reload once the export finishes.

Pasting the link into a messaging app produces a rich video card: thumbnail, title, and an inline or linked player, powered by Open Graph and Twitter Player metadata embedded in the page.

## Revoking a link

Open the Share modal for the moment and click **Revoke** next to any active link. The token stops working immediately — the link returns "not found" to anyone who tries to open it, with no indication of whether it ever existed.

Revoking is permanent for that token. If you want to share the moment again, create a new link — it will have a fresh, unguessable URL.

:::caution
Treat share URLs as secrets. Anyone who has the URL can watch the clip until you revoke it. There is no view count, no expiry date, and no way to know who has the link.
:::

## What changes when you edit a moment

If you adjust the start or end time of a moment and export it again, the new version replaces the old one. Any existing share links continue to work — they serve the latest successfully exported version of the clip automatically. There is no need to create new links after a re-export.

## Enabling and disabling sharing for a library

Library owners and admins control sharing at the library level from **Library Settings → Sharing**.

- **Enabling** sharing makes the Create link button active for all members with write access.
- **Disabling** sharing does not revoke existing links. Links that were already created remain active until individually revoked. Disabling prevents new links from being created.

If you want to stop all sharing immediately, revoke each link individually from the Share modal for each moment.

## Security model

| Property | Detail |
|---|---|
| **Opt-in** | Sharing must be explicitly enabled per library; off by default |
| **Token strength** | 192 bits of randomness, URL-safe encoded — effectively unguessable |
| **What the token exposes** | Exactly one moment's exported clip and its thumbnail — nothing else |
| **Revocation** | Instant; revoked tokens return 404 with no distinguishing error |
| **No token oracle** | A revoked or never-issued token returns the same "not found" response — you cannot tell whether a token ever existed |
| **Thumbnail served directly** | The thumbnail is served without redirecting through the authenticated image proxy, so Open Graph crawlers can fetch it without credentials |

:::note
Share links bypass authentication on the backend only for the clip, its thumbnail, and the share metadata needed to render the player page. Every other Alcoves API route still requires a valid session.
:::

## Related features

- [Libraries, roles & access control](/features/libraries-and-access-control/) — how to enable sharing for a library and manage the members who can create links
- [Video editor and moments](/features/video-editor-and-moments/) — how to create, name, and export moment clips before sharing them
