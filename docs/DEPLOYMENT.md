# Deployment

Each deployment is operated by its owner in a separate Cloudflare account. The repository's default configuration uses local Wrangler state and placeholder resource names; replace them with resources created for your own instance before deploying.

## 1. Install and configure

```sh
npm ci
wrangler login
```

Edit `wrangler.jsonc` and set the D1 `database_id` and names for your own D1 database, R2 bucket, and three Queues (`zenith-monitor`, `zenith-audit`, `zenith-email`). Keep the browser binding and rate-limit binding names aligned with the Worker code. Do not copy production IDs or secrets from another deployment.

The Worker uses a browser binding for best-effort browser checks and PDF generation. Confirm that Browser Rendering is available for your Cloudflare account before relying on those outputs.

## 2. Apply migrations

```sh
npm run db:migrate:local
```

For your own remote database, first set its ID in your local `wrangler.jsonc`, review the schema and target account, then run:

```sh
npm run db:migrate:remote
```

The remote command is intentionally separate from local setup. Never point it at a production service unless you have reviewed the migration and have a recovery plan.

## 3. Configure secrets and services

Set a unique authentication secret:

```sh
wrangler secret put BETTER_AUTH_SECRET
```

For Resend email, configure `EMAIL_PROVIDER=resend` and a verified `EMAIL_FROM` address in Wrangler vars, then add:

```sh
wrangler secret put RESEND_API_KEY
```

If public scanning is enabled, configure a Turnstile widget with an allowed host and set `TURNSTILE_SITE_KEY` as a variable and `TURNSTILE_SECRET_KEY` as a secret. Google and GitHub sign-in are optional and require their respective OAuth IDs/secrets and callback URLs.

## 4. Build and deploy

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run deploy
```

Before deploying, inspect the generated Worker bindings, test authentication, create a site you control, verify it, run an audit, check a report, and test account export/deletion in a non-production instance. This repository does not deploy or update the commercial Zenith service.
