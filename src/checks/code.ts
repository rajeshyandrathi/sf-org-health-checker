import { CheckBuilder, type Check } from "../report.js";

const DEPLOY_COVERAGE = 75;
const TARGET_COVERAGE = 85;
/** Apex saved at API versions this old misses years of platform fixes and security defaults. */
const OLD_API_VERSION = 45;

export const checkCode: Check = async (client) => {
  const b = new CheckBuilder("code", "Apex Code");

  await b.step("Org-wide Apex coverage", async () => {
    const { records } = await client.query<{ PercentCovered: number }>("SELECT PercentCovered FROM ApexOrgWideCoverage", {
      tooling: true,
    });
    const pct = records[0]?.PercentCovered;
    if (pct == null) return;
    b.metric("Org-wide Apex coverage", `${pct}%`);
    if (pct < TARGET_COVERAGE) {
      b.add({
        severity: pct < DEPLOY_COVERAGE ? "critical" : "medium",
        title: `Org-wide Apex test coverage is ${pct}%`,
        detail:
          pct < DEPLOY_COVERAGE
            ? `Production deployments need at least ${DEPLOY_COVERAGE}% coverage, so deployments will fail.`
            : `Coverage meets the ${DEPLOY_COVERAGE}% deployment minimum but is below the ${TARGET_COVERAGE}% target.`,
        recommendation: "Add tests for the least-covered classes below. Figures come from the last test run, so run all tests first for current numbers.",
      });
    }
  });

  await b.step("Per-class Apex coverage", async () => {
    const { records } = await client.query<any>(
      "SELECT ApexClassOrTrigger.Name, NumLinesCovered, NumLinesUncovered FROM ApexCodeCoverageAggregate",
      { tooling: true, maxRecords: 5000 },
    );
    const low = records
      .map((r) => {
        const total = r.NumLinesCovered + r.NumLinesUncovered;
        return { name: r.ApexClassOrTrigger?.Name ?? "unknown", pct: total ? Math.round((r.NumLinesCovered / total) * 100) : 100, uncovered: r.NumLinesUncovered };
      })
      .filter((r) => r.pct < DEPLOY_COVERAGE)
      .sort((a, b) => b.uncovered - a.uncovered);
    if (low.length) {
      b.add({
        severity: "medium",
        title: `${low.length} classes or triggers are below ${DEPLOY_COVERAGE}% coverage`,
        detail: "Sorted by uncovered lines, so the top entries raise org-wide coverage the most.",
        items: low.map((r) => `${r.name}: ${r.pct}% (${r.uncovered} lines uncovered)`),
      });
    }
  });

  await b.step("Apex API versions", async () => {
    const { records } = await client.query<any>(
      "SELECT Name, ApiVersion FROM ApexClass WHERE NamespacePrefix = null ORDER BY ApiVersion ASC",
      { maxRecords: 10000 },
    );
    b.metric("Custom Apex classes", records.length);
    const old = records.filter((r) => r.ApiVersion < OLD_API_VERSION);
    if (old.length) {
      b.add({
        severity: old.some((r) => r.ApiVersion <= 30) ? "high" : "low",
        title: `${old.length} Apex classes use API version ${OLD_API_VERSION - 1}.0 or older`,
        detail: "Old API versions miss newer platform behavior. Salesforce has retired API versions 30.0 and below.",
        items: old.map((r) => `${r.Name} (v${r.ApiVersion})`),
        recommendation: "Raise the API version during regular maintenance and rerun tests.",
      });
    }
  });

  await b.step("Apex triggers", async () => {
    const { records } = await client.query<any>(
      "SELECT Name, TableEnumOrId, Status FROM ApexTrigger WHERE NamespacePrefix = null",
      { maxRecords: 5000 },
    );
    const active = records.filter((r) => r.Status === "Active");
    b.metric("Active custom triggers", active.length);
    const byObject = new Map<string, string[]>();
    for (const r of active) byObject.set(r.TableEnumOrId, [...(byObject.get(r.TableEnumOrId) ?? []), r.Name]);
    const multi = [...byObject].filter(([, names]) => names.length > 1);
    if (multi.length) {
      b.add({
        severity: "medium",
        title: `${multi.length} objects have more than one active trigger`,
        detail: "Salesforce does not guarantee the order multiple triggers run in, which causes hard-to-reproduce bugs.",
        items: multi.map(([obj, names]) => `${obj}: ${names.join(", ")}`),
        recommendation: "Consolidate to one trigger per object that calls a handler class.",
      });
    }
    const inactive = records.filter((r) => r.Status !== "Active");
    if (inactive.length) {
      b.add({
        severity: "low",
        title: `${inactive.length} inactive triggers`,
        detail: "Inactive triggers add clutter and can be switched on by mistake.",
        items: inactive.map((r) => `${r.Name} on ${r.TableEnumOrId}`),
        recommendation: "Delete triggers that are no longer needed.",
      });
    }
  });

  await b.step("Failed async Apex jobs", async () => {
    const { records } = await client.query<any>(
      "SELECT ApexClass.Name, JobType, ExtendedStatus, CreatedDate FROM AsyncApexJob " +
        "WHERE Status = 'Failed' AND CreatedDate = LAST_N_DAYS:7 ORDER BY CreatedDate DESC",
      { maxRecords: 500 },
    );
    b.metric("Failed async Apex jobs (7 days)", records.length);
    if (records.length) {
      b.add({
        severity: records.length > 20 ? "high" : "medium",
        title: `${records.length} async Apex jobs failed in the last 7 days`,
        detail: "Failed batch, queueable, future or scheduled jobs often mean data was not processed.",
        items: records.map(
          (r) => `${r.CreatedDate.slice(0, 10)} ${r.JobType} ${r.ApexClass?.Name ?? ""}: ${(r.ExtendedStatus ?? "no message").slice(0, 160)}`,
        ),
        recommendation: "Check Setup → Apex Jobs and fix the recurring errors.",
      });
    }
  });

  return b.build();
};
