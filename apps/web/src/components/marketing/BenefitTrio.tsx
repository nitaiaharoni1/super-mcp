import Image from "next/image";

import { Container } from "@/components/shared/Container";
import { MotionReveal } from "@/components/shared/MotionReveal";
import { Section } from "@/components/shared/Section";
import { he } from "@/content/he";

export function BenefitTrio() {
  return (
    <Section id={he.benefits.id} className="scroll-mt-20 py-16 md:py-24">
      <Container>
        <MotionReveal className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold text-[var(--color-accent)]">{he.benefits.eyebrow}</p>
          <h2 className="mt-3 font-[family-name:var(--font-secular)] text-[clamp(1.85rem,3.6vw,2.75rem)] leading-[1.12] tracking-[-0.02em]">
            {he.benefits.title}
          </h2>
        </MotionReveal>

        <div className="mt-12 grid gap-10 md:grid-cols-3 md:gap-6">
          {he.benefits.items.map((item, index) => (
            <MotionReveal key={item.title} delay={0.05 * index} className="text-center md:text-start">
              <div className="relative mx-auto aspect-[4/3] w-full max-w-sm overflow-hidden rounded-[var(--radius-xl)] bg-[var(--color-olive-soft)] md:mx-0">
                <Image
                  src={item.imageSrc}
                  alt={item.imageAlt}
                  fill
                  sizes="(max-width: 768px) 100vw, 320px"
                  className="object-cover"
                />
              </div>
              <h3 className="mt-5 text-xl font-semibold tracking-tight">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-[var(--color-ink-muted)] md:text-base md:leading-7">
                {item.body}
              </p>
            </MotionReveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}
