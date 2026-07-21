import Image from "next/image";

import { Container } from "@/components/shared/Container";
import { MotionReveal } from "@/components/shared/MotionReveal";
import { Section } from "@/components/shared/Section";
import { he } from "@/content/he";

export function BenefitTrio() {
  const { featured, items } = he.benefits;
  const [prices, missing] = items;

  return (
    <Section id={he.benefits.id} className="scroll-mt-20 py-16 md:py-24">
      <Container>
        <MotionReveal>
          <h2 className="max-w-[18ch] font-[family-name:var(--font-secular)] text-[clamp(1.85rem,3.6vw,2.75rem)] leading-[1.12] tracking-[-0.02em]">
            {he.benefits.title}
          </h2>
        </MotionReveal>

        <div className="mt-10 grid gap-5 md:grid-cols-2 md:gap-6">
          <MotionReveal className="md:col-span-2">
            <div className="grid overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-line)] bg-white md:grid-cols-2">
              <div className="relative aspect-[4/3] md:aspect-auto md:min-h-[320px]">
                <Image
                  src={featured.imageSrc}
                  alt={featured.imageAlt}
                  fill
                  sizes="(max-width: 768px) 100vw, 540px"
                  className="object-cover"
                />
              </div>
              <div className="flex flex-col justify-center p-7 md:p-12">
                <h3 className="text-2xl font-semibold tracking-tight md:text-3xl">
                  {featured.title}
                </h3>
                <p className="mt-3 max-w-[40ch] text-base leading-7 text-[var(--color-ink-muted)] md:text-lg md:leading-8">
                  {featured.body}
                </p>
              </div>
            </div>
          </MotionReveal>

          <MotionReveal delay={0.05}>
            <div className="flex h-full flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-line)] bg-white">
              <div className="relative aspect-[16/9]">
                <Image
                  src={prices.imageSrc}
                  alt={prices.imageAlt}
                  fill
                  sizes="(max-width: 768px) 100vw, 540px"
                  className="object-cover"
                />
              </div>
              <div className="p-6 md:p-7">
                <h3 className="text-xl font-semibold tracking-tight">{prices.title}</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--color-ink-muted)] md:text-base md:leading-7">
                  {prices.body}
                </p>
              </div>
            </div>
          </MotionReveal>

          <MotionReveal delay={0.1}>
            <div className="flex h-full flex-col justify-center rounded-[var(--radius-xl)] bg-[var(--color-olive-soft)] p-7 md:p-10">
              <h3 className="text-xl font-semibold tracking-tight md:text-2xl">{missing.title}</h3>
              <p className="mt-3 max-w-[38ch] text-sm leading-6 text-[var(--color-ink-muted)] md:text-base md:leading-7">
                {missing.body}
              </p>
            </div>
          </MotionReveal>
        </div>
      </Container>
    </Section>
  );
}
