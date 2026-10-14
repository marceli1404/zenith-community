import { PublicPage } from "../components/PublicChrome";
import { ButtonLink, Container, DocLayout, EndCta, Heading, PageHero, Section, TextLink, type DocEntry } from "../components/editorial";
import { useTitle } from "../lib/useTitle";

/**
 * Security page. Every statement here must describe what the product actually does.
 * No compliance/certification claims (no SOC 2, ISO 27001, pen-test badges) —
 * those would be false.
 */

const SECTIONS: Array<{ id: string; title: string; body: string[] }> = [
  {
    id: "ownership",
    title: "Only monitor sites you are allowed to assess",
    body: [
      "Use the scanner only for websites you own or have permission to assess. The operator of each installation is responsible for who can create accounts and which sites they can monitor.",
    ],
  },
  {
    id: "scan",
    title: "What a scan actually does",
    body: [
      "The scanner uses GET requests to read public page content and HEAD requests to check redirects and links.",
      "It does not submit forms, log in, modify site content, or attempt exploits. It reads response headers and HTML; browser rendering is used for audit checks that require it.",
      "Full audits respect robots.txt, stay on your own origin, and are bounded in pages, depth and response size.",
    ],
  },
  {
    id: "private-infrastructure",
    title: "We cannot be pointed at private infrastructure",
    body: [
      "URLs and redirect destinations are validated before requests are made. Loopback, private, link-local and other reserved network ranges are rejected.",
      "Only http and https on standard ports are allowed, URLs containing credentials are rejected, and each redirect hop is validated before the next request.",
    ],
  },
  {
    id: "reports",
    title: "Storage depends on the installation",
    body: [
      "The application stores reports and account data in the resources configured by the operator. Operators must restrict access to those resources and publish their own data-handling policy.",
      "Sessions use secure, httpOnly cookies. State-changing API requests are protected by a same-origin check.",
    ],
  },
  {
    id: "your-data",
    title: "You can take your data out, or delete it",
    body: [
      "Account export and deletion are available in Settings. The operator is responsible for configuring storage, backups, and retention for the installation.",
    ],
  },
];

export default function Security() {
  useTitle(
    "Security notes",
    "How Zenith Community scans behave, the network boundaries in the crawler, and the responsibilities of each installation operator.",
  );

  const entries: DocEntry[] = SECTIONS.map((s) => ({
    id: s.id,
    title: s.title,
    content: s.body.map((p) => <p key={p.slice(0, 24)}>{p}</p>),
  }));

  return (
    <PublicPage>
      <PageHero
        label="Security"
        title={<>What Zenith does, and <em>what it refuses to do.</em></>}
        lead="Read the scanner's network boundaries and the responsibilities of the person operating this installation."
      >
        <TextLink to="/contact">Contact the installation operator</TextLink>
      </PageHero>

      <DocLayout entries={entries} />

      <Section tone="stone" texture="linen" rhythm="tight" labelledBy="claims-title">
        <Container className="lx-sectionhead">
          <div>
            <Heading id="claims-title">What these checks do not mean.</Heading>
          </div>
          <p className="lx-body">
            Security checks are passive configuration checks, not a penetration test. Accessibility checks are automated and
            cannot certify WCAG compliance. A high score is not a security or accessibility certification.
          </p>
        </Container>
      </Section>

      <EndCta title={<>Found something?</>} body="Contact the operator of this installation. For source-code issues, use the reporting instructions in the Community repository.">
        <ButtonLink to="/contact">Contact the operator</ButtonLink>
      </EndCta>
    </PublicPage>
  );
}
