# Alcoves: Project Brief & Decision Framework

## Core Vision

Alcoves is a self-hosted, privacy-first media management platform that gives users complete ownership and control over their photos, videos, and files. It combines the organizational power of Google Drive with the intelligent media discovery of Google Photos, designed for individuals and small communities to manage shared libraries without depending on commercial cloud services.

## Primary Users

- **Individual users** managing personal photo and video libraries with a need for privacy and control
- **Families and friend groups** organizing shared events (weddings, parties, vacations)
- **Small teams** collaborating on media-heavy projects where data ownership matters
- **Privacy-conscious users** who prefer self-hosted solutions over cloud-dependent services

## Core Pillars (Decision Framework)

### 1. Intelligent Media Discovery
- **In scope:** Face detection and tagging, object recognition, EXIF data extraction and storage, geolocation mapping from EXIF data, full-text search across metadata and tags
- **Out of scope:** AI-generated captions, automatic tagging without user consent, behavioral recommendations, trending analysis

### 2. Intuitive Organization
- **In scope:** Hierarchical file/folder structure, user-created tags and labels, trash/recycle functionality, multi-user access control within libraries, search filters by date, location, people, objects
- **Out of scope:** Drag-and-drop folder trees that sacrifice performance, complex permission matrices, version control or file history

### 3. Collaborative Sharing
- **In scope:** Personal libraries (one user), shared libraries (invite-based, multiple users), granular permissions (view, upload, edit, manage), library-specific links for onboarding
- **Out of scope:** Real-time co-editing, commenting or discussion threads, public libraries or social discovery, activity feeds

### 4. Reliable Media Playback
- **In scope:** Video proxying for web-incompatible formats, lazy loading and streaming, thumbnail generation, responsive image serving
- **Out of scope:** Transcoding to every possible codec, live streaming, audio-only libraries, video editing tools

### 5. Complete Data Ownership
- **In scope:** User can export all data, self-hosted deployment, no telemetry or tracking, open-source codebase, portable file storage format
- **Out of scope:** Cloud backup (user can set up their own), data synchronization across devices, automatic backups, vendor lock-in patterns

---

## What Alcoves Is NOT

- A social media platform or photo sharing community (no feed, no followers, no algorithmic discovery)
- A streaming service (not optimized for public, large-scale media delivery)
- A real-time collaboration tool (not Figma or Adobe Collab)
- A file versioning system (not Git for media)
- A backup solution (though self-hosted, not marketed as a backup tool)
- A replacement for specialized tools (video editing, photo editing, design tools stay external)

---

## Scope Boundaries

### Tier 1 (Core, must-have)
Photos and videos with full feature set: intelligent discovery, organization, sharing, playback.

### Tier 2 (Supported, secondary)
General file storage (documents, archives, etc.) with basic organization and sharing. No intelligent discovery or special handling.

### Tier 3 (Out of scope, do not implement)
Audio-only libraries, live streaming, real-time synchronization, cloud backup integration, device sync, social features, content moderation, DRM or copy protection.

---

## Architecture Assumptions

- **Deployment model:** Self-hosted (Docker, Kubernetes, or bare metal). Cloud SaaS is not a primary target.
- **Scale expectations:** Optimized for single-user or small-group libraries (1-100 users per instance). Not designed for thousands of concurrent users.
- **Storage:** Direct filesystem or S3-compatible object storage. Files are user-owned and portable.
- **Processing:** Background jobs for video proxying, EXIF extraction, face detection. Keep UI responsive.
- **Privacy:** No third-party analytics, no external API calls without explicit user consent, no tracking.

---

## Feature Evaluation Rubric

When deciding whether to implement a feature, ask:

1. **Does it align with one of the five core pillars?** If not, it's likely out of scope.
2. **Does it serve the primary users** (individuals, families, small teams)? If it's built for large-scale or social use, reconsider.
3. **Does it maintain user data ownership?** If it introduces vendor lock-in or external dependencies, reject it.
4. **Is it essential for photos and videos?** If it only benefits Tier 2 (general files), deprioritize it.
5. **Will it stay maintainable as an open-source project?** If it introduces heavy dependencies or operational complexity, be cautious.

---

## Non-Goals (Explicitly Out of Scope)

- Competing with Dropbox, OneDrive, or iCloud on sync and cross-device availability
- Providing AI-powered photo enhancement, filters, or editing
- Building a marketplace or plugin ecosystem
- Offering commercial cloud hosting (self-hosted only)
- Real-time notifications or live collaboration
- Advanced permission models (ACLs, RBAC beyond basic library roles)
- Media rights management or DRM

---

## Success Criteria

Alcoves succeeds when:
- A user can upload, organize, search, and share photos and videos without cloud dependency
- Users feel confident their data is private and fully owned
- The UI is intuitive enough that non-technical users can manage libraries
- Families and friends can easily collaborate on shared event libraries
- The codebase remains maintainable and extensible for autonomous AI-assisted development