import { Container } from "@/components/shared/Container";
import { TrackedAnchor } from "@/components/shared/TrackedAnchor";
import { Button } from "@/components/ui/button";
import { he } from "@/content/he";
import { AnalyticsEvent } from "@/lib/analytics";
import { buildAccessMailto, getAccessEmail } from "@/lib/mcp";

export function SiteHeader() {
  const accessEmail = getAccessEmail();
  const accessHref = accessEmail ? buildAccessMailto(accessEmail) : "#access";

  return (
    <header className="sticky top-0 z-30 h-16 border-b border-[var(--color-line)] bg-[color:color-mix(in_oklch,var(--color-paper)_94%,transparent)] backdrop-blur-md">
      <Container className="flex h-full items-center justify-between gap-4">
        <a
          className="font-[family-name:var(--font-secular)] text-lg tracking-[-0.02em] text-[var(--color-ink)]"
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
            <a key={item.href} href={item.href} className="hover:text-[var(--color-ink)]">
              {item.label}
            </a>
          ))}
        </nav>
        <Button asChild size="sm">
          <TrackedAnchor
            href={accessHref}
            event={AnalyticsEvent.MarketingCtaClicked}
            mailtoEvent={AnalyticsEvent.AccessMailtoClicked}
            eventProperties={{ cta_id: "request_access", location: "header" }}
          >
            {he.header.cta}
          </TrackedAnchor>
        </Button>
      </Container>
    </header>
  );
}
