import { useParams } from "react-router-dom";
import { PublicPage } from "../components/PublicChrome";
import { Container, DocLayout, PageHero, Section, type DocEntry } from "../components/editorial";
import { useTitle } from "../lib/useTitle";

const DOCUMENTS: Record<string, { title: string; description: string; entries: DocEntry[] }> = {
  privacy: {
    title: "Privacy information",
    description: "How the operator of this Zenith Community installation handles account and site data.",
    entries: [
      { id: "operator", title: "This installation has its own operator", content: <p>Zenith Community is self-hosted software. The person or team operating this installation controls its hosting, database, email delivery, authentication providers, logs, and retention settings. Ask them for a complete privacy notice before creating an account.</p> },
      { id: "data", title: "Data the software can handle", content: <p>Depending on the installation, Zenith may process account details, website URLs, uptime results, audit findings, reports, and notification preferences. The operator chooses where these records are stored and which external providers are enabled.</p> },
      { id: "operator-details", title: "Operator details needed", content: <p>If you run this installation, replace this notice with your contact details, providers, purposes, retention periods, and the rights available to your users before enabling public registration.</p> },
    ],
  },
  terms: {
    title: "Terms information",
    description: "Use and service terms for this Zenith Community installation.",
    entries: [
      { id: "operator", title: "Terms are set by the operator", content: <p>Zenith Community is self-hosted software. The operator of this installation sets its service terms, availability, support, and any charges. Ask them for those terms before relying on the service.</p> },
      { id: "authorised-use", title: "Authorised use", content: <p>Only monitor or audit websites you own or have permission to assess. Scans make requests to public pages and do not certify security, accessibility, or legal compliance.</p> },
      { id: "operator-details", title: "Operator details needed", content: <p>If you operate this installation, publish your own terms and support contact before inviting other people to use it.</p> },
    ],
  },
};

export default function Legal() {
  const { doc } = useParams();
  const content = DOCUMENTS[doc ?? ""] ?? DOCUMENTS.privacy!;
  useTitle(content.title, content.description);

  return (
    <PublicPage>
      <PageHero label="Community edition" title={content.title} lead={content.description} />
      <DocLayout entries={content.entries} />
      <Section tone="paper" rhythm="tight" labelledBy="legal-operator-note">
        <Container>
          <h2 id="legal-operator-note" className="lx-heading lx-heading--title lx-group-title">For the installation operator</h2>
          <p className="lx-body">These pages are starter notices for self-hosted software, not complete legal documents. Configure them for your deployment and get appropriate review before public registration.</p>
        </Container>
      </Section>
    </PublicPage>
  );
}
