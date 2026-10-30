import { CheckBuilder, type Check } from "../report.js";

const HIGH_PCT = 90;
const MEDIUM_PCT = 75;

/** Limits that matter most, shown as metrics even when healthy. */
const HEADLINE: Record<string, string> = {
  DataStorageMB: "Data storage",
  FileStorageMB: "File storage",
  DailyApiRequests: "Daily API requests",
  DailyAsyncApexExecutions: "Daily async Apex executions",
  DailyBulkV2QueryJobs: "Daily Bulk API 2.0 query jobs",
  SingleEmail: "Daily single emails",
};

export const checkLimits: Check = async (client) => {
  const b = new CheckBuilder("limits", "Org Limits");

  await b.step("Org limits", async () => {
    const limits = await client.limits();
    const high: string[] = [];
    const medium: string[] = [];
    for (const [name, { Max, Remaining }] of Object.entries(limits)) {
      if (!Max || Max <= 0) continue;
      const used = Max - Remaining;
      const pct = Math.round((used / Max) * 100);
      const line = `${HEADLINE[name] ?? name}: ${used.toLocaleString()} of ${Max.toLocaleString()} used (${pct}%)`;
      if (HEADLINE[name]) b.metric(HEADLINE[name], `${used.toLocaleString()} / ${Max.toLocaleString()} (${pct}%)`);
      if (pct >= HIGH_PCT) high.push(line);
      else if (pct >= MEDIUM_PCT) medium.push(line);
    }
    const storageFull = high.some((l) => /storage/i.test(l));
    if (high.length) {
      b.add({
        severity: storageFull ? "critical" : "high",
        title: `${high.length} limits are at ${HIGH_PCT}% or more`,
        detail: "Hitting these limits blocks record saves, integrations or scheduled jobs.",
        items: high,
        recommendation: "Archive or delete data, reduce API polling, or buy more capacity before the limit is reached.",
      });
    }
    if (medium.length) {
      b.add({
        severity: "medium",
        title: `${medium.length} limits are between ${MEDIUM_PCT}% and ${HIGH_PCT}%`,
        detail: "Watch these limits. Daily limits reset every 24 hours; storage limits do not.",
        items: medium,
      });
    }
  });

  return b.build();
};
