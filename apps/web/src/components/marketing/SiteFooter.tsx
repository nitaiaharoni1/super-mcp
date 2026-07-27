import { Container } from "@/components/shared/Container";
import { he } from "@/content/he";

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--color-line)] py-10">
      <Container className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
        <div className="max-w-[46ch]">
          <p className="text-sm text-[var(--color-ink)]">{he.footer.note}</p>
          <p className="mt-2 text-xs leading-5 text-[var(--color-ink-faint)]">
            {he.footer.disclosure}
          </p>
        </div>
        <ul className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {he.footer.links.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-[var(--color-ink-muted)] underline-offset-4 transition-colors hover:text-[var(--color-accent)] hover:underline"
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
