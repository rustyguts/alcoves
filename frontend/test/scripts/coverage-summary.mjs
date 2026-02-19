import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const candidates = [
  resolve(root, "coverage/coverage-summary.json"),
  resolve(root, "coverage-summary.json"),
  resolve(root, ".output/coverage/coverage-summary.json"),
];

const summaryPath = candidates.find((candidate) => existsSync(candidate));

if (!summaryPath) {
  const coverageDir = resolve(root, "coverage");
  const coverageFiles = existsSync(coverageDir)
    ? readdirSync(coverageDir).sort().join(", ")
    : "(coverage directory not found)";
  console.warn("Coverage Summary");
  console.warn(`coverage-summary.json not found. Checked: ${candidates.join(", ")}`);
  console.warn(`coverage/ contents: ${coverageFiles}`);
  process.exit(0);
}

const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
const totals = summary?.total;

if (!totals) {
  console.warn("Coverage Summary");
  console.warn(`Coverage totals not found in: ${summaryPath}`);
  process.exit(0);
}

function formatMetric(metric) {
  return `${metric.pct.toFixed(2)}% (${metric.covered}/${metric.total})`;
}

console.log("Coverage Summary");
console.log(`Source: ${summaryPath}`);
console.log(`Lines: ${formatMetric(totals.lines)}`);
console.log(`Statements: ${formatMetric(totals.statements)}`);
console.log(`Functions: ${formatMetric(totals.functions)}`);
console.log(`Branches: ${formatMetric(totals.branches)}`);
