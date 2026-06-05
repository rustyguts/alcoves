# Alcoves — Product Vision

> The one document a builder reads to confirm: *does this change belong in Alcoves?*

## Mission

**Give people a beautiful, capable home for their files and media — one they fully own.**

The tools that make our files and memories effortless to manage are run by companies that mine
them. The tools that respect us are usually too crude to enjoy. Alcoves rejects that bargain. It
brings the convenience of the cloud — search that understands your photos, a place that organizes
itself, sharing without strangers in the middle — onto hardware you control, with your data
staying yours.

Alcoves is a self-hosted file and media management application: a single, simple place to keep,
organize, understand, and share what matters to you. You run it. You own it.

## Who it's for

Individuals and small, trusted groups — a person keeping a lifetime of photos, a family sharing
memories across generations, a small team collaborating on video. Built for people who know each
other, weighted equally for one user and for a few. It is **not** a public, internet-scale service,
and every trade-off favors the trusted instance over the faceless crowd.

## The pillars

Every feature is vetted against these. Each carries a test. A change that fails a test stays out
until it earns its way in.

1. **You own your data.**
   Your files live on your hardware, and you can always see them, move them, and take them
   elsewhere.
   *Test: if a change makes your data harder to reach or leave with, or makes you depend on us to
   get at it, it loses.*

2. **Private by default.**
   Everything that reads your media runs on your own machine. Nothing is sold, profiled, or shipped
   off to be analyzed. We collect no telemetry beyond optional debugging data that stays off unless
   you turn it on.
   *Test: if a feature has to send your files or media off the instance to work, it doesn't ship.*

3. **Simple wins.**
   Alcoves does a lot without ever feeling like it. When power and simplicity collide, simplicity
   wins — we'd rather do fewer things cleanly than become a tool no one enjoys opening.
   *Test: if a change adds a screen, setting, or concept the everyday user won't touch, it loses by
   default — the burden is on the feature to justify itself.*

4. **Made to share, on your terms.**
   Data is organized into libraries. Everyone gets a private default library and can create more to
   collaborate, inviting others with roles that fit — from full control to a simple view.
   Collaboration is core, not bolted on; it works as well for a small team as for one person.
   *Test: multi-user is first-class, and every surface respects who was invited and what they're
   allowed to do. Sharing is always deliberate and always revocable.*

5. **It understands your media.**
   Alcoves doesn't just store files — it makes sense of them. Faces gather into the people you know,
   objects and scenes become searchable, videos turn into readable transcripts, and your library
   becomes something you can actually explore.
   *Test: the understanding runs locally and makes the library more explorable — or it doesn't ship.*

6. **Open to your tools.**
   Alcoves speaks to AI assistants and your own automations in plain language, so your library is
   yours to script, extend, and wire into the tools you already use.
   *Test: what you can do in the app, you should be able to do through your own assistant — no
   walled-off features.*

## What Alcoves is NOT

- **Not a data-mining cloud.** No ads, no profiling, no telemetry-funded business model.
- **Not a public SaaS.** It serves bounded, trusted groups, not anonymous mass signup.
- **Not a kitchen sink.** Capability never excuses clutter. Simple is the standard, not a phase.
- **Not finished.** Alcoves is early and growing deliberately, not wide and shallow.

## The tie-breaker

When two pillars pull against each other, resolve in this order: **ownership and privacy are
non-negotiable** — never trade them for any feature. After that, **simplicity breaks the tie** —
when in doubt, ship less. Everything else is craft.

Build for the person who wants their files and memories to be truly *theirs*. That is the whole
point of Alcoves.
