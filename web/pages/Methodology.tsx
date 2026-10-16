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
            (25% each), then reliability deductions are subtracted from the overall score. The result is rounded and clamped to 0-100.
          </p>
          <p>
            Reliability findings also reduce a calculated overall score. Repeated linked-page failures are charged per affected URL, up to five
            URLs for each rule. If browser checks do not finish, those checks remain unassessed and no overall score is calculated.
          </p>
          <p>
            If the crawler cannot retrieve a complete HTML homepage, the overall score is 0/100 and category scores are unassessed.
            This includes a failed request, an HTTP error other than 429, a partial response, a non-HTML or empty body, or a generic server-error title or
            page—even when it returns HTTP 200. A matching error heading with diagnostic output also counts as a homepage failure.
            HTTP 429 only means the scanner was rate-limited, so the audit is marked Not assessed rather than scored as an outage.
            The same applies if the browser's main-document response fails or is missing, is empty
            or partial, or renders no visible homepage content. Browser responses of 204 or 205 are empty; 206 is partial. If the
            crawler and browser receive different homepage responses, the report shows both observations. If browser analysis cannot
            run at all, its checks stay unassessed and no overall score is calculated. A homepage redirect blocked by robots.txt or
            crawler safety policy is marked Not assessed. If robots.txt disallows the homepage or cannot be read safely, no site pages
            are checked and the audit is marked Not assessed.
          </p>
          <p>
            The scanner reads at most 1.5 MB from each page response. If it reaches that limit, it does not calculate a score because
            the complete page content was not checked. The result identifies the affected page so you can reduce its response size or
            raise the scan limit in your Community installation.
          </p>
          <p>
            The public Quick Scan reads the homepage HTML without rendering it or checking whether embedded media loaded. An exact
            generic server-error title or a compact matching page is treated as unavailable, even if it returns HTTP 200. A matching
            error heading with diagnostic output also signals an unavailable homepage. When a page has
            no readable text, Quick Scan can recognize some embedded media, such as images, video, audio, and frames, and mark it Not
            assessed. It does not render the page or detect every way media can appear.
          </p>
          <p>
            Quick Scan checks up to eight eligible same-origin links. If its limit, robots.txt, a safety check, or a rate limit leaves a discovered
            link unchecked, the result reports how many links were checked and withholds the overall score.
          </p>
        </>
      ),
    },
    {
      id: "deductions",
      title: "Severity deductions",
      content: (
        <>
          <p>Each distinct category issue reduces its category score by a fixed amount. Reliability issues reduce the overall score by the same amount, once per affected URL up to five URLs for each rule:</p>
          <p>For linked-page HTTP failures, 5xx responses are critical and 4xx responses other than 429 are high; network failures are medium. A 429 response means the scanner was rate-limited, so the page is unverified and no whole-site score is calculated. A quick scan confirms a linked page with one GET if HEAD returns a non-2xx response other than 429. It also tries GET if HEAD fails with a DNS/network, TLS, or timeout error. It does not retry 429 responses or crawler safety-policy blocks. Submitted URLs and discovered links with action-like paths, such as unsubscribe or logout, are skipped.</p>
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
      title: "How repeated findings count",
      content: (
        <>
          <p>
            Findings are grouped by the rule that produced them before scoring. A repeated category issue, such as a missing security
            header, is one deduction even when it appears on many pages. Reliability failures reduce the overall score per affected URL,
            up to five URLs for each rule.
          </p>
          <p>
            Each group lists the affected URLs. Stable rule identities also let us show which findings are new, ongoing or resolved
            compared with your previous audit.
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
        <>
          <p>
            Page discovery stays on the submitted origin and matches the Allow and Disallow patterns in robots.txt against page paths and queries. The public quick scan checks robots.txt before requesting the homepage; when the file disallows the path or a server/network error prevents it from being read, no score is calculated. A 4xx response is treated as if no robots.txt file exists, so the crawl continues.
          </p>
          <p>
            If the rules disallow the homepage, no site pages are requested. A server or network error while fetching robots.txt prevents requests to that host. Audits are limited to 250 pages by default, with bounds
            on link discovery, crawl depth, concurrency and response size. If those limits, a robots.txt block, an unreachable linked page, a partial response or HTTP 429 leaves a known same-origin page unchecked, the audit is marked Not assessed rather than receiving a whole-site score. Redirects and browser resources must pass public-target and robots.txt
          checks and may use another public host. The crawler checks a redirect destination's robots.txt before following it.
          Requests use GET or HEAD, and known state-changing paths such as sign-out and admin pages
          are skipped. A target can still cause side effects through a GET route or page script. Browser rendering is used on the homepage;
          remaining pages are analysed at the HTTP level.
          </p>
        </>
      ),
    },
    {
      id: "monitoring",
      title: "Monitoring",
      content: (
        <p>
          The Community edition checks each monitored site every 60 seconds by default and records HTTP status, response time and errors.
          A 2xx response counts as available for uptime monitoring; audits separately require an assessable HTML homepage. An incident
          opens after two consecutive failed checks and resolves on the next successful one. Notification delivery depends on the
          operator&rsquo;s email configuration.
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
