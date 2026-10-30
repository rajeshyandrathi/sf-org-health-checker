---
name: org-health-check
description: Run a read-only health check on a Salesforce org and explain the results. Use when the user asks to audit, health check, review or assess a Salesforce org, or asks about its security settings, admin users, org limits or storage, Apex test coverage, Process Builder or Workflow Rule migration, flows, license usage, or unused reports, profiles, permission sets and queues.
---

# Salesforce org health check

The `sf-org-health` MCP server checks a Salesforce org through the user's local Salesforce CLI (`sf`) login. Every tool is read-only: it runs SOQL queries and reads limits, and never changes the org.

## Tools

| Tool | Use for |
|---|---|
| `list_orgs` | See which orgs the CLI is logged in to and which is the default |
| `full_health_check` | All categories, with an overall score. Accepts `categories` to run a subset |
| `check_security` | Health Check score and risks, Modify/View All Data users, dormant users, non-expiring passwords |
| `check_limits` | Storage, API and other org limits at 75%+ |
| `check_code` | Apex coverage, old API versions, multiple triggers per object, failed async jobs |
| `check_automation` | Process Builder and Workflow Rules (retired), inactive flows, crowded objects |
| `check_licenses` | Full, under-used and expiring licenses, frozen users holding licenses |
| `check_unused` | Stale reports and email templates, unassigned permission sets, unused profiles, empty queues |

## Workflow

1. If the user did not name an org, call `list_orgs`. If there is exactly one sensible choice or a default org, use it; otherwise ask which org to check.
2. Run `full_health_check` for a general audit, or the matching `check_*` tool for a focused question.
3. Present the results:
   - Start with the overall score and a 2-3 sentence summary of the org's state.
   - List the critical and high findings first, each with what it means for the business and the concrete fix.
   - Group medium and low findings briefly. Do not repeat every list item the tool returned unless the user asks.
   - End with a short, ordered action plan (top 3-5 actions).
4. If a section says some checks could not run, explain that the logged-in user is probably missing permissions (for example View Setup and Configuration, or access to the Tooling API) and that results for that area are incomplete.

## Notes

- Apex coverage figures come from the last test run in the org. If coverage looks wrong, suggest running all tests (`sf apex run test --test-level RunLocalTests`) and checking again.
- Scores are a guide, not a Salesforce metric. Each critical finding costs 25 points, high 12, medium 5, low 2.
- If connecting fails, tell the user to log in with `sf org login web --alias <alias>` (add `--instance-url https://test.salesforce.com` for sandboxes).
- Never suggest running the fixes automatically through this plugin; it is read-only by design. The user or an admin applies changes in Setup or through their normal deployment process.
