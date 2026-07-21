import { Container } from "@/components/shared/Container";
import { Button } from "@/components/ui/button";
import { copy } from "@/content/he";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 h-[68px] border-b border-[color:color-mix(in_oklch,var(--color-olive)_14%,transparent)] bg-[color:color-mix(in_oklch,var(--color-paper)_92%,transparent)] backdrop-blur-sm">
      <Container className="flex h-full items-center justify-between">
        <a
          className="text-lg font-semibold tracking-[-0.04em] text-[var(--color-ink)]"
          href="#top"
          aria-label={copy.brand}
        >
          <span dir="ltr">{copy.brand}</span>
        </a>
        <Button asChild size="sm">
          <a href={copy.navConnectHref}>{copy.cta}</a>
        </Button>
      </Container>
    </header>
  );
}
