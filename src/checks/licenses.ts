import { CheckBuilder, type Check } from "../report.js";

const LOW_UTILIZATION_PCT = 50;
const MIN_LICENSES_FOR_UTILIZATION = 10;
const EXPIRY_WARNING_DAYS = 60;
/** License types that come free with the edition or are system-managed, so usage levels are not actionable. */
const IGNORED_LICENSES = /^(Guest User License|Chatter Free|Chatter External|Cloud Integration User|Analytics Cloud Integration User|Salesforce Integration)$/;

export const checkLicenses: Check = async (client) => {
  const b = new CheckBuilder("licenses", "Licenses");

  await b.step("User licenses", async () => {
    const { records } = await client.query<any>(
      "SELECT Name, TotalLicenses, UsedLicenses FROM UserLicense WHERE Status = 'Active' AND TotalLicenses > 0 ORDER BY TotalLicenses DESC",
    );
    const full: string[] = [];
    const underused: string[] = [];
    for (const r of records) {
      if (IGNORED_LICENSES.test(r.Name)) continue;
      const pct = Math.round((r.UsedLicenses / r.TotalLicenses) * 100);
      if (r.UsedLicenses > 0) b.metric(`${r.Name} licenses`, `${r.UsedLicenses} / ${r.TotalLicenses} (${pct}%)`);
      if (r.UsedLicenses >= r.TotalLicenses) full.push(`${r.Name}: ${r.UsedLicenses} of ${r.TotalLicenses}`);
      // Unused license types are usually bundled with the edition, so only flag types the org actually uses.
      else if (r.UsedLicenses > 0 && r.TotalLicenses >= MIN_LICENSES_FOR_UTILIZATION && pct < LOW_UTILIZATION_PCT)
        underused.push(`${r.Name}: ${r.UsedLicenses} of ${r.TotalLicenses} used (${r.TotalLicenses - r.UsedLicenses} spare)`);
    }
    if (full.length) {
      b.add({
        severity: "medium",
        title: `${full.length} user license types are fully used`,
        detail: "No new users can be created with these licenses.",
        items: full,
        recommendation: "Free up licenses held by inactive users, or buy more.",
      });
    }
    if (underused.length) {
      b.add({
        severity: "low",
        title: `${underused.length} user license types are less than ${LOW_UTILIZATION_PCT}% used`,
        detail: "You may be paying for more licenses than you need.",
        items: underused,
        recommendation: "Review license counts before the next renewal.",
      });
    }
  });

  await b.step("Permission set licenses", async () => {
    const { records } = await client.query<any>(
      "SELECT MasterLabel, TotalLicenses, UsedLicenses, ExpirationDate FROM PermissionSetLicense WHERE Status = 'Active' AND TotalLicenses > 0",
    );
    const soon = Date.now() + EXPIRY_WARNING_DAYS * 86_400_000;
    const expiring = records.filter((r) => r.ExpirationDate && new Date(r.ExpirationDate).getTime() < soon && r.UsedLicenses > 0);
    if (expiring.length) {
      b.add({
        severity: "medium",
        title: `${expiring.length} permission set licenses in use expire within ${EXPIRY_WARNING_DAYS} days`,
        detail: "Users lose the related features when these licenses expire.",
        items: expiring.map((r) => `${r.MasterLabel}: expires ${r.ExpirationDate}, ${r.UsedLicenses} assigned`),
        recommendation: "Confirm renewal with your Salesforce account executive.",
      });
    }
    const full = records.filter((r) => r.UsedLicenses >= r.TotalLicenses);
    if (full.length) {
      b.add({
        severity: "low",
        title: `${full.length} permission set licenses are fully assigned`,
        detail: "No more users can be given these features.",
        items: full.map((r) => `${r.MasterLabel}: ${r.UsedLicenses} of ${r.TotalLicenses}`),
      });
    }
  });

  await b.step("Frozen users holding licenses", async () => {
    const { records } = await client.query<any>("SELECT UserId FROM UserLogin WHERE IsFrozen = true", { maxRecords: 5000 });
    if (!records.length) return;
    const ids = records.map((r) => `'${r.UserId}'`);
    const frozenActive: string[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { records: users } = await client.query<any>(
        `SELECT Name, Username, Profile.UserLicense.Name FROM User WHERE IsActive = true AND Id IN (${ids.slice(i, i + 200).join(",")})`,
      );
      frozenActive.push(...users.map((u) => `${u.Name} (${u.Username}), ${u.Profile?.UserLicense?.Name ?? "unknown license"}`));
    }
    b.metric("Frozen users still active", frozenActive.length);
    if (frozenActive.length) {
      b.add({
        severity: "low",
        title: `${frozenActive.length} frozen users still hold a license`,
        detail: "Freezing blocks login but the user stays active and keeps the license.",
        items: frozenActive,
        recommendation: "Deactivate frozen users who are not coming back to release their licenses.",
      });
    }
  });

  return b.build();
};
