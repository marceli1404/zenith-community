# Zenith Community

Zenith Community is the self-hosted edition of Zenith for monitoring websites and reviewing technical audit findings. You run it on your own Cloudflare account and control its data, credentials, and retention.

## What it includes

- Scheduled availability checks, incident history, and optional public status pages.
- Bounded website audits covering security, accessibility, performance, and search basics.
- Recommendations, downloadable reports, and account export/deletion controls.
- Email verification and alerts when you configure an email provider.

If the crawler cannot reach an HTML homepage, finds a generic server-error title or page (even when it returns HTTP 200), or the browser cannot confirm visible homepage content, the audit score is **0/100** and category scores are marked unassessed. A matching error heading with diagnostic output is also treated as an unavailable homepage. If robots.txt or crawler safety policy blocks the homepage, or any page response exceeds the 1.5 MB scan limit, the audit is marked **Not assessed** because it could not check all required content. The report identifies the observed limitation. Reliability findings also reduce the overall score. Repeated linked-page failures are charged per affected URL, up to five URLs per rule.

This repository does not provide a managed hosted service, billing, payment processing, content publishing, search integrations, or marketing analytics.

The source is licensed under Apache-2.0. `package.json` is marked private to
prevent accidental publication as an npm package; this repository is the
distribution channel for the Community source.

## Requirements

- Node.js 22.20 or newer on the 22.x line, or 24.12 or newer on the 24.x line, plus npm.
- A Cloudflare account for deployment. The application uses Workers, D1, R2, Queues, a browser binding, and a rate limiter.
- A verified sender and Resend API key if you want email delivery. Google or GitHub OAuth is optional.

## Local setup

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Set a local `BETTER_AUTH_SECRET` in `.dev.vars` before creating accounts. The local D1 database and R2 bucket use Wrangler's local state; migrations run against local D1 by default. Never put production credentials in `.dev.vars.example` or commit `.dev.vars`.

## Deploy your own instance

Read [Deployment](docs/DEPLOYMENT.md) and [Security](SECURITY.md) first. Configure unique D1, R2, and Queue resources in `wrangler.jsonc`, set the required secrets in your own Cloudflare account, and review the code and policies for your use. Deployment is an operator action and does not publish or change Zenith's commercial service.

## Development checks

```sh
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
npm run db:migrate:local
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Audit behavior and scoring](docs/AUDIT-ENGINE.md)
- [Security model](docs/SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Operations](docs/OPERATIONS.md)

Accessibility and security checks are limited automated checks. They do not certify WCAG conformance or replace a penetration test. Only audit sites you own or are authorized to assess.
