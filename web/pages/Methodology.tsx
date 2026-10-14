import type { CSSProperties } from "react";
import { PublicPage } from "../components/PublicChrome";
import { Callout, DocLayout, EndCta, ButtonLink, PageHero, TextLink, type DocEntry } from "../components/editorial";
import { CheckLibrary } from "../components/home/CheckLibrary";
import { useTitle } from "../lib/useTitle";
import { SEVERITY_DEDUCTION } from "@shared/scoring";

/**
 * Methodology page. Values are imported from the live scoring module so this
 * page cannot drift away from the implementation.
 */

const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;

export default function Methodology() {
  useTitle(
    "How scoring works",
    "How the Zenith Score is calculated: category scoring, severity deductions, finding grouping, crawl boundaries, and the limits of automated checks.",
  );

  const max = Math.max(...SEVERITIES.map((s) => SEVERITY_DEDUCTION[s]), 1);

  const entries: DocEntry[] = [
    {
      id: "score",
      title: "The Zenith Score",
      content: (
        <>
          <p>
            Four categories are scored independently: Security, Accessibility, Search (SEO) and Performance. Each starts at 100 and
            loses points for each distinct issue found. The overall Zenith Score is the equally weighted average of those four
            (25% each), rounded and clamped to 0-100.
          </p>
          <p>
            Reliability findings are normally reported separately because uptime and incidents measure a different thing over a
            different time window. If the homepage returns an HTTP error or cannot be reached during a scan or audit, the overall Zenith
            Score is 0/100 and the report records that the site could not be assessed.
          </p>
        </>
      ),
    },
    {
      id: "deductions",
      title: "Severity deductions",
      content: (
        <>
          <p>Each distinct issue reduces its category score by a fixed amount:</p>
          <ul className="lx-deductions" aria-label="Points deducted per issue, by severity">
            {SEVERITIES.map((sev) => (
              <li key={sev}>
                <span className="lx-deductions__value lx-numeric">&minus;<span className="lx-count" style={{ "--to": SEVERITY_DEDUCTION[sev] } as CSSProperties}>{SEVERITY_DEDUCTION[sev]}</span></span>
                <span className="lx-deductions__name">{sev}</span>
                <span className="lx-deductions__bar" aria-hidden="true" style={{ "--weight": SEVERITY_DEDUCTION[sev] / max } as CSSProperties} />
              </li>
            ))}
          </ul>
        </>
      ),
    },
    {
      id: "grouping",
      title: "One issue counts once",
      content: (
        <>
          <p>
            Findings are grouped by the rule that produced them before scoring. A single misconfiguration that appears on two
            hundred pages is one finding with two hundred affected URLs, not two hundred deductions. Without this, large sites
            would be penalised simply for being large.
          </p>
          <p>
            Because rule identity is stable, we can also tell you which findings are new, ongoing or resolved compared with your
            previous audit.
          </p>
        </>
      ),
    },
    {
      id: "checks",
      title: "What gets checked",
      content: (
        <ul>
          <li><strong>Security</strong>: response headers and transport configuration: HTTPS, HSTS, CSP, frame protection, content-type options, referrer policy, cookie flags.</li>
          <li><strong>Search</strong>: titles, meta descriptions, canonical URLs, headings, document language, indexability, sitemap and robots availability, broken internal links.</li>
          <li><strong>Accessibility</strong>: automated checks including image alternatives, document language and responsive viewport.</li>
          <li><strong>Performance</strong>: laboratory measurements: server response time, document size, and browser render timings on the homepage.</li>
        </ul>
      ),
    },
    {
      id: "crawl",
      title: "Crawl boundaries",
      content: (
        <p>
          Audits stay on your own origin, respect robots.txt, and are limited to 250 pages by default, with bounds on crawl depth,
          concurrency and response size. Audits use GET requests to retrieve pages and skip state-changing paths such as sign-out
          and admin pages. Browser rendering is used on the homepage while remaining pages are analysed at the HTTP level.
        </p>
      ),
    },
    {
      id: "monitoring",
      title: "Monitoring",
      content: (
        <p>
          The Community edition checks each monitored site every 60 seconds by default and records status, response time and errors.
          An incident opens after two consecutive failed checks and resolves on the next successful one. Notification delivery depends
          on the operator&rsquo;s email configuration.
        </p>
      ),
    },
    {
      id: "limits",
      title: "Limits you should know",
      content: (
        <>
          <ul>
            <li>Security checks are <strong>passive configuration checks</strong>. They are not a penetration test, and a perfect score does not mean your site is secure.</li>
            <li>Automated accessibility testing catches a meaningful subset of issues but <strong>cannot certify WCAG compliance</strong>. Manual testing is still required.</li>
            <li>Performance figures are <strong>laboratory measurements</strong> from a single render, not field data from your real visitors.</li>
            <li>Scores are a prioritisation aid, not an industry certification.</li>
          </ul>
          <Callout tone="note" title="Questions about a result?">
            <p>Compare the finding and its evidence with the rule described here. If they do not match, contact the operator of this installation.</p>
          </Callout>
        </>
      ),
    },
  ];

  return (
    <PublicPage>
      <PageHero
        label="Methodology"
        title={<>How Zenith <em>scores</em> your site.</>}
        lead="A score is only useful if you can see how it was produced. Here is the exact method, taken from the code that runs your audits."
      >
        <TextLink to="/security">Read the scan boundaries</TextLink>
      </PageHero>

      <DocLayout entries={entries} />

      {/* The full, filterable check library — the detail behind the short
          "What gets checked" list above. */}
      <CheckLibrary />

      <EndCta title={<>Start with an <em>instance you operate.</em></>} body="Set up Zenith Community with your own Cloudflare resources before inviting users.">
        <ButtonLink to="/signup">Create an account</ButtonLink>
        <TextLink to="/security">How scans behave</TextLink>
      </EndCta>
    </PublicPage>
  );
}
