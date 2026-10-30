import { CheckBuilder, type Check, type Severity } from "../report.js";

const INACTIVE_DAYS = 90;
const MAX_ADMINS = 5;

export const checkSecurity: Check = async (client) => {
  const b = new CheckBuilder("security", "Security");

  await b.step("Security Health Check score", async () => {
    const { records } = await client.query<{ Score: string }>("SELECT Score FROM SecurityHealthCheck", { tooling: true });
    const score = Number(records[0]?.Score);
    if (Number.isNaN(score)) return;
    b.metric("Salesforce Health Check score", `${score}%`);
    const severity: Severity | null = score < 55 ? "critical" : score < 70 ? "high" : score < 80 ? "medium" : null;
    if (severity) {
      b.add({
        severity,
        title: `Salesforce Security Health Check score is ${score}%`,
        detail: "Salesforce rates scores below 80% as needing attention and below 55% as very poor.",
        recommendation: "Open Setup → Health Check and fix the high-risk settings listed below first.",
      });
    }
  });

  await b.step("Security Health Check risks", async () => {
    const { records } = await client.query<any>(
      "SELECT RiskType, Setting, SettingGroup, OrgValue, StandardValue FROM SecurityHealthCheckRisks " +
        "WHERE RiskType IN ('HIGH_RISK', 'MEDIUM_RISK')",
      { tooling: true },
    );
    const describe = (r: any) => `${r.SettingGroup} › ${r.Setting}: org value "${r.OrgValue}", recommended "${r.StandardValue}"`;
    const high = records.filter((r) => r.RiskType === "HIGH_RISK");
    const medium = records.filter((r) => r.RiskType === "MEDIUM_RISK");
    b.metric("High-risk settings", high.length);
    b.metric("Medium-risk settings", medium.length);
    if (high.length) {
      b.add({
        severity: "high",
        title: `${high.length} high-risk security settings`,
        detail: "These settings differ from the Salesforce baseline and are rated high risk.",
        items: high.map(describe),
        recommendation: "Change each setting to the recommended value, or record why the org needs a different one.",
      });
    }
    if (medium.length) {
      b.add({
        severity: "medium",
        title: `${medium.length} medium-risk security settings`,
        detail: "These settings are weaker than the Salesforce baseline.",
        items: medium.map(describe),
      });
    }
  });

  for (const [perm, label] of [
    ["PermissionsModifyAllData", "Modify All Data"],
    ["PermissionsViewAllData", "View All Data"],
  ] as const) {
    await b.step(`Users with ${label}`, async () => {
      const { records } = await client.query<any>(
        `SELECT Assignee.Username, Assignee.Name, PermissionSet.Label, PermissionSet.IsOwnedByProfile, PermissionSet.Profile.Name ` +
          `FROM PermissionSetAssignment WHERE PermissionSet.${perm} = true AND Assignee.IsActive = true AND Assignee.UserType = 'Standard'`,
      );
      const users = new Map<string, string[]>();
      for (const r of records) {
        const source = r.PermissionSet.IsOwnedByProfile ? `profile ${r.PermissionSet.Profile?.Name}` : `permission set ${r.PermissionSet.Label}`;
        const key = `${r.Assignee.Name} (${r.Assignee.Username})`;
        users.set(key, [...(users.get(key) ?? []), source]);
      }
      b.metric(`Active users with ${label}`, users.size);
      if (users.size > MAX_ADMINS) {
        b.add({
          severity: users.size > MAX_ADMINS * 2 ? "high" : "medium",
          title: `${users.size} active users have ${label}`,
          detail: `${label} bypasses sharing and object permissions. Keep it to a small number of administrators (guideline: ${MAX_ADMINS} or fewer).`,
          items: [...users].map(([u, s]) => `${u} via ${s.join(", ")}`),
          recommendation: `Remove ${label} from users who do not administer the org and grant narrower permissions instead.`,
        });
      }
    });
  }

  await b.step("Inactive active users", async () => {
    const { records, totalSize } = await client.query<any>(
      `SELECT Name, Username, LastLoginDate, Profile.Name FROM User WHERE IsActive = true AND UserType = 'Standard' ` +
        `AND (LastLoginDate < LAST_N_DAYS:${INACTIVE_DAYS} OR LastLoginDate = null) ORDER BY LastLoginDate ASC NULLS FIRST`,
    );
    b.metric(`Active users with no login in ${INACTIVE_DAYS} days`, totalSize);
    if (totalSize) {
      b.add({
        severity: totalSize > 10 ? "medium" : "low",
        title: `${totalSize} active users have not logged in for ${INACTIVE_DAYS}+ days`,
        detail: "Dormant accounts widen the attack surface and use paid licenses.",
        items: records.map((r) => `${r.Name} (${r.Username}), ${r.Profile?.Name ?? "no profile"}, last login ${r.LastLoginDate?.slice(0, 10) ?? "never"}`),
        recommendation: "Deactivate or freeze accounts that are no longer needed.",
      });
    }
  });

  await b.step("Password never expires", async () => {
    const { records } = await client.query<any>(
      "SELECT Assignee.Name, Assignee.Username FROM PermissionSetAssignment " +
        "WHERE PermissionSet.PermissionsPasswordNeverExpires = true AND Assignee.IsActive = true AND Assignee.UserType = 'Standard'",
    );
    const users = [...new Set(records.map((r) => `${r.Assignee.Name} (${r.Assignee.Username})`))];
    if (users.length) {
      b.add({
        severity: "medium",
        title: `${users.length} active users have passwords that never expire`,
        detail: "The Password Never Expires permission overrides the org password policy.",
        items: users,
        recommendation: "Limit this to integration users that sign in with OAuth or certificates.",
      });
    }
  });

  return b.build();
};
