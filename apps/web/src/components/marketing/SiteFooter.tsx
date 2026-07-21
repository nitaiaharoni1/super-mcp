import { Container } from "@/components/shared/Container";
import { he } from "@/content/he";

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--color-line)] py-6">
      <Container>
        <p className="text-sm text-[var(--color-ink-muted)]">{he.footer.note}</p>
      </Container>
    </footer>
  );
}
