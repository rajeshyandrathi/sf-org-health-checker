import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Path to the Salesforce CLI. Override with SF_CLI_PATH if `sf` is not on PATH. */
const SF_BIN = process.env.SF_CLI_PATH || "sf";
const CONNECTION_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_RECORDS = 2000;

export interface OrgSummary {
  alias?: string;
  username: string;
  instanceUrl?: string;
  isSandbox?: boolean;
  isDefault: boolean;
  connectedStatus?: string;
}

interface SfJson<T> {
  status: number;
  result: T;
  message?: string;
  name?: string;
}

/** Runs an sf CLI command with --json and returns `result`. */
async function sf<T>(args: string[]): Promise<T> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(SF_BIN, [...args, "--json"], {
      maxBuffer: 50 * 1024 * 1024,
      shell: process.platform === "win32",
      env: { ...process.env, SF_DISABLE_COLORS: "true", SF_AUTOUPDATE_DISABLE: "true" },
    }));
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      throw new Error(
        "Salesforce CLI (sf) was not found. Install it from https://developer.salesforce.com/tools/salesforcecli " +
          "or set SF_CLI_PATH to the full path of the sf binary.",
      );
    }
    // sf exits non-zero on errors but still prints JSON to stdout.
    stdout = err?.stdout ?? "";
    if (!stdout) throw err;
  }
  const json = JSON.parse(stdout.slice(stdout.indexOf("{"))) as SfJson<T>;
  if (json.status !== 0) {
    throw new Error(json.message || json.name || "sf command failed");
  }
  return json.result;
}

export async function listOrgs(): Promise<OrgSummary[]> {
  const result = await sf<Record<string, any[]>>(["org", "list"]);
  const seen = new Map<string, OrgSummary>();
  for (const group of ["nonScratchOrgs", "scratchOrgs", "sandboxes", "other", "devHubs"]) {
    for (const o of result[group] ?? []) {
      if (seen.has(o.username)) continue;
      seen.set(o.username, {
        alias: o.alias,
        username: o.username,
        instanceUrl: o.instanceUrl,
        isSandbox: o.isSandbox,
        isDefault: Boolean(o.isDefaultUsername),
        connectedStatus: o.connectedStatus ?? o.status,
      });
    }
  }
  return [...seen.values()];
}

interface OrgDisplay {
  username: string;
  alias?: string;
  instanceUrl: string;
  accessToken: string;
  apiVersion: string;
  id: string;
}

function looksLikeToken(token: string | undefined): token is string {
  return Boolean(token) && !/\s|REDACTED/i.test(token!);
}

async function showAccessToken(username: string): Promise<string> {
  const result = await sf<any>(["org", "auth", "show-access-token", "--target-org", username]);
  return typeof result === "string" ? result : (result?.accessToken ?? result?.token);
}

export interface QueryOptions {
  tooling?: boolean;
  /** Stop paging after this many records. */
  maxRecords?: number;
}

export interface QueryResult<T> {
  totalSize: number;
  records: T[];
  /** True if more records existed than were fetched. */
  truncated: boolean;
}

/**
 * A strictly read-only Salesforce REST client. It only issues GET requests,
 * so the checks cannot modify the org.
 */
export class SalesforceClient {
  private constructor(
    private display: OrgDisplay,
    readonly target: string | undefined,
  ) {}

  get username() {
    return this.display.username;
  }
  get alias() {
    return this.display.alias;
  }
  get instanceUrl() {
    return this.display.instanceUrl;
  }
  get orgId() {
    return this.display.id;
  }
  get apiVersion() {
    return this.display.apiVersion;
  }

  static async connect(target?: string): Promise<SalesforceClient> {
    const args = ["org", "display"];
    if (target) args.push("--target-org", target);
    let display: OrgDisplay;
    try {
      display = await sf<OrgDisplay>(args);
    } catch (err: any) {
      const hint = target
        ? `Log in with: sf org login web --alias ${target}`
        : "No org was given and no default org is set. Pass an org alias or run: sf config set target-org <alias>";
      throw new Error(`Could not connect to ${target ?? "the default org"}: ${err.message}. ${hint}`);
    }
    // Newer sf CLI versions redact the token in `org display`; ask for it explicitly instead.
    // The token is kept in memory only and sent only to the org's own instance URL.
    if (!looksLikeToken(display.accessToken)) {
      display.accessToken = await showAccessToken(display.username);
    }
    if (!looksLikeToken(display.accessToken) || !display.instanceUrl) {
      throw new Error(`The sf CLI returned no access token for ${target ?? "the default org"}. Try logging in again.`);
    }
    return new SalesforceClient(display, target);
  }

  private refreshing?: Promise<void>;

  /** Re-reads the token from the sf CLI once, even if many requests hit a 401 at the same time. */
  private refresh(): Promise<void> {
    this.refreshing ??= SalesforceClient.connect(this.display.username)
      .then((fresh) => {
        this.display = fresh.display;
      })
      .finally(() => {
        this.refreshing = undefined;
      });
    return this.refreshing;
  }

  async get<T = any>(path: string, retry = true): Promise<T> {
    const url = path.startsWith("http") ? path : `${this.display.instanceUrl}${path}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.display.accessToken}`, Accept: "application/json" },
    });
    if (res.status === 401 && retry) {
      await this.refresh();
      return this.get<T>(path, false);
    }
    if (!res.ok) {
      const body = await res.text();
      let message = body;
      try {
        const parsed = JSON.parse(body);
        const first = Array.isArray(parsed) ? parsed[0] : parsed;
        message = [first?.errorCode, first?.message].filter(Boolean).join(": ") || body;
      } catch {
        // keep raw body
      }
      throw new Error(`${res.status} ${message}`.trim());
    }
    return (await res.json()) as T;
  }

  async query<T = any>(soql: string, opts: QueryOptions = {}): Promise<QueryResult<T>> {
    const max = opts.maxRecords ?? DEFAULT_MAX_RECORDS;
    const base = `/services/data/v${this.apiVersion}${opts.tooling ? "/tooling" : ""}/query`;
    let page = await this.get<any>(`${base}?q=${encodeURIComponent(soql)}`);
    const records: T[] = [...page.records];
    while (!page.done && page.nextRecordsUrl && records.length < max) {
      page = await this.get<any>(page.nextRecordsUrl);
      records.push(...page.records);
    }
    return {
      totalSize: page.totalSize,
      records: records.slice(0, max),
      truncated: page.totalSize > Math.min(records.length, max),
    };
  }

  async count(soql: string, opts: QueryOptions = {}): Promise<number> {
    return (await this.query(soql, { ...opts, maxRecords: 0 })).totalSize;
  }

  async limits(): Promise<Record<string, { Max: number; Remaining: number }>> {
    return this.get(`/services/data/v${this.apiVersion}/limits`);
  }
}

const cache = new Map<string, { client: SalesforceClient; at: number }>();

export async function getClient(target?: string): Promise<SalesforceClient> {
  const key = target ?? "<default>";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CONNECTION_TTL_MS) return hit.client;
  const client = await SalesforceClient.connect(target);
  cache.set(key, { client, at: Date.now() });
  return client;
}
