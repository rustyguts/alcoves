import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

const helperDir = path.dirname(fileURLToPath(import.meta.url));
const snapshotsRoot = path.resolve(helperDir, "..", "snapshots");

const STABILIZE_STYLE = `
	*, *::before, *::after {
		animation: none !important;
		transition: none !important;
		caret-color: transparent !important;
	}
	html { scroll-behavior: auto !important; }
`;

export async function stabilize(page: Page): Promise<void> {
  try {
    await page.waitForLoadState("networkidle", { timeout: 5_000 });
  } catch {
    // continue on timeout
  }
  try {
    await page.evaluate(() => (document as Document).fonts?.ready);
  } catch {
    // font API unavailable
  }
  await page.addStyleTag({ content: STABILIZE_STYLE }).catch(() => {});
  await page.waitForTimeout(120);
}

export async function snap(page: Page, flow: string, name: string): Promise<void> {
  await stabilize(page);
  await page.screenshot({
    path: path.join(snapshotsRoot, flow, `${name}.png`),
    fullPage: true,
    animations: "disabled",
    caret: "hide",
  });
}

export async function setTheme(page: Page, mode: "light" | "dark"): Promise<void> {
  await page.emulateMedia({ colorScheme: mode });
  await page.addInitScript((m: string) => {
    try {
      localStorage.setItem("alcoves.theme", m);
    } catch {
      // localStorage may be unavailable pre-navigation
    }
  }, mode);
}

export async function setupDeterminism(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const FIXED = new Date("2026-01-15T12:00:00.000Z").getTime();
    const OriginalDate = Date;
    class MockDate extends OriginalDate {
      constructor(...args: ConstructorParameters<typeof OriginalDate>) {
        if (args.length === 0) super(FIXED);
        else super(...(args as [number]));
      }
      static now() {
        return FIXED;
      }
    }
    // @ts-expect-error overriding global Date for determinism
    globalThis.Date = MockDate;

    let seed = 1;
    Math.random = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
  });
}

export const snapshotsDir = snapshotsRoot;
