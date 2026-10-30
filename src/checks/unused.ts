import { CheckBuilder, type Check } from "../report.js";

const STALE_DAYS = 365;
/** Shipped by Salesforce but reported as custom profiles. */
const BUILT_IN_PROFILES = new Set(["Read Only", "Salesforce API Only System Integrations", "Minimum Access - API Only Integrations"]);

export const checkUnused: Check = async (client) => {
  const b = new CheckBuilder("unused", "Unused Components");

  await b.step("Reports", async () => {
    const total = await client.count("SELECT COUNT() FROM Report");
    const stale = await client.count(`SELECT COUNT() FROM Report WHERE LastRunDate < LAST_N_DAYS:${STALE_DAYS} OR LastRunDate = null`);
    b.metric("Reports", total);
    b.metric(`Reports not run in ${STALE_DAYS} days`, stale);
    if (stale && stale / Math.max(total, 1) > 0.25) {
      b.add({
        severity: "low",
        title: `${stale} of ${total} reports have not been run in a year`,
        detail: "Unused reports clutter folders and make the right report harder to find.",
        recommendation: "Archive or delete old reports, starting with private and unfiled folders.",
      });
    }
  });

  await b.step("Email templates", async () => {
    const total = await client.count("SELECT COUNT() FROM EmailTemplate");
    const stale = await client.count(
      `SELECT COUNT() FROM EmailTemplate WHERE (LastUsedDate < LAST_N_DAYS:${STALE_DAYS} OR LastUsedDate = null) AND CreatedDate < LAST_N_DAYS:${STALE_DAYS}`,
    );
    b.metric("Email templates", total);
    b.metric(`Email templates unused for ${STALE_DAYS} days`, stale);
    if (stale > 20) {
      b.add({
        severity: "low",
        title: `${stale} email templates have not been used in a year`,
        detail: "Old templates can carry outdated branding or wording.",
        recommendation: "Review and delete templates that no automation or user still needs.",
      });
    }
  });

  await b.step("Unassigned permission sets", async () => {
    const { records } = await client.query<any>(
      "SELECT Name, Label FROM PermissionSet WHERE IsOwnedByProfile = false AND NamespacePrefix = null AND PermissionSetGroupId = null " +
        "AND Type = 'Regular' AND Id NOT IN (SELECT PermissionSetId FROM PermissionSetAssignment)",
    );
    b.metric("Custom permission sets with no assignments", records.length);
    if (records.length) {
      b.add({
        severity: "low",
        title: `${records.length} custom permission sets are not assigned to anyone`,
        detail: "Some may be used inside permission set groups; the rest are likely leftovers.",
        items: records.map((r) => `${r.Label} (${r.Name})`),
        recommendation: "Delete permission sets that are not in a group and not needed.",
      });
    }
  });

  await b.step("Custom profiles with no active users", async () => {
    // Each profile has a backing permission set whose IsCustom flag tells custom profiles from standard ones.
    const { records } = await client.query<any>(
      "SELECT Profile.Name FROM PermissionSet WHERE IsOwnedByProfile = true AND IsCustom = true " +
        "AND ProfileId NOT IN (SELECT ProfileId FROM User WHERE IsActive = true)",
    );
    const unused = records.map((r) => r.Profile.Name as string).filter((name) => !BUILT_IN_PROFILES.has(name));
    if (unused.length) {
      b.add({
        severity: "low",
        title: `${unused.length} custom profiles have no active users`,
        detail: "Unused profiles add maintenance work whenever objects or fields change.",
        items: unused,
        recommendation: "Delete custom profiles that are no longer needed.",
      });
    }
  });

  await b.step("Empty queues", async () => {
    const { records } = await client.query<any>(
      "SELECT Name FROM Group WHERE Type = 'Queue' AND Id NOT IN (SELECT GroupId FROM GroupMember)",
    );
    if (records.length) {
      b.add({
        severity: "low",
        title: `${records.length} queues have no members`,
        detail: "Records routed to an empty queue are not picked up by anyone.",
        items: records.map((r) => r.Name),
        recommendation: "Add members or delete the queue and update routing rules.",
      });
    }
  });

  return b.build();
};
