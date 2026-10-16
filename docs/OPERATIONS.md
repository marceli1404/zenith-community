# Operations

## First-run checklist

1. Confirm D1 migrations and all bindings match your deployment's resource names.
2. Set `BETTER_AUTH_SECRET`, `APP_URL`, and an HTTPS origin before enabling accounts.
3. Configure email and Turnstile if signup verification or public scans are enabled.
4. Create a test account, add a site you control, verify ownership, and confirm a scheduled check runs.
5. Run an audit and verify findings, score, report generation, and an optional status page.

## Production build and deployment

Set `PRODUCTION_APP_URL` to the public HTTPS origin for the Worker before building or deploying. The production build writes an ignored `wrangler.production.jsonc` file with that origin and `ENVIRONMENT=production`; the hostname is not stored in the repository.

In PowerShell:

```powershell
$env:PRODUCTION_APP_URL = "https://your-public-hostname"
npm run deploy
Remove-Item Env:PRODUCTION_APP_URL
```

`npm run deploy` builds with `wrangler.production.jsonc`. The Cloudflare Vite plugin generates the deployment config at `dist/<worker-name>/wrangler.json` and redirects Wrangler to it. Keep the default `wrangler deploy` command so it uses that built config. `npm run build` uses development settings and is for local work. Email remains disabled unless an operator configures delivery separately.

## Queues and monitoring

The Worker processes `zenith-community-monitor`, `zenith-community-audit`, and `zenith-community-email` messages. A scheduled task retries email outbox rows that could not be published to the queue; codes and links expire before they can be sent late. The email queue sends messages that exhaust consumer retries to `zenith-community-email-dlq`. Check that queue regularly and recover messages before Cloudflare's four-day retention expires. Dead-letter messages can contain one-time codes, reset links, and email addresses; restrict dashboard access and never paste their bodies into tickets or logs. Inspect failed messages and retry behavior in the Cloudflare dashboard. Checks use HTTP requests; audits may use Browser Rendering for a subset of checks and report assets.

## Data management

Account owners can export or delete account data in Settings. The deployment operator is responsible for backups, retention configuration, Cloudflare access controls, and responding to data requests. Review local and Cloudflare logs before sharing diagnostics; redact credentials and personal data.
