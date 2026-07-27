import { Container } from "@/components/shared/Container";
import { TrackedAnchor } from "@/components/shared/TrackedAnchor";
import { Button } from "@/components/ui/button";
import { he } from "@/content/he";
import { AnalyticsEvent } from "@/lib/analytics";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 h-16 border-b border-[var(--color-line)] bg-[color-mix(in_oklch,var(--color-paper)_88%,transparent)] backdrop-blur-md">
      {/* Sticky nav sits ahead of the content, so give keyboards a way past it. */}
      <a
        href="#ledger"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:end-4 focus:z-40 focus:rounded-[var(--radius-pill)] focus:bg-[var(--color-ink)] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-[var(--color-paper)]"
      >
        דלגו לתוכן
      </a>
      <Container className="flex h-full items-center gap-6">
        <a
          className="display text-lg text-[var(--color-ink)]"
          href="#top"
          aria-label={he.header.brand}
        >
          <span dir="ltr">{he.header.brand}</span>
        </a>

        <nav
          className="hidden items-center gap-6 text-sm text-[var(--color-ink-muted)] md:flex"
          aria-label="ניווט ראשי"
        >
          {he.header.nav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="transition-colors hover:text-[var(--color-ink)]"
            >
              {item.label}
            </a>
          ))}
        </nav>

        {/* Solid, not outline: this is the page's single intent, so it should not
            look like a tertiary control sitting in the corner. */}
        <Button asChild size="sm" className="ms-auto">
          <TrackedAnchor
            href="#access"
            event={AnalyticsEvent.MarketingCtaClicked}
            eventProperties={{ cta_id: "request_access", location: "header" }}
          >
            {he.header.cta}
          </TrackedAnchor>
        </Button>
      </Container>
    </header>
  );
}
