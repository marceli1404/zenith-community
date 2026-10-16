# Historical dependency security review

Reviewed 14 October 2026 against that Community release candidate's clean npm
install and production build. This is a historical assessment, not the current
dependency inventory. A fresh `npm audit` on the current `package-lock.json` on
16 October 2026 reports zero vulnerabilities, and the current lockfile does not
contain `extract-zip`. The original 14-advisory/2-critical report from the
historical review was not recovered, so its findings cannot be reconciled one
by one against this result.

## Advisory found in the 14 October candidate

At review time, `npm audit` reported three high-severity dependency entries through
`@cloudflare/puppeteer` → `@puppeteer/browsers` → `extract-zip`. The audited
`extract-zip` version was listed as affected by
[GHSA-7pqw-9j4j-h8q3](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3); at
that time, the advisory listed no patched version. npm suggested a major
version downgrade for `@cloudflare/puppeteer`, which was not applied without
compatibility evidence.

The affected extraction path installs browser archives. The 14 October
candidate did not install browser binaries. Its audit and PDF code called
`@cloudflare/puppeteer.launch` with Cloudflare's Browser Rendering binding;
that launch path acquired a remote session and connected to it. The built
Worker bundle inspected for that review contained no `extract-zip` or browser
archive installation code. No install scripts in the inspected dependency
path downloaded or extracted a browser during `npm ci`.

Assessment at that time: the report kept the audit finding visible for review
on later dependency updates. Based on the source and built Worker bundle
inspected on 14 October, the vulnerable archive extraction code was not
reachable in that Community candidate. The report recommended reassessing
this if local browser installation, a self-hosted browser launcher, or another
archive-extraction path were added.
