import { useMemo, useState } from "react";
import { CHECKS, CHECK_FAMILIES, type CheckFamily } from "../../content/checks";
import { Accordion, Chip, Container, Heading, Section, SectionLabel } from "../editorial";

/**
 * The check library: every check Zenith runs, filterable by family, each one
 * expandable to what it does, why it matters, what it pairs with, what to avoid
 * and exactly how Zenith checks it. Lives on the methodology page, as the
 * detail behind its short "What gets checked" summary.
 */
export function CheckLibrary() {
  const [family, setFamily] = useState<CheckFamily | "all">("all");
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: CHECKS.length };
    for (const x of CHECKS) c[x.family] = (c[x.family] ?? 0) + 1;
    return c;
  }, []);
  const shown = family === "all" ? CHECKS : CHECKS.filter((c) => c.family === family);

  return (
    <Section id="library" tone="paper" rhythm="default" labelledBy="library-title">
      <Container className="lx-library">
        <header className="lx-library__head">
          <SectionLabel>Check library</SectionLabel>
          <Heading id="library-title">What Zenith checks, and how.</Heading>
          <p className="lx-lead">
            These are the checks behind every score. Each one says what it catches, what it pairs with, and where our coverage stops.
          </p>
        </header>

        <div className="lx-library__body">
          <div className="lx-library__filters" role="group" aria-label="Filter checks">
            <Chip pressed={family === "all"} onClick={() => setFamily("all")} count={counts.all}>
              All
            </Chip>
            {CHECK_FAMILIES.map((f) => (
              <Chip key={f.id} pressed={family === f.id} onClick={() => setFamily(f.id)} count={counts[f.id] ?? 0}>
                {f.label}
              </Chip>
            ))}
          </div>

          <p className="sr-only" role="status" aria-live="polite">
            Showing {shown.length} {shown.length === 1 ? "check" : "checks"}
          </p>

          <Accordion
            key={family}
            entries={shown.map((c) => ({
              id: c.id,
              title: c.name,
              meta: c.severity ? <span className={`lx-severity lx-severity--${c.severity}`}>{c.severity}</span> : undefined,
              content: (
                <div className="lx-check">
                  <p className="lx-check__what">{c.what}</p>
                  <p className="lx-check__why">{c.why}</p>
                  <dl className="lx-check__facts">
                    <div>
                      <dt>Works well with</dt>
                      <dd>
                        <ul>{c.worksWith.map((w) => <li key={w}>{w}</li>)}</ul>
                      </dd>
                    </div>
                    <div>
                      <dt>Avoid</dt>
                      <dd>
                        <ul>{c.avoid.map((w) => <li key={w}>{w}</li>)}</ul>
                      </dd>
                    </div>
                    <div className="lx-check__how">
                      <dt>How Zenith checks it</dt>
                      <dd>{c.how}</dd>
                    </div>
                  </dl>
                </div>
              ),
            }))}
          />
        </div>
      </Container>
    </Section>
  );
}
