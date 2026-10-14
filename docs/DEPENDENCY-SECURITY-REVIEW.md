# Dependency security review

Reviewed 14 October 2026 against the Community release candidate's clean npm
install and production build.

## Puppeteer archive extraction advisory

`npm audit` reports three high-severity dependency entries through
`@cloudflare/puppeteer` → `@puppeteer/browsers` → `extract-zip`. The current
`extract-zip` release is affected by [GHSA-7pqw-9j4j-h8q3](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3); the advisory lists no patched
version. npm's suggested downgrade for `@cloudflare/puppeteer` is a major
version change and is not applied without compatibility evidence.

The affected extraction path installs browser archives. This application
does not install browser binaries. Its audit and PDF code call
`@cloudflare/puppeteer.launch` with Cloudflare's Browser Rendering binding;
that launch path acquires a remote session and connects to it. The built
Worker bundle contains no `extract-zip` or browser archive installation
code. There are no install scripts in this dependency path that download or
extract a browser during `npm ci`.

Assessment: the audit finding remains visible and should be rechecked on every
dependency update. Based on the current source and built Worker bundle, the
vulnerable archive extraction code is not reachable in the shipped Community
application. Reassess before adding local browser installation, a self-hosted
browser launcher, or another path that extracts downloaded archives.
