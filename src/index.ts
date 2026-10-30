import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CHECKS, CHECK_NAMES, type CheckName } from "./checks/index.js";
import { renderReport } from "./report.js";
import { getClient, listOrgs } from "./salesforce.js";

declare const __VERSION__: string;

const server = new McpServer({ name: "sf-org-health-checker", version: __VERSION__ });

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

const orgParam = z
  .string()
  .optional()
  .describe("Alias or username of an org the Salesforce CLI is logged in to. Omit to use the CLI's default org. Use list_orgs to see options.");

function text(body: string) {
  return { content: [{ type: "text" as const, text: body }] };
}

function failure(err: unknown) {
  return { ...text(`Error: ${err instanceof Error ? err.message : String(err)}`), isError: true };
}

async function runChecks(org: string | undefined, names: CheckName[]) {
  try {
    const client = await getClient(org);
    const results = await Promise.all(names.map((n) => CHECKS[n].run(client)));
    return text(renderReport(client, results));
  } catch (err) {
    return failure(err);
  }
}

server.registerTool(
  "list_orgs",
  {
    title: "List Salesforce orgs",
    description: "List the Salesforce orgs the local Salesforce CLI (sf) is logged in to, with aliases and which one is the default.",
    inputSchema: {},
    annotations: { ...READ_ONLY, openWorldHint: false },
  },
  async () => {
    try {
      const orgs = await listOrgs();
      if (!orgs.length) return text("No orgs found. Log in with: sf org login web --alias <alias>");
      const rows = orgs.map(
        (o) =>
          `| ${o.alias ?? ""} | ${o.username} | ${o.isSandbox ? "Sandbox" : "Production/Other"} | ${o.connectedStatus ?? ""} | ${o.isDefault ? "✓" : ""} |`,
      );
      return text(["| Alias | Username | Type | Status | Default |", "|---|---|---|---|---|", ...rows].join("\n"));
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  "full_health_check",
  {
    title: "Full org health check",
    description:
      "Run every health check (security, limits, code, automation, licenses, unused components) against a Salesforce org " +
      "and return a scored report with findings and recommendations. Read-only: it never changes the org.",
    inputSchema: {
      org: orgParam,
      categories: z
        .array(z.enum(CHECK_NAMES as [CheckName, ...CheckName[]]))
        .optional()
        .describe("Only run these categories. Omit to run all."),
    },
    annotations: READ_ONLY,
  },
  async ({ org, categories }) => runChecks(org, categories?.length ? categories : CHECK_NAMES),
);

for (const name of CHECK_NAMES) {
  server.registerTool(
    `check_${name}`,
    {
      title: `Check ${name}`,
      description: `${CHECKS[name].description} Read-only.`,
      inputSchema: { org: orgParam },
      annotations: READ_ONLY,
    },
    async ({ org }) => runChecks(org, [name]),
  );
}

server.connect(new StdioServerTransport()).catch((err) => {
  console.error("Failed to start sf-org-health-checker:", err);
  process.exit(1);
});
