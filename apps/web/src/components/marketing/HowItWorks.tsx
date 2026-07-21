import { Container } from "@/components/shared/Container";
import { MotionReveal } from "@/components/shared/MotionReveal";
import { Section } from "@/components/shared/Section";
import { he } from "@/content/he";

export function HowItWorks() {
  return (
    <Section id={he.howItWorks.id} className="scroll-mt-20 bg-[var(--color-olive-soft)]/50 py-16 md:py-24">
      <Container>
        <MotionReveal className="max-w-2xl">
          <h2 className="font-[family-name:var(--font-secular)] text-[clamp(1.85rem,3.6vw,2.75rem)] leading-[1.12] tracking-[-0.02em]">
            {he.howItWorks.title}
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-7 text-[var(--color-ink-muted)] md:text-base">
            {he.howItWorks.intro}
          </p>
        </MotionReveal>

        <MotionReveal delay={0.06} className="mt-10">
          <div className="rounded-[var(--radius-xl)] border border-[var(--color-line)] bg-white p-8 shadow-[0_24px_60px_-44px_oklch(0.45_0.08_230_/_0.5)] md:p-12">
            <ol className="relative grid gap-10 md:grid-cols-3 md:gap-8">
              <div
                aria-hidden
                className="absolute top-7 right-[16.6%] left-[16.6%] hidden h-0.5 bg-[color-mix(in_oklch,var(--color-accent)_25%,transparent)] md:block"
              />
              {he.howItWorks.steps.map((step, index) => (
                <li key={step.title} className="relative flex flex-col items-center text-center">
                  <span className="relative z-10 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-accent)] font-[family-name:var(--font-geist-mono)] text-lg font-semibold text-white">
                    {index + 1}
                  </span>
                  <h3 className="mt-5 text-lg font-semibold tracking-tight">{step.title}</h3>
                  <p className="mt-2 max-w-[24ch] text-sm leading-6 text-[var(--color-ink-muted)]">
                    {step.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </MotionReveal>

        <div className="mt-6 grid gap-5 md:grid-cols-2 md:gap-6">
          {he.howItWorks.explain.map((block, index) => (
            <MotionReveal key={block.title} delay={0.1 + 0.05 * index}>
              <div className="flex h-full flex-col rounded-[var(--radius-xl)] border border-[var(--color-line)] bg-white p-7 md:p-8">
                <h3 className="text-xl font-semibold tracking-tight">{block.title}</h3>
                <p className="mt-3 text-sm leading-7 text-[var(--color-ink-muted)] md:text-base md:leading-8">
                  {block.body}
                </p>
                <ul className="mt-6 flex flex-wrap gap-2">
                  {block.chips.map((chip) => (
                    <li
                      key={chip}
                      className="rounded-[var(--radius-pill)] bg-[var(--color-olive-soft)] px-3 py-1 text-xs font-medium text-[var(--color-olive)]"
                    >
                      {chip}
                    </li>
                  ))}
                </ul>
              </div>
            </MotionReveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}
