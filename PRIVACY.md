# Privacy Policy

_Last updated: 30 October 2026_

SF Org Health Checker is a Claude Code plugin that runs entirely on your own computer.

## What it accesses

- It uses the Salesforce CLI (`sf`) that is already installed and logged in on your computer to get an access token for the org you choose.
- It sends read-only requests (SOQL queries and the limits endpoint) directly from your computer to that Salesforce org.
- It reads org configuration and metadata such as security settings, user names and usernames, license counts, Apex class names and coverage, flows, reports and queues.

## What it does not do

- It does not change anything in your Salesforce org.
- It does not send data to the author or any third-party server. There is no telemetry or analytics.
- It does not store access tokens or results on disk. Tokens are held in memory while the server runs.

## Data shared with Claude

The health report the plugin produces is returned to Claude so it can explain the results to you. That report is handled under the terms of your Claude plan and Anthropic's privacy policy. The report can include user names, usernames and component names from your org. Avoid running it on orgs where you are not allowed to share that information with your AI provider.

## Contact

Questions: open an issue at https://github.com/rajeshyandrathi/sf-org-health-checker/issues
