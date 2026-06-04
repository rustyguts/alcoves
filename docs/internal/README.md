# Internal documentation

These documents are **internal-only** and are intentionally **not** published to
the public documentation site ([alcoves.io](https://alcoves.io), built from
`website/`). They contain maintainer-facing material — audit findings, backlogs,
model-evaluation history, and operational processes tied to the project's
private infrastructure — that isn't appropriate for, or useful to, end users,
self-hosters, or outside contributors.

The user-facing product and developer documentation now lives in
`website/src/content/docs/` (Astro + Starlight). The project north-star,
[`docs/vision.md`](../vision.md), stays at the top of `docs/` as the governance
document every change is measured against.

## What's here

| File | What it is | Why it's internal |
| --- | --- | --- |
| [`models.md`](models.md) | ML model evaluation, upgrade history, and rollback rationale | Documents maintainer decisions, incident history, and private model-mirror (`s3.rustyguts.net`) details |
| [`publishing-models.md`](publishing-models.md) | Process for mirroring ML model weights to the project's model bucket | A maintainer-only workflow that requires private push credentials |
| [`todos.md`](todos.md) | Engineering backlog: testing gaps, open bugs, polish items | Internal task tracking, not a product or contributor reference |

## Guidelines

- **Don't link to these files from the public site** (`website/`) or from
  user-facing copy. If something here becomes genuinely useful to operators or
  contributors, rewrite it for the public docs instead of linking the internal
  source.
- **Keep private infrastructure details here** (credentials, private bucket
  URLs used for pushing, incident postmortems, internal remediation plans).
- When adding a new internal doc, drop it in this directory and add a row to the
  table above.
