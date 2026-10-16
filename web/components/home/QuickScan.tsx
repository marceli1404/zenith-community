import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, api } from "../../lib/api";
import { useAuthConfig } from "../../lib/auth";
import { scoreLabel as getScoreLabel } from "../../lib/format";
import { TextLink } from "../editorial";

type Category = "security" | "accessibility" | "performance" | "seo";
type Severity = "critical" | "high" | "medium" | "low" | "info";

interface ScanFinding {
  ruleId: string;
  category: Category | "reliability";
  severity: Severity;
  title: string;
  description: string;
  recommendation: string;
}

interface ScanResult {
  ok: true;
  url: string;
  finalUrl: string;
  score: {
    overall: number | null;
    categories: Record<Category, number | null>;
    reliabilityDeduction: number | null;
  };
  topFindings: ScanFinding[];
  additionalFindingCount: number;
  robotsTxtFound: boolean;
  sitemapFound: boolean | null;
  brokenLinks: number;
  checkedLinks: number;
  linkCoverage?: {
    discovered: number;
    checked: number;
    limit: number;
    omittedByLimit: number;
    blockedByUnsafePath: number;
    blockedByRobots: number;
    blockedBySafety: number;
    complete: boolean | null;
  };
  httpsRedirects: boolean | null;
}

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      action: "scan";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const categories: Array<[Category, string]> = [
  ["security", "Security"],
  ["accessibility", "Accessibility"],
  ["performance", "Performance"],
  ["seo", "SEO"],
];

export function QuickScan() {
  const { config, loaded } = useAuthConfig();
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [widgetError, setWidgetError] = useState("");
  const widgetContainer = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const siteKey = config?.turnstileSiteKey ?? "";
  const productionWithoutWidget = config?.isProduction === true && !siteKey;
  const turnstileRequired = !!siteKey;

  useEffect(() => {
    if (!siteKey || !widgetContainer.current) return;

    let active = true;
    let loadTimer: ReturnType<typeof setTimeout> | undefined;
    const scriptSelector = 'script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]';
    let script = document.querySelector<HTMLScriptElement>(scriptSelector);
    if (!script) {
      script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.dataset.zenithTurnstile = "true";
      document.head.appendChild(script);
    }

    const render = () => {
      if (!active || !window.turnstile || !widgetContainer.current || widgetId.current) return;
      if (loadTimer) clearTimeout(loadTimer);
      try {
        widgetId.current = window.turnstile.render(widgetContainer.current, {
          sitekey: siteKey,
          action: "scan",
          callback: (value) => {
            setToken(value);
            setWidgetError("");
          },
          "expired-callback": () => setToken(""),
          "error-callback": () => {
            setToken("");
            setWidgetError("Verification could not complete. Try again or reload the page.");
          },
        });
      } catch {
        setWidgetError("Verification could not load. Refresh the page and try again.");
      }
    };
    const onError = () => {
      if (active) setWidgetError("Verification could not load. Check your connection and try again.");
    };

    script.addEventListener("load", render);
    script.addEventListener("error", onError);
    if (window.turnstile) render();
    else loadTimer = setTimeout(onError, 12_000);

    return () => {
      active = false;
      if (loadTimer) clearTimeout(loadTimer);
      script?.removeEventListener("load", render);
      script?.removeEventListener("error", onError);
      if (widgetId.current && window.turnstile) {
        window.turnstile.remove(widgetId.current);
        widgetId.current = null;
      }
    };
  }, [siteKey]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResult(null);

    const trimmed = url.trim();
    let target: URL;
    try {
      target = new URL(trimmed);
    } catch {
      setError("Enter a complete website address, including https://.");
      return;
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      setError("Enter a website address that starts with http:// or https://.");
      return;
    }
    if (trimmed.length > 2048) {
      setError("That address is too long. Use an address under 2,048 characters.");
      return;
    }
    if (productionWithoutWidget) {
      setError("Quick scans are temporarily unavailable because verification is not configured.");
      return;
    }
    if (turnstileRequired && !token) {
      setError("Complete the verification check before scanning.");
      return;
    }

    setScanning(true);
    try {
      const response = await api.post<ScanResult>("/api/scan", {
        url: target.href,
        ...(token ? { turnstileToken: token } : {}),
      });
      setResult(response);
      try {
        sessionStorage.setItem("zenith-community-scan-url", target.href);
      } catch {
        // The scan result remains usable if browser storage is unavailable.
      }
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "We could not reach the scan service. Try again shortly.");
    } finally {
      setScanning(false);
      setToken("");
      if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
    }
  }

  const configUnavailable = loaded && !config;
  const unavailable = productionWithoutWidget || configUnavailable;
  const canSubmit = loaded && !!config && !scanning && !unavailable && (!turnstileRequired || !!token);

  return (
    <div className="lx-scan-flow">
      <form className="lx-scan" onSubmit={submit}>
        <label className="lx-scan__label" htmlFor="quick-scan-url">Website address</label>
        <div className="lx-scan__row">
          <input
            id="quick-scan-url"
            className="lx-scan__input"
            type="url"
            inputMode="url"
            autoComplete="url"
            maxLength={2048}
            placeholder="https://example.com"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            disabled={unavailable || scanning}
            required
          />
          <button className="lx-button lx-button--primary lx-scan__submit" type="submit" disabled={!canSubmit}>
            {scanning ? "Checking…" : "Check site"}
          </button>
        </div>

        {siteKey && (
          <div className="lx-verify" data-open="true">
            <div className="lx-verify__clip">
              <div className="lx-verify__card">
                <p className="lx-verify__title">Verify before scanning</p>
                <p className="lx-verify__hint">Cloudflare protects this public endpoint from automated abuse.</p>
                <div className="lx-verify__frame"><div ref={widgetContainer} className="lx-verify__widget" /></div>
              </div>
            </div>
          </div>
        )}

        {error && <p className="lx-scan__error" role="alert">{error}</p>}
        {widgetError && <p className="lx-scan__error" role="alert">{widgetError}</p>}
        {unavailable && (
          <p className="lx-scan__note" role="status">
            {configUnavailable
              ? "Quick scan settings could not be loaded. Refresh the page and try again."
              : "Quick scans are temporarily unavailable until a dedicated verification widget is configured."}
          </p>
        )}
        {!loaded && <p className="lx-scan__note" role="status">Scan settings are loading. The form becomes available when the service responds.</p>}
        {loaded && !unavailable && !siteKey && config?.isProduction !== true && (
          <p className="lx-scan__note">This local or preview scan does not require a challenge.</p>
        )}
        {siteKey && !token && !widgetError && (
          <p className="lx-scan__note" role="status">Complete the verification check to enable scanning.</p>
        )}
        {!siteKey && config?.isProduction === true && (
          <p className="lx-scan__note">A dedicated Turnstile widget is required before public scans can run.</p>
        )}
      </form>

      {scanning && <ScanLoading />}
      {result && <ScanReport result={result} />}
    </div>
  );
}

function ScanLoading() {
  return (
    <div className="lx-result lx-live-loading" role="status" aria-live="polite">
      <span className="lx-live-loading__beam" aria-hidden="true" />
      <ul className="lx-live-loading__stages" aria-label="Scan steps">
        <li data-state="active"><span className="lx-live-loading__tick" aria-hidden="true">1</span>Connecting to the homepage</li>
        <li><span className="lx-live-loading__tick" aria-hidden="true">2</span>Checking the page and response</li>
        <li><span className="lx-live-loading__tick" aria-hidden="true">3</span>Reviewing links and site files</li>
      </ul>
      <div className="lx-live-skeleton" aria-hidden="true"><span /><span /><span /><span /></div>
    </div>
  );
}

function ScanReport({ result }: { result: ScanResult }) {
  const homepageUnavailable = result.topFindings.some((finding) => finding.ruleId === "reliability.homepage-unavailable");
  const robotsBlocked = result.topFindings.some((finding) => finding.ruleId === "reliability.robots-disallowed");
  const unsafeRequestedPath = result.topFindings.some((finding) => finding.ruleId === "reliability.unsafe-path");
  const incompleteLinks = result.linkCoverage?.complete === false;
  const notAssessed = result.score.overall === null && Object.values(result.score.categories).every((score) => score === null);
  const label = homepageUnavailable ? "Unavailable" : incompleteLinks ? "Not fully assessed" : notAssessed ? "Not assessed" : getScoreLabel(result.score.overall!);
  const displayUrl = result.finalUrl || result.url;
  const firstFailure = notAssessed ? result.topFindings.find((finding) => finding.category === "reliability") : null;

  return (
    <section className="lx-result lx-scan-report" aria-labelledby="quick-scan-result-title" aria-live="polite">
      <div className="lx-result__head">
        <div>
          <p className="lx-label">Quick scan result</p>
          <h3 className="lx-result__url" id="quick-scan-result-title">{displayUrl}</h3>
          <p className="lx-result__url-note">Displayed address omits query strings and likely token-like path segments.</p>
        </div>
        <p className="lx-result__score" aria-label={incompleteLinks ? "Overall score not fully assessed" : notAssessed ? "Overall score not assessed" : `Overall score ${result.score.overall} out of 100, ${label}`}>
          {result.score.overall === null
            ? <span>{label}</span>
            : <><strong className="lx-sheet__number">{result.score.overall}</strong><span>/100 · {label}</span></>}
        </p>
      </div>

      {homepageUnavailable && <p className="lx-result__empty" role="status">{result.topFindings.find((finding) => finding.ruleId === "reliability.homepage-unavailable")?.description} Technical categories are unassessed.</p>}
      {!homepageUnavailable && incompleteLinks && <p className="lx-result__empty" role="status">
        Quick Scan checked {result.linkCoverage!.checked} of {result.linkCoverage!.discovered} discovered same-origin links. No overall score was calculated because link coverage is incomplete.
        {result.linkCoverage!.omittedByLimit > 0 && ` The ${result.linkCoverage!.limit}-link scan limit left ${result.linkCoverage!.omittedByLimit} unchecked.`}
        {result.linkCoverage!.blockedByUnsafePath > 0 && ` Safety rules skipped ${result.linkCoverage!.blockedByUnsafePath} unsafe link${result.linkCoverage!.blockedByUnsafePath === 1 ? "" : "s"}.`}
        {result.linkCoverage!.blockedByRobots > 0 && ` robots.txt blocked ${result.linkCoverage!.blockedByRobots} link${result.linkCoverage!.blockedByRobots === 1 ? "" : "s"}.`}
        {result.linkCoverage!.blockedBySafety > 0 && ` Safety checks prevented checking ${result.linkCoverage!.blockedBySafety} link${result.linkCoverage!.blockedBySafety === 1 ? "" : "s"}.`}
      </p>}
      {!homepageUnavailable && !incompleteLinks && firstFailure && <p className="lx-result__empty" role="status">{firstFailure.description} No score was calculated; technical categories are unassessed.</p>}

      <dl className="lx-result__categories" aria-label="Category scores">
        {categories.map(([key, label]) => {
          const score = result.score.categories[key];
          return <div key={key}><dt>{label}</dt><dd>{score === null ? "Unassessed" : `${score}/100`}</dd></div>;
        })}
      </dl>

      <div className="lx-scan-facts" aria-label="Scan coverage">
        <span>Broken links: <strong>{homepageUnavailable ? "Not checked; homepage could not be assessed" : incompleteLinks ? `${result.brokenLinks} found among ${result.linkCoverage!.checked} checked` : notAssessed ? "Not checked; site not assessed" : `${result.brokenLinks} of ${result.checkedLinks} checked`}</strong></span>
        <span>Reliability impact: <strong>{homepageUnavailable ? "Homepage could not be assessed; score set to 0" : incompleteLinks ? `${result.score.reliabilityDeduction} points from checked links; overall score withheld` : notAssessed ? "Not assessed" : `${result.score.reliabilityDeduction} points deducted`}</strong></span>
        <span>robots.txt: <strong>{unsafeRequestedPath ? "Not checked" : robotsBlocked ? result.robotsTxtFound ? "Checked; scan blocked by robots policy" : "Unavailable; scan not assessed" : result.robotsTxtFound ? "Available" : "Not available"}</strong></span>
        <span>sitemap.xml: <strong>{homepageUnavailable || notAssessed || result.sitemapFound === null ? "Not checked" : result.sitemapFound ? "Available" : "Not available"}</strong></span>
        <span>HTTP to HTTPS: <strong>{homepageUnavailable || notAssessed ? "Not checked" : result.httpsRedirects === null ? "Not verified" : result.httpsRedirects ? "Redirect detected" : "No redirect detected"}</strong></span>
      </div>

      <h4 className="lx-result__subhead">Findings</h4>
      {result.topFindings.length ? (
        <ul className="lx-result__findings">
          {result.topFindings.map((finding) => (
            <li className="lx-result__finding" key={finding.ruleId}>
              <span className={`lx-severity lx-severity--${finding.severity}`}>{finding.severity}</span>
              <div>
                <p className="lx-result__finding-title">{finding.title}</p>
                <p className="lx-result__finding-text">{finding.description} {finding.recommendation}</p>
              </div>
              <span className="lx-result__finding-category">{finding.category}</span>
            </li>
          ))}
        </ul>
      ) : <p className="lx-result__empty">No findings were returned by this quick scan.</p>}

      {result.additionalFindingCount > 0 && (
        <p className="lx-result__empty">{result.additionalFindingCount} more {result.additionalFindingCount === 1 ? "finding was" : "findings were"} found. The quick scan shows the highest severity items.</p>
      )}

      <div className="lx-result__next">
        <p>This quick scan checks one page and up to eight same-origin links. It does not crawl the whole site or run browser-only checks.</p>
        <div className="lx-result__actions">
          <TextLink to="/signup">Create an account to monitor this site</TextLink>
          <TextLink to="/methodology">Read the scoring method</TextLink>
        </div>
      </div>
    </section>
  );
}
