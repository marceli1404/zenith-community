import { PublicPage } from "../components/PublicChrome";
import { ButtonLink, Container, PageHero, Section } from "../components/editorial";
import { useTitle } from "../lib/useTitle";

export default function Contact() {
  useTitle("Contact the operator", "How to contact the person or team operating this Zenith Community installation.");

  return (
    <PublicPage>
      <PageHero
        label="Contact"
        title={<>Contact the <em>operator.</em></>}
        lead="Zenith Community is self-hosted, so there is no shared support inbox. Contact the person or team that provided this installation."
      />

      <Section tone="ivory" rhythm="default" labelledBy="operator-title">
        <Container>
          <h2 id="operator-title" className="lx-heading lx-heading--section">Before you use this installation</h2>
          <p className="lx-body">
            Ask the operator for their contact details, privacy information, and data-retention policy. These details depend on how this instance is configured.
          </p>
          <p className="lx-body">
            If you installed Zenith Community yourself, add your own contact information and policies before inviting other people to create accounts.
          </p>
          <ButtonLink to="/security">Read the security notes</ButtonLink>
        </Container>
      </Section>
    </PublicPage>
  );
}
