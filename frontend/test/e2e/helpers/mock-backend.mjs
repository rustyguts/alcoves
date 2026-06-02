// Minimal mock backend for SSR-rendered routes that Playwright's page.route()
// cannot intercept (the /s/** share pages fetch their metadata server-side from
// the Nitro server, so the request never reaches the browser context).
//
// Started as a second Playwright `webServer`; the dev server's ALCOVES_API_URL
// points here so SSR share fetches resolve deterministically regardless of any
// real dev backend that may be running on the default port.
//
// Scenarios are keyed by the share token in the URL:
//   ready-token       -> ready moment with a video
//   processing-token  -> moment still encoding (no video)
//   anything else     -> 404 (share not found)

import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_BACKEND_PORT || 3099);

// 1x1 transparent PNG used for thumbnail/video binary responses.
const PNG = Buffer.from(
  "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D49444154789C6300010000000500010D0A2DB40000000049454E44AE426082",
  "hex",
);

function shareMeta(token, overrides = {}) {
  return {
    token,
    title: "Sunset over the bay",
    description: "A short clip captured during golden hour at the harbor.",
    shareUrl: `http://localhost/s/${token}`,
    appUrl: `http://localhost/libraries/lib-photos`,
    videoUrl: `/api/share/${token}/video`,
    thumbnailUrl: `/api/share/${token}/thumbnail`,
    ready: true,
    ...overrides,
  };
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

const server = createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const p = url.pathname;

  if (p === "/api/health") {
    json(res, 200, { ok: true });
    return;
  }

  // Binary thumbnail/video routes (also hit during SSR poster resolution).
  const binaryMatch = p.match(/^\/api\/share\/([\w-]+)\/(thumbnail|video)$/);
  if (binaryMatch) {
    res.writeHead(200, { "content-type": "image/png", "content-length": PNG.length });
    res.end(PNG);
    return;
  }

  const metaMatch = p.match(/^\/api\/share\/([\w-]+)$/);
  if (metaMatch) {
    const token = metaMatch[1];
    if (token === "ready-token") {
      json(res, 200, shareMeta(token));
      return;
    }
    if (token === "processing-token") {
      json(res, 200, shareMeta(token, { videoUrl: undefined, thumbnailUrl: undefined, ready: false }));
      return;
    }
    json(res, 404, { message: "Share not found" });
    return;
  }

  json(res, 404, { message: `mock-backend: unhandled ${req.method} ${p}` });
});

server.listen(PORT, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`mock-backend listening on http://127.0.0.1:${PORT}`);
});
