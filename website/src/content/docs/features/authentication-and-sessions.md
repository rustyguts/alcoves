---
title: "Authentication & sessions"
description: "How Alcoves handles sign-up, login, Google OAuth, encrypted session cookies, avatars, and multi-session management."
---

Alcoves keeps your media private by requiring every user to sign in before accessing anything. Accounts are created with an email and password, or instantly via Google — and the very first account on a fresh instance automatically becomes the **owner** with full administrative rights.

## Creating an account

### Email and password

Register with your display name, email address, and a password. Alcoves normalises your email (lowercased, trimmed) so `Alice@Example.com` and `alice@example.com` are treated as the same identity.

After registration succeeds you are logged in immediately and a personal **My Library** is created for you.

### Google OAuth

If your instance operator has configured Google OAuth, a **Continue with Google** button appears on the login and register pages. Clicking it redirects you to Google, then back to Alcoves — no password required. The same first-user-becomes-owner rule applies for Google sign-ups.

:::note
Google OAuth requires the instance operator to set `ALCOVES_OAUTH_GOOGLE_CLIENT_ID`, `ALCOVES_OAUTH_GOOGLE_CLIENT_SECRET`, and `ALCOVES_BASE_URL`. If the button is absent, OAuth has not been configured.
:::

## Registration modes

The owner controls who may create new accounts. Three modes are available:

| Mode | Who can sign up |
|---|---|
| **Open** | Anyone can register freely. |
| **Invite only** | A valid invite link is required to register. |
| **Closed** | No new registrations are accepted. |

The register page reflects the current mode — if registration is closed the form is locked, and if invite-only a token must be present in the URL.

The very first account can always be created regardless of mode, so a fresh instance is never stuck in an un-bootstrappable state.

## Invite-based sign-up

A library owner or admin can generate an invite link and share it with someone. When the recipient opens the link they can register (or log in if they already have an account) and are added to the library as a viewer automatically.

See [Libraries & access control](/features/libraries-and-access-control/) for details on invite management.

## Sessions

Once you sign in, Alcoves writes an `alcoves-session` cookie to your browser. The cookie is:

- **Encrypted** with AES-GCM using a server-side secret — its contents cannot be read or forged by anyone without that key.
- **HttpOnly** — not accessible to JavaScript running in the page.
- **Secure** — only sent over HTTPS.
- **SameSite=Lax** — protects against cross-site request forgery.
- **Valid for 30 days** from the time of sign-in.

Behind the cookie, every session is also stored server-side in the database. Signing out hard-deletes the session row; you cannot extend or refresh a session — when it expires after 30 days you simply sign in again.

## Managing active sessions

Your **Profile** page shows every session currently open for your account — including the browser or client that created it, its IP address, and when it was created. You can revoke any session except the one you are currently using. Revoking a session immediately invalidates it; anyone holding that cookie on another device will be sent to the login page on their next request.

To sign out of all other devices, revoke each session from the list. To sign out of the current device, use the **Sign out** button.

## Your profile

From the **Profile** page you can:

- Change your **display name**
- Change your **email address**
- Upload a **profile photo** (any common image format; Alcoves crops and converts it to a square WebP at up to 512 px)

:::tip
The profile photo picker accepts images up to 25 MB. Alcoves handles cropping and compression automatically — you do not need to resize or convert the image before uploading.
:::

## Operator configuration

The following environment variables control authentication on your instance:

| Variable | Purpose |
|---|---|
| `ALCOVES_SESSION_SECRET` | **Required.** Secret used to derive the AES-GCM encryption key for session cookies. Must be at least 32 characters. Generate with `openssl rand -base64 32`. |
| `ALCOVES_OAUTH_GOOGLE_CLIENT_ID` | Google OAuth client ID. Setting this (along with the secret) enables the Google sign-in button. |
| `ALCOVES_OAUTH_GOOGLE_CLIENT_SECRET` | Google OAuth client secret. |
| `ALCOVES_BASE_URL` | Public-facing URL of your Alcoves instance. Required for Google OAuth redirect URIs to work correctly. |

```bash
# Generating a strong session secret
openssl rand -base64 32
```

:::caution
`ALCOVES_SESSION_SECRET` must be set before the server starts. The server will refuse to start without it. Back it up: rotating the secret invalidates all existing sessions.
:::

See the [configuration reference](/getting-started/configuration/) for the full list of environment variables.
