import { Container } from "@/components/shared/Container";
import { Reveal } from "@/components/shared/Reveal";
import { he } from "@/content/he";

export function Faq() {
  return (
    <section id={he.faq.id} className="scroll-mt-20 py-[var(--space-section-tight)]">
      <Container>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-16">
          <Reveal>
            <h2 className="display text-[length:var(--step-3)]">{he.faq.title}</h2>
          </Reveal>

          <Reveal>
            <div className="grid gap-4">
              {he.faq.items.map((item) => (
                <details
                  key={item.q}
                  className="group rounded-[var(--radius-card)] border-[3px] border-ink bg-paper-raised shadow-sticker-sm"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-bold marker:content-none [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <span
                      aria-hidden
                      className="figure grid size-8 shrink-0 place-items-center rounded-[var(--radius-card)] border-2 border-ink bg-lime text-ink transition-transform duration-200 ease-out group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <p className="max-w-[64ch] px-5 pb-5 leading-[1.7] text-ink-muted">
                    {item.a}
                  </p>
                </details>
              ))}
            </div>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
