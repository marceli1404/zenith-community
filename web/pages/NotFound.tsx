import { PublicPage } from "../components/PublicChrome";
import { ButtonLink, TextLink } from "../components/editorial";
import { useDocumentTitle } from "../lib/useTitle";

export default function NotFound() {
  // Title only: useTitle would also point the canonical at the mistyped URL.
  useDocumentTitle("Page not found");

  return (
    <PublicPage>
      <section className="lx-notfound tx-paper" aria-labelledby="nf-title">
        <div className="lx-container">
          <p className="lx-notfound__code" aria-hidden="true">
            <span>4</span>
            <span><em>0</em></span>
            <span>4</span>
          </p>
          <div className="lx-enter">
            <h1 id="nf-title" className="lx-heading lx-heading--section">This page isn&rsquo;t here.</h1>
            <p>The address may be mistyped or the page may have moved. Try one of these pages instead.</p>
            <div className="lx-notfound__actions">
              <ButtonLink to="/">Return home</ButtonLink>
              <TextLink to="/methodology">See how scoring works</TextLink>
            </div>
          </div>
        </div>
      </section>
    </PublicPage>
  );
}
