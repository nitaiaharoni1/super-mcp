import { Container } from "@/components/shared/Container";
import { he } from "@/content/he";

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--color-line)] py-8">
      <Container className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm text-[var(--color-ink-muted)]">{he.footer.note}</p>
          <p className="mt-1 text-xs text-[var(--color-ink-muted)]/80">{he.trust.body}</p>
        </div>
        <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {he.trust.links.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-[var(--color-ink-muted)] underline-offset-4 hover:text-[var(--color-ink)] hover:underline"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </Container>
    </footer>
  );
}
