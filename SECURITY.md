# Security policy

## Reporting a vulnerability

Report vulnerabilities privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Do not use public issues, pull requests or discussions for security problems.

Please include the affected version or commit, the steps to reproduce, the impact you expect, and whether the issue affects a self-hosted installation, the hosted installation, or both. Reports are acknowledged and handled on a best-effort basis by the single maintainer; there is no bug bounty.

## Scope

In scope: the Ufer source in this repository and its documented deployment configurations (Vercel and Docker/Compose).

Out of scope: third-party services such as Enable Banking, banks, Vercel and Turso, denial-of-service and load testing, social engineering, and testing against an installation you do not operate. Never access data that is not yours; use the sandbox banking environment and synthetic data (`npm run demo:seed`) for testing.

## Supported versions

Only the latest release and the `main` branch receive security fixes.
