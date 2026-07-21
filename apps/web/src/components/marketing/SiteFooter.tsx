import { Container } from "@/components/shared/Container";
import { copy } from "@/content/he";

export function SiteFooter() {
  return (
    <footer className="border-t border-[color:color-mix(in_oklch,var(--color-olive)_16%,transparent)] py-6">
      <Container>
        <p className="text-sm text-[var(--color-muted)]">{copy.footer.note}</p>
      </Container>
    </footer>
  );
}
