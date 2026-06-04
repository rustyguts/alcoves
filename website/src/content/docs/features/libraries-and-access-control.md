---
title: "Libraries, roles & access control"
description: "How Alcoves organizes media into libraries, enforces owner/admin/viewer roles, manages members, and handles invite-link sharing."
---

Libraries are the fundamental building block of Alcoves. Every file, folder, tag, moment, and person belongs to exactly one library. Access is managed at the library level — there are no per-file permissions — which keeps sharing simple and predictable.

## What is a library?

A library is a named collection of media that you own and optionally share with others. You control who can see it and who can contribute to it.

Each library has:

- A **name** and optional **emoji** shown in the sidebar
- An **owner** — the single user who created it and has full control
- Optional **members** — other users granted read or write access
- Feature flags that enable AI processing (face recognition, object detection) and public moment sharing

### Your personal library

Every account starts with a personal library called **My Library**. It is created automatically when you register and cannot be deleted or shared with others. Think of it as your private workspace — always there, always yours.

## Roles

Alcoves uses three roles. Every user accessing a library has exactly one.

| Role | How you get it | What you can do |
|---|---|---|
| **Owner** | You created the library | Everything: read, write, manage members, configure settings, delete the library |
| **Admin** | An owner or admin granted you this role | Read, write, and manage members; cannot delete the library |
| **Viewer** | You accepted an invite link | Read-only access to all media in the library |

Role assignment follows a simple rule: **reads require viewer or higher; writes require admin or higher.** This is enforced before any request reaches library content — you will never accidentally expose media to someone who shouldn't see it.

:::note
The owner role on a library is separate from the instance-level owner role. The first person to register on an Alcoves instance becomes the instance owner, which gates access to the Admin panel. Library ownership is independent and per-library.
:::

## Creating and managing libraries

### Create a library

Click the **+** button in the sidebar to create a new library. New libraries start with no members and no AI features enabled — you choose what to turn on.

### Library settings

Open a library's settings page to:

- Rename the library or change its emoji
- Enable or disable **face recognition** — when turned on, Alcoves will begin detecting and clustering faces in your photos automatically
- Enable or disable **object detection** — labels people, animals, vehicles, and other objects in your media
- Enable or disable **public sharing** — required before any moment share link can be created from this library
- Manage members and invite links (admins and owners)
- Delete the library (owner only; see below)

:::tip
Turning on face recognition or object detection for the first time will trigger a background job to process all existing media in the library. New uploads are processed automatically as they arrive.
:::

### Deleting a library

Only the owner can delete a library, and only when it is empty (no files, including trash). Your personal **My Library** cannot be deleted at all.

## Sharing a library

### Adding members with invite links

Admins and owners can invite people by generating an **invite link**. The link can be:

- **Limited by use count** — set a maximum number of times it can be redeemed
- **Limited by expiry date** — set a date after which it stops working

Once generated, copy the link and send it to anyone you want to invite. They will land on an invite preview page showing your name, the library name, and the current status of the invite before they accept.

Accepting an invite grants the **viewer** role. An owner or admin can promote a viewer to admin afterward from the Members section of library settings.

:::caution
Invite links grant viewer access to everyone who uses them, up to the configured limit. Revoke a link immediately if you shared it somewhere it shouldn't have been.
:::

### Invite statuses

| Status | Meaning |
|---|---|
| **Pending** | Valid and redeemable |
| **Revoked** | Manually cancelled by an admin |
| **Expired** | The expiry date has passed |
| **Exhausted** | The maximum number of uses has been reached |
| **Already a member** | You are already in this library |

### What happens when someone follows an invite link

1. They land on the invite preview page — no login required to see the library name and who sent the invite.
2. If they are not logged in, they are directed to log in or register. The invite carries through so they land in the library immediately after.
3. On accept, they are added as a viewer and taken directly to the library.

Redeeming the same invite link twice is safe — accepting an invite you already accepted is a no-op.

### Registration and invite-only mode

If your Alcoves instance is configured in **invite-only** mode, a valid invite link is required to create a new account. The invite preview and registration pages are publicly accessible so new users can complete the flow. Once registered, they are automatically added to the library that issued the invite.

## Managing members

From library settings, admins and owners can:

- **View all members** — the owner is listed first, followed by all members with their roles
- **Change a member's role** between viewer and admin using the role dropdown
- **Remove a member** — immediately revokes their access; they will no longer see the library in their sidebar
- **View active invite links** — see how many times each link has been used and when it expires
- **Revoke an invite link** — stops new redemptions immediately; existing members are unaffected

You cannot remove yourself through the member management UI, and you cannot change the owner's role — there is always exactly one owner per library.

## Access and visibility

Alcoves deliberately returns a "not found" response (rather than "forbidden") when someone tries to access a library they are not a member of. This means that if you share a library ID with someone who is not a member, they learn nothing about whether the library exists at all.

Public media sharing works differently: [moment share links](/features/moment-sharing/) are single-purpose URLs that expose one clip to the internet without requiring login. The library's **sharing enabled** flag must be on before any share link can be created.
