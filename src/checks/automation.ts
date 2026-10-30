import { CheckBuilder, type Check } from "../report.js";

const MAX_RECORD_TRIGGERED_FLOWS_PER_OBJECT = 5;

export const checkAutomation: Check = async (client) => {
  const b = new CheckBuilder("automation", "Automation");

  await b.step("Flows and Process Builder", async () => {
    const { records } = await client.query<any>(
      "SELECT ApiName, Label, ProcessType, TriggerType, IsActive, LastModifiedDate, NamespacePrefix FROM FlowDefinitionView",
      { maxRecords: 10000 },
    );
    const custom = records.filter((r) => !r.NamespacePrefix);
    const active = custom.filter((r) => r.IsActive);
    b.metric("Flows (custom)", custom.length);
    b.metric("Active flows", active.length);

    const processBuilders = active.filter((r) => r.ProcessType === "Workflow" || r.ProcessType === "CustomEvent" || r.ProcessType === "InvocableProcess");
    b.metric("Active Process Builder processes", processBuilders.length);
    if (processBuilders.length) {
      b.add({
        severity: "high",
        title: `${processBuilders.length} active Process Builder processes`,
        detail: "Salesforce ended support for Process Builder on 31 December 2025. These keep running but get no fixes or support.",
        items: processBuilders.map((r) => `${r.Label} (${r.ApiName})`),
        recommendation: "Migrate them to record-triggered flows with the Migrate to Flow tool in Setup.",
      });
    }

    const inactive = custom.filter((r) => !r.IsActive);
    if (inactive.length) {
      b.add({
        severity: "low",
        title: `${inactive.length} inactive flows`,
        detail: "Inactive flows add clutter and make it harder to see what automation really runs.",
        items: inactive.map((r) => `${r.Label} (${r.ApiName}), last modified ${r.LastModifiedDate?.slice(0, 10)}`),
        recommendation: "Delete flows that are no longer needed.",
      });
    }
  });

  await b.step("Record-triggered flows per object", async () => {
    const { records } = await client.query<any>(
      "SELECT ApiName, TriggerObjectOrEventLabel FROM FlowDefinitionView " +
        "WHERE IsActive = true AND ProcessType = 'AutoLaunchedFlow' AND TriggerType IN ('RecordAfterSave', 'RecordBeforeSave', 'RecordBeforeDelete')",
      { maxRecords: 5000 },
    );
    const byObject = new Map<string, number>();
    for (const r of records) byObject.set(r.TriggerObjectOrEventLabel, (byObject.get(r.TriggerObjectOrEventLabel) ?? 0) + 1);
    const crowded = [...byObject].filter(([, n]) => n > MAX_RECORD_TRIGGERED_FLOWS_PER_OBJECT).sort((a, b) => b[1] - a[1]);
    if (crowded.length) {
      b.add({
        severity: "medium",
        title: `${crowded.length} objects have more than ${MAX_RECORD_TRIGGERED_FLOWS_PER_OBJECT} active record-triggered flows`,
        detail: "Many flows on one object slow saves and make the order of execution hard to follow.",
        items: crowded.map(([obj, n]) => `${obj}: ${n} flows`),
        recommendation: "Consolidate flows per object and set explicit trigger order.",
      });
    }
  });

  await b.step("Workflow rules", async () => {
    const total = await client.count("SELECT COUNT() FROM WorkflowRule WHERE NamespacePrefix = null", { tooling: true });
    b.metric("Workflow rules (custom)", total);
    if (total) {
      b.add({
        severity: "medium",
        title: `${total} workflow rules exist`,
        detail: "Salesforce ended support for Workflow Rules on 31 December 2025. This count includes inactive rules.",
        recommendation: "Migrate active rules to flows with the Migrate to Flow tool and delete the rest.",
      });
    }
  });

  await b.step("Paused flow interviews", async () => {
    const total = await client.count("SELECT COUNT() FROM FlowInterview WHERE InterviewStatus = 'Paused'");
    b.metric("Paused flow interviews", total);
    if (total > 100) {
      b.add({
        severity: "low",
        title: `${total} paused flow interviews`,
        detail: "A large backlog of paused interviews can point to flows waiting on events that never happen.",
        recommendation: "Review Setup → Paused and Failed Flow Interviews.",
      });
    }
  });

  return b.build();
};
