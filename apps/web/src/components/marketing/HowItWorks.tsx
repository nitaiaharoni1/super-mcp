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

        <ol className="mt-12 max-w-3xl space-y-10">
          {he.howItWorks.steps.map((step, index) => (
            <li key={step.title}>
              <MotionReveal delay={0.05 * index} className="grid grid-cols-[auto_1fr] gap-x-6 md:gap-x-8">
                <span
                  aria-hidden
                  className="w-14 select-none text-center font-[family-name:var(--font-secular)] text-5xl leading-none text-[var(--color-accent)] md:text-6xl"
                >
                  {index + 1}
                </span>
                <div className="pt-1">
                  <h3 className="text-xl font-semibold tracking-tight md:text-2xl">{step.title}</h3>
                  <p className="mt-2 max-w-[44ch] text-sm leading-6 text-[var(--color-ink-muted)] md:text-base md:leading-7">
                    {step.body}
                  </p>
                  {"exampleQuestion" in step && (
                    <figure className="mt-4 max-w-md rounded-[var(--radius-lg)] rounded-tr-[4px] border border-[var(--color-line)] bg-white px-5 py-4">
                      <figcaption className="text-xs font-medium text-[var(--color-accent)]">
                        {step.exampleLabel}
                      </figcaption>
                      <blockquote className="mt-1 text-sm leading-6 text-[var(--color-ink)]">
                        {step.exampleQuestion}
                      </blockquote>
                    </figure>
                  )}
                </div>
              </MotionReveal>
            </li>
          ))}
        </ol>

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
