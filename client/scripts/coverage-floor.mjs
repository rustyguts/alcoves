#!/usr/bin/env node
/**
 * Per-file coverage floor.
 *
 * The v8 thresholds in vite.config.ts enforce the GLOBAL 90% target. This script
 * enforces the complementary rule from the project's test discipline: "no single
 * file below 60%". Run it after `test:unit:coverage` (which writes
 * coverage/coverage-summary.json).
 *
 * Exit 1 (with a list) if any covered source file falls under the floor.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';

const FLOOR = 60;
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const summaryPath = resolve(root, 'coverage/coverage-summary.json');

let summary;
try {
	summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
} catch (err) {
	console.error(
		`coverage-floor: could not read ${summaryPath}. Run \`bun run test:unit:coverage\` first.`
	);
	console.error(String(err));
	process.exit(1);
}

const offenders = [];
for (const [file, metrics] of Object.entries(summary)) {
	if (file === 'total') continue;
	const lines = metrics?.lines;
	// Skip files with no executable lines (pure type modules report total: 0).
	if (!lines || lines.total === 0) continue;
	if (lines.pct < FLOOR) {
		offenders.push({ file: relative(root, file), pct: lines.pct });
	}
}

if (offenders.length > 0) {
	offenders.sort((a, b) => a.pct - b.pct);
	console.error(`\ncoverage-floor: ${offenders.length} file(s) below ${FLOOR}% line coverage:\n`);
	for (const { file, pct } of offenders) {
		console.error(`  ${pct.toFixed(1).padStart(5)}%  ${file}`);
	}
	console.error('\nAdd tests in the same change or note the gap in docs/internal/todos.md.\n');
	process.exit(1);
}

console.log(`coverage-floor: OK — every source file ≥ ${FLOOR}% line coverage.`);
