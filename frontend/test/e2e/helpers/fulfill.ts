import type { Route } from "@playwright/test";

export async function fulfillJson(route: Route, status: number, payload: unknown): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

export async function fulfillEmpty(route: Route, status = 204): Promise<void> {
  await route.fulfill({ status, body: "" });
}

export async function fulfillSSE(route: Route, snapshots: unknown[]): Promise<void> {
  const body = snapshots.map((s) => `data: ${JSON.stringify(s)}\n\n`).join("");
  await route.fulfill({
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    },
    body,
  });
}
