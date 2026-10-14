# Operations

## First-run checklist

1. Confirm D1 migrations and all bindings match your deployment's resource names.
2. Set `BETTER_AUTH_SECRET`, `APP_URL`, and an HTTPS origin before enabling accounts.
3. Configure email and Turnstile if signup verification or public scans are enabled.
4. Create a test account, add a site you control, verify ownership, and confirm a scheduled check runs.
5. Run an audit and verify findings, score, report generation, and an optional status page.

## Queues and monitoring

The Worker processes `zenith-monitor`, `zenith-audit`, and `zenith-email` messages. Inspect failed messages and retry behavior in the Cloudflare dashboard. Checks use HTTP requests; audits may use Browser Rendering for a subset of checks and report assets.

## Data management

Account owners can export or delete account data in Settings. The deployment operator is responsible for backups, retention configuration, Cloudflare access controls, and responding to data requests. Review local and Cloudflare logs before sharing diagnostics; redact credentials and personal data.
