import { Container } from "@/components/shared/Container";
import { Logo } from "@/components/shared/Logo";
import { TrackedAnchor } from "@/components/shared/TrackedAnchor";
import { Button } from "@/components/ui/button";
import { he } from "@/content/he";
import { AnalyticsEvent } from "@/lib/analytics";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 h-16 border-b-[3px] border-[var(--color-ink)] bg-[var(--color-paper)]">
      {/* Sticky nav sits ahead of the content, so give keyboards a way past it. */}
      <a
        href="#top"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:end-4 focus:z-40 focus:rounded-[var(--radius-card)] focus:border-[3px] focus:border-[var(--color-ink)] focus:bg-[var(--color-lime)] focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-[var(--color-ink)]"
      >
        דלגו לתוכן
      </a>
      <Container className="flex h-full items-center gap-6">
        <a
          href="#top"
          aria-label={he.header.brand}
          className="flex self-stretch items-center"
        >
          <Logo />
        </a>

        <nav
          className="hidden items-center gap-6 text-sm font-semibold text-[var(--color-ink)] md:flex"
          aria-label="ניווט ראשי"
        >
          {he.header.nav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="underline-offset-[6px] decoration-2 transition-colors hover:text-[var(--color-grape-band)] hover:underline"
            >
              {item.label}
            </a>
          ))}
        </nav>

        {/* Solid lime, not outline: this is the page's single intent, so it
            should not look like a tertiary control sitting in the corner. */}
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
