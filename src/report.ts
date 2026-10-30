import type { SalesforceClient } from "./salesforce.js";

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface Finding {
  severity: Severity;
  title: string;
  detail: string;
  recommendation?: string;
  /** Affected components or users, shown as a capped list. */
  items?: string[];
}

export interface CheckResult {
  category: string;
  label: string;
  findings: Finding[];
  metrics: Record<string, string | number>;
  /** Sub-checks that could not run, usually because of missing permissions. */
  skipped: string[];
  /** Null when none of the category's checks could run. */
  score: number | null;
}

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];
const SEVERITY_PENALTY: Record<Severity, number> = { critical: 25, high: 12, medium: 5, low: 2, info: 0 };
const SEVERITY_ICON: Record<Severity, string> = {
  critical: "🔴 CRITICAL",
  high: "🟠 HIGH",
  medium: "🟡 MEDIUM",
  low: "🔵 LOW",
  info: "⚪ INFO",
};
const MAX_ITEMS = 25;

/** Collects findings for one category. Sub-checks run through `step` so one failure does not stop the rest. */
export class CheckBuilder {
  readonly findings: Finding[] = [];
  readonly metrics: Record<string, string | number> = {};
  readonly skipped: string[] = [];
  private steps = 0;

  constructor(
    readonly category: string,
    readonly label: string,
  ) {}

  add(finding: Finding) {
    this.findings.push(finding);
  }

  metric(name: string, value: string | number) {
    this.metrics[name] = value;
  }

  async step(name: string, fn: () => Promise<void>) {
    this.steps++;
    try {
      await fn();
    } catch (err: any) {
      this.skipped.push(`${name}: ${err?.message ?? String(err)}`);
    }
  }

  build(): CheckResult {
    const findings = [...this.findings].sort(
      (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
    );
    const penalty = findings.reduce((sum, f) => sum + SEVERITY_PENALTY[f.severity], 0);
    return {
      category: this.category,
      label: this.label,
      findings,
      metrics: this.metrics,
      skipped: this.skipped,
      score: this.steps > 0 && this.skipped.length === this.steps ? null : Math.max(0, 100 - penalty),
    };
  }
}

export type Check = (client: SalesforceClient) => Promise<CheckResult>;

function scoreLabel(score: number | null) {
  return score == null ? "not assessed" : `${score}/100 (${grade(score)})`;
}

function grade(score: number) {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 55) return "D";
  return "F";
}

function renderCategory(r: CheckResult): string {
  const lines: string[] = [`## ${r.label} — ${scoreLabel(r.score)}`, ""];
  const metricEntries = Object.entries(r.metrics);
  if (metricEntries.length) {
    lines.push("| Metric | Value |", "|---|---|");
    for (const [k, v] of metricEntries) lines.push(`| ${k} | ${v} |`);
    lines.push("");
  }
  if (!r.findings.length && r.score != null) {
    lines.push("No issues found.", "");
  }
  for (const f of r.findings) {
    lines.push(`### ${SEVERITY_ICON[f.severity]}: ${f.title}`, f.detail);
    if (f.items?.length) {
      for (const item of f.items.slice(0, MAX_ITEMS)) lines.push(`- ${item}`);
      if (f.items.length > MAX_ITEMS) lines.push(`- …and ${f.items.length - MAX_ITEMS} more`);
    }
    if (f.recommendation) lines.push(`**Recommendation:** ${f.recommendation}`);
    lines.push("");
  }
  if (r.skipped.length) {
    lines.push("<details><summary>Checks that could not run</summary>", "");
    for (const s of r.skipped) lines.push(`- ${s}`);
    lines.push("", "</details>", "");
  }
  return lines.join("\n");
}

export function renderReport(client: SalesforceClient, results: CheckResult[]): string {
  const scored = results.map((r) => r.score).filter((s): s is number => s != null);
  const overall = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null;
  const counts = Object.fromEntries(SEVERITY_ORDER.map((s) => [s, 0])) as Record<Severity, number>;
  for (const r of results) for (const f of r.findings) counts[f.severity]++;

  const header = [
    `# Salesforce Org Health Report`,
    "",
    `**Org:** ${client.alias ? `${client.alias} (${client.username})` : client.username}  `,
    `**Org ID:** ${client.orgId}  `,
    `**Instance:** ${client.instanceUrl}  `,
    `**Generated:** ${new Date().toISOString()}`,
    "",
  ];
  if (results.length > 1) {
    header.push(
      `**Overall score: ${scoreLabel(overall)}**`,
      "",
      "| Area | Score | Critical | High | Medium | Low |",
      "|---|---|---|---|---|---|",
      ...results.map((r) => {
        const c = (s: Severity) => r.findings.filter((f) => f.severity === s).length;
        return `| ${r.label} | ${scoreLabel(r.score)} | ${c("critical")} | ${c("high")} | ${c("medium")} | ${c("low")} |`;
      }),
      "",
      `Totals: ${counts.critical} critical, ${counts.high} high, ${counts.medium} medium, ${counts.low} low.`,
      "",
    );
  }
  return [...header, ...results.map(renderCategory)].join("\n");
}
