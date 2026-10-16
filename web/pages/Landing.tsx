import { PublicPage } from "../components/PublicChrome";
import { ButtonLink, Container, Section, SectionLabel, TextLink } from "../components/editorial";
import { QuickScan } from "../components/home/QuickScan";
import { useDocumentTitle } from "../lib/useTitle";

export default function Landing() {
  useDocumentTitle("Zenith Community — self-hosted website monitoring");
  return (
    <PublicPage>
      <Section tone="paper" rhythm="open" className="lx-hero">
        <Container>
          <div className="lx-hero__copy">
            <SectionLabel>Zenith Community · self-hosted</SectionLabel>
            <h1 className="lx-heading lx-heading--hero">Know when your website needs attention.</h1>
            <p className="lx-hero__lead">Monitor availability, review technical checks, and keep an audit history in an instance you operate.</p>
            <div className="lx-hero__action"><ButtonLink to="/signup">Create a Community account</ButtonLink><TextLink to="/methodology">See how scoring works</TextLink></div>
          </div>
        </Container>
      </Section>
      <Section id="quick-scan" tone="ivory" rhythm="open" labelledBy="quick-scan-title">
        <Container>
          <header className="lx-sectionhead">
            <SectionLabel>Quick scan</SectionLabel>
            <h2 className="lx-heading lx-heading--section" id="quick-scan-title">Check a site before you monitor it.</h2>
            <p className="lx-body">Quick Scan checks the homepage and up to eight same-origin links. If the homepage is unreachable, returns an HTTP error, is empty or non-HTML, or matches a generic server-error signature, its score is 0/100. A matching error heading with diagnostic output also counts, even if the server returns HTTP 200. Technical categories are unassessed.</p>
            <p className="lx-body">It reads HTML without rendering the page. When a homepage has no readable text, Quick Scan can recognize some embedded media, such as images, video, audio, and frames, and mark it Not assessed. If robots.txt or a safety check prevents a page request, no score is calculated.</p>
          </header>
          <QuickScan />
        </Container>
      </Section>
      <Section tone="ivory" rhythm="open">
        <Container>
          <SectionLabel>Included</SectionLabel>
          <h2 className="lx-heading lx-heading--section">The tools to check and follow up.</h2>
          <ul className="lx-list">
            <li>Scheduled uptime checks and incident history.</li>
            <li>Website audits with findings and recommendations.</li>
            <li>Reports and account data controls.</li>
          </ul>
          <p>Zenith Community is a self-hosted edition. You provide and operate its Cloudflare resources and email delivery.</p>
          <TextLink to="/security">Read the security notes</TextLink>
        </Container>
      </Section>
    </PublicPage>
  );
}
