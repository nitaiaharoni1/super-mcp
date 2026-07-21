import { Container } from "@/components/shared/Container";
import { MotionReveal } from "@/components/shared/MotionReveal";
import { Section } from "@/components/shared/Section";
import { he } from "@/content/he";

export function HowItWorks() {
  return (
    <Section id={he.howItWorks.id} className="scroll-mt-20 bg-[var(--color-olive-soft)]/50 py-16 md:py-24">
      <Container>
        <MotionReveal className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold text-[var(--color-accent)]">{he.howItWorks.eyebrow}</p>
          <h2 className="mt-3 font-[family-name:var(--font-secular)] text-[clamp(1.85rem,3.6vw,2.75rem)] leading-[1.12] tracking-[-0.02em]">
            {he.howItWorks.title}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-[var(--color-ink-muted)] md:text-base">
            {he.howItWorks.intro}
          </p>
        </MotionReveal>

        <ol className="mx-auto mt-12 grid max-w-4xl gap-8 md:grid-cols-3 md:gap-6">
          {he.howItWorks.steps.map((step, index) => (
            <li key={step.title} className="flex flex-col items-center text-center">
              <MotionReveal delay={0.05 * index} className="flex flex-col items-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-accent)] font-[family-name:var(--font-secular)] text-xl text-white">
                  {index + 1}
                </span>
                <h3 className="mt-4 text-xl font-semibold">{step.title}</h3>
                <p className="mt-2 max-w-[22ch] text-sm leading-6 text-[var(--color-ink-muted)]">
                  {step.body}
                </p>
              </MotionReveal>
            </li>
          ))}
        </ol>

        <div className="mx-auto mt-14 grid max-w-4xl gap-10 md:grid-cols-2 md:gap-12">
          {he.howItWorks.explain.map((block, index) => (
            <MotionReveal key={block.title} delay={0.08 + 0.05 * index} className="text-center md:text-start">
              <h3 className="text-xl font-semibold tracking-tight">{block.title}</h3>
              <p className="mt-3 text-sm leading-7 text-[var(--color-ink-muted)] md:text-base md:leading-8">
                {block.body}
              </p>
            </MotionReveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}
