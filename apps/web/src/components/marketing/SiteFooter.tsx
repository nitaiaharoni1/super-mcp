import { Container } from "@/components/shared/Container";
import { he } from "@/content/he";

/*
 * The ink band that grounds the page. Cream text, lime on hover and on focus
 * (the global ink focus ring would vanish against the band, so links override
 * it locally).
 */
export function SiteFooter() {
  return (
    <footer className="border-t-[3px] border-ink bg-ink py-10 text-paper-raised">
      <Container className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
        <div className="max-w-[46ch]">
          <p className="text-sm font-semibold">{he.footer.note}</p>
          <p className="mt-2 text-xs leading-5 text-cream-dim">{he.footer.disclosure}</p>
        </div>
        <ul className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {he.footer.links.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-paper-raised underline-offset-4 decoration-2 transition-colors hover:text-lime hover:underline focus-visible:outline-lime"
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
