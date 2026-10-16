# Security

Zenith Community makes outbound requests to the public websites an operator or account owner submits. Use it only for sites you own or have permission to assess.

## Deployment responsibilities

- Keep `BETTER_AUTH_SECRET`, OAuth credentials, email keys, and Turnstile secrets in Cloudflare secrets or local `.dev.vars`; never commit them.
- Use separate Cloudflare resources for each deployment. Do not reuse production databases, buckets, or queues for local development.
- Set a public HTTPS `APP_URL` before enabling accounts. Configure OAuth callback URLs to match that deployment.
- Restrict access to the Cloudflare account, review logs, and set data retention appropriate to your users.
- Enable Turnstile for public scans and configure an email provider before enabling email verification or notifications.

The crawler and browser checks validate public targets and redirect destinations to reduce server-side request forgery risk. IP-literal URLs are rejected; use a public hostname. Browser requests using methods other than GET or HEAD and known state-changing paths are blocked. A target may still cause side effects through a GET route or page script. Workers fetch does not expose the resolved DNS address, so a hostname that changes from a public address to a private one between validation and connection cannot be fully ruled out here. These controls reduce risk but cannot make arbitrary user-supplied URLs risk-free. Do not expose an instance to untrusted users without reviewing its configuration and network behavior.

## Reporting a vulnerability

For an issue affecting one installation, contact that installation's operator.
For a vulnerability in the Community source, use GitHub's private
vulnerability reporting feature when it is enabled. If private reporting is
unavailable, do not post exploit details publicly; maintainers must enable
private reporting or add a private contact method here before requesting
reports. Do not include credentials or personal data in an initial report.
