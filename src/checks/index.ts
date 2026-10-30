import type { Check } from "../report.js";
import { checkAutomation } from "./automation.js";
import { checkCode } from "./code.js";
import { checkLicenses } from "./licenses.js";
import { checkLimits } from "./limits.js";
import { checkSecurity } from "./security.js";
import { checkUnused } from "./unused.js";

export const CHECKS = {
  security: {
    run: checkSecurity,
    description:
      "Security Health Check score and high/medium risk settings, users with Modify All Data or View All Data, " +
      "dormant active users, and users whose passwords never expire.",
  },
  limits: {
    run: checkLimits,
    description: "Org limits (data and file storage, daily API calls, async Apex, email and more) that are 75% or more used.",
  },
  code: {
    run: checkCode,
    description:
      "Org-wide and per-class Apex test coverage, Apex classes on old API versions, objects with multiple triggers, " +
      "inactive triggers, and async Apex jobs that failed in the last 7 days.",
  },
  automation: {
    run: checkAutomation,
    description:
      "Active Process Builder processes and Workflow Rules (both retired), inactive flows, objects with too many " +
      "record-triggered flows, and paused flow interviews.",
  },
  licenses: {
    run: checkLicenses,
    description:
      "User license and permission set license usage: fully used, under-used, expiring soon, and frozen users still holding licenses.",
  },
  unused: {
    run: checkUnused,
    description:
      "Clutter: reports not run in a year, unused email templates, unassigned permission sets, profiles with no users, and empty queues.",
  },
} satisfies Record<string, { run: Check; description: string }>;

export type CheckName = keyof typeof CHECKS;
export const CHECK_NAMES = Object.keys(CHECKS) as CheckName[];
