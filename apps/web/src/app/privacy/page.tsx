import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import { Container } from "@/components/shared/Container";
import { he } from "@/content/he";

/*
 * The hosted privacy policy. It exists as a page rather than a link to SECURITY.md
 * because the Anthropic connector submission asks for a policy URL, and because a
 * shopper who wants to know what happens to their address should not have to read
 * a repository to find out.
 *
 * Copy lives in content/he.ts with the rest of the page text. Deliberately Hebrew
 * only, matching the site; docs/connector-submission.md carries a translation for
 * reviewers who do not read it.
 */
export const revalidate = 3600;

export const metadata: Metadata = {
  title: `${he.privacy.title} | ${he.header.brand}`,
  description: he.privacy.intro,
  alternates: { canonical: he.privacy.slug },
};

export default function PrivacyPage() {
  return (
    <>
      <SiteHeader />
      <main>
        {/* The header's skip link and logo both target #top, which otherwise only
            exists on the home page's Hero. */}
        <article id="top" className="py-[var(--space-section-tight)]">
          <Container className="max-w-[760px]">
            <h1 className="display text-[length:var(--step-4)]">{he.privacy.title}</h1>

            <p className="mt-3 text-sm text-ink-muted">
              {he.privacy.updatedLabel} {he.privacy.updatedOn}
            </p>

            <p className="mt-6 max-w-[64ch] text-[length:var(--step-1)] leading-[1.7]">
              {he.privacy.intro}
            </p>

            <div className="mt-10 grid gap-8">
              {he.privacy.sections.map((section) => (
                <section key={section.heading}>
                  <h2 className="display text-[length:var(--step-2)]">{section.heading}</h2>
                  <p className="mt-2 max-w-[64ch] leading-[1.7] text-ink-muted">
                    {section.body}
                    {"contactEmail" in section && section.contactEmail ? (
                      <>
                        {" "}
                        <a
                          href={`mailto:${section.contactEmail}`}
                          className="font-semibold text-ink underline decoration-2 underline-offset-4"
                        >
                          {section.contactEmail}
                        </a>
                      </>
                    ) : null}
                  </p>
                </section>
              ))}
            </div>

            <p className="mt-12">
              <Link
                href="/"
                className="font-semibold underline decoration-2 underline-offset-4 hover:text-grape"
              >
                {he.privacy.backLabel}
              </Link>
            </p>
          </Container>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
