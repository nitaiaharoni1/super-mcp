import Image from "next/image";

import { Container } from "@/components/shared/Container";
import { MotionReveal } from "@/components/shared/MotionReveal";
import { Section } from "@/components/shared/Section";
import { TrackedAnchor } from "@/components/shared/TrackedAnchor";
import { Button } from "@/components/ui/button";
import { he } from "@/content/he";
import { AnalyticsEvent } from "@/lib/analytics";
import { buildAccessMailto, getAccessEmail } from "@/lib/mcp";

export function SimpleProof() {
  const accessEmail = getAccessEmail();
  const accessHref = accessEmail ? buildAccessMailto(accessEmail) : "#access";

  return (
    <Section id={he.example.id} className="scroll-mt-20 py-16 md:py-24">
      <Container>
        <MotionReveal className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold text-[var(--color-accent)]">{he.example.eyebrow}</p>
          <h2 className="mt-3 font-[family-name:var(--font-secular)] text-[clamp(1.85rem,3.6vw,2.75rem)] leading-[1.12] tracking-[-0.02em]">
            {he.example.title}
          </h2>
          <p className="mt-4 text-[var(--color-ink-muted)] leading-7">{he.example.body}</p>
          <p className="mt-3 inline-flex rounded-[var(--radius-pill)] bg-[var(--color-olive-soft)] px-3 py-1 text-xs text-[var(--color-ink-muted)]">
            {he.example.sampleLabel}
          </p>
        </MotionReveal>

        <MotionReveal delay={0.06} className="mx-auto mt-8 max-w-md text-center">
          <p className="text-sm text-[var(--color-ink-muted)]">{he.example.highlightNote}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">
            {he.example.highlightStore}
            <span className="text-[var(--color-accent)]"> · {he.example.highlightTotal}</span>
          </p>
        </MotionReveal>

        <div className="mt-10 grid gap-6 lg:grid-cols-2 lg:gap-8">
          <MotionReveal delay={0.08}>
            <figure className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-line)] bg-white shadow-[0_20px_50px_-32px_oklch(0.45_0.08_230_/_0.35)]">
              <div className="relative aspect-[604/1400] w-full bg-[var(--color-olive-soft)]">
                <Image
                  src="/example-chat-map.webp"
                  alt="צילום מסך: השוואת חנויות ומפה ליד הרצליה"
                  fill
                  sizes="(max-width: 1024px) 100vw, 520px"
                  className="object-cover object-top"
                />
              </div>
              <figcaption className="px-4 py-3 text-sm leading-6 text-[var(--color-ink-muted)]">
                {he.example.mapCaption}
              </figcaption>
            </figure>
          </MotionReveal>

          <MotionReveal delay={0.12}>
            <figure className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-line)] bg-white shadow-[0_20px_50px_-32px_oklch(0.45_0.08_230_/_0.35)]">
              <div className="relative aspect-[841/1400] w-full bg-[var(--color-olive-soft)]">
                <Image
                  src="/example-chat-table.webp"
                  alt="צילום מסך: טבלת מחירים ופריטים חסרים בקארפור נווה עמל"
                  fill
                  sizes="(max-width: 1024px) 100vw, 520px"
                  className="object-cover object-top"
                />
              </div>
              <figcaption className="px-4 py-3 text-sm leading-6 text-[var(--color-ink-muted)]">
                {he.example.tableCaption}
              </figcaption>
            </figure>
          </MotionReveal>
        </div>

        <div className="mt-10 flex justify-center">
          <Button asChild size="lg">
            <TrackedAnchor
              href={accessHref}
              event={AnalyticsEvent.MarketingCtaClicked}
              mailtoEvent={AnalyticsEvent.AccessMailtoClicked}
              eventProperties={{ cta_id: "request_access", location: "example" }}
            >
              {he.example.cta}
            </TrackedAnchor>
          </Button>
        </div>
      </Container>
    </Section>
  );
}
