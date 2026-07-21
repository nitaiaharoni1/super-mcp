import Image from "next/image";

import { Container } from "@/components/shared/Container";
import { MotionReveal } from "@/components/shared/MotionReveal";
import { Section } from "@/components/shared/Section";
import { he } from "@/content/he";

export function SafetyStatement() {
  return (
    <Section id={he.safety.id} className="scroll-mt-20 py-16 md:py-20">
      <Container>
        <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
          <MotionReveal>
            <p className="text-sm font-semibold text-[var(--color-accent)]">{he.safety.eyebrow}</p>
            <h2 className="mt-3 max-w-[16ch] font-[family-name:var(--font-secular)] text-[clamp(1.85rem,3.6vw,2.85rem)] leading-[1.12] tracking-[-0.02em]">
              {he.safety.statement}
            </h2>
            <p className="mt-4 max-w-[36ch] text-base leading-7 text-[var(--color-ink-muted)]">
              {he.safety.body}
            </p>
          </MotionReveal>
          <MotionReveal delay={0.08}>
            <div className="relative aspect-[4/3] overflow-hidden rounded-[var(--radius-xl)] bg-[var(--color-olive-soft)]">
              <Image
                src={he.safety.imageSrc}
                alt={he.safety.imageAlt}
                fill
                sizes="(max-width: 1024px) 100vw, 520px"
                className="object-cover"
              />
            </div>
          </MotionReveal>
        </div>
      </Container>
    </Section>
  );
}
