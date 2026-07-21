import Image from "next/image";

import { Container } from "@/components/shared/Container";
import { MotionReveal } from "@/components/shared/MotionReveal";
import { TrackedAnchor } from "@/components/shared/TrackedAnchor";
import { Button } from "@/components/ui/button";
import { he } from "@/content/he";
import { AnalyticsEvent } from "@/lib/analytics";
import { buildAccessMailto, getAccessEmail } from "@/lib/mcp";

export function Hero() {
  const accessEmail = getAccessEmail();
  const accessHref = accessEmail ? buildAccessMailto(accessEmail) : "#access";

  return (
    <section id="top" className="relative isolate overflow-hidden">
      <Container className="pt-14 pb-16 text-center md:pt-20 md:pb-24">
        <MotionReveal>
          <p className="text-sm font-semibold text-[var(--color-accent)]">{he.hero.eyebrow}</p>
          <h1 className="mx-auto mt-4 max-w-[22ch] font-[family-name:var(--font-secular)] text-[clamp(2.5rem,6vw,4rem)] leading-[1.08] tracking-[-0.02em] text-[var(--color-ink)]">
            {he.hero.title}
          </h1>
          <p className="mx-auto mt-5 max-w-[36ch] text-base leading-7 text-[var(--color-ink-muted)] md:text-lg md:leading-8">
            {he.hero.subtitle}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="xl">
              <TrackedAnchor
                href={accessHref}
                event={AnalyticsEvent.MarketingCtaClicked}
                mailtoEvent={AnalyticsEvent.AccessMailtoClicked}
                eventProperties={{ cta_id: "request_access", location: "hero" }}
              >
                {he.hero.primaryCta}
              </TrackedAnchor>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href={he.hero.secondaryHref}>{he.hero.secondaryCta}</a>
            </Button>
          </div>
        </MotionReveal>

        <MotionReveal
          delay={0.08}
          className="relative mx-auto mt-12 aspect-[16/9] w-full max-w-3xl overflow-hidden rounded-[var(--radius-xl)] bg-[var(--color-brand-band)] shadow-[0_40px_80px_-40px_oklch(0.58_0.14_230_/_0.5)]"
        >
          <Image
            src="/hero-basket.webp"
            alt="סל מצרכים טריים על רקע תכלת"
            fill
            priority
            sizes="(max-width: 768px) 100vw, 768px"
            className="object-cover object-center"
          />
        </MotionReveal>
      </Container>
    </section>
  );
}
