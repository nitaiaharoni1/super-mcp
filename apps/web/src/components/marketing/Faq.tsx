import { Container } from "@/components/shared/Container";
import { MotionReveal } from "@/components/shared/MotionReveal";
import { Section } from "@/components/shared/Section";
import { he } from "@/content/he";

export function Faq() {
  return (
    <Section id={he.faq.id} className="scroll-mt-20 bg-[var(--color-olive-soft)]/50 py-16 md:py-20">
      <Container>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-14">
          <MotionReveal>
            <h2 className="font-[family-name:var(--font-secular)] text-[clamp(1.85rem,3.6vw,2.75rem)] leading-[1.12] tracking-[-0.02em]">
              {he.faq.title}
            </h2>
          </MotionReveal>
          <MotionReveal delay={0.05}>
            <div className="divide-y divide-[var(--color-line)]">
              {he.faq.items.map((item) => (
                <details key={item.q} className="group py-4 first:pt-0 last:pb-0">
                  <summary className="flex cursor-pointer list-none items-baseline justify-between gap-4 text-base font-semibold marker:content-none [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <span
                      aria-hidden
                      className="text-[var(--color-accent)] transition-transform group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <p className="mt-2 max-w-[60ch] text-sm leading-7 text-[var(--color-ink-muted)]">
                    {item.a}
                  </p>
                </details>
              ))}
            </div>
          </MotionReveal>
        </div>
      </Container>
    </Section>
  );
}
