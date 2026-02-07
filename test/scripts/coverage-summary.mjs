import { readFileSync } from "node:fs";

const summaryPath = new URL("../../coverage/coverage-summary.json", import.meta.url);
const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
const totals = summary.total;

function formatMetric(metric) {
  return `${metric.pct.toFixed(2)}% (${metric.covered}/${metric.total})`;
}

console.log("Coverage Summary");
console.log(`Lines: ${formatMetric(totals.lines)}`);
console.log(`Statements: ${formatMetric(totals.statements)}`);
console.log(`Functions: ${formatMetric(totals.functions)}`);
console.log(`Branches: ${formatMetric(totals.branches)}`);
