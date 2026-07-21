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
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center lg:gap-14">
          <MotionReveal>
            <p className="text-sm font-semibold text-[var(--color-accent)]">{he.example.eyebrow}</p>
            <h2 className="mt-3 max-w-[16ch] font-[family-name:var(--font-secular)] text-[clamp(1.85rem,3.6vw,2.75rem)] leading-[1.12] tracking-[-0.02em]">
              {he.example.title}
            </h2>
            <p className="mt-4 max-w-[42ch] text-base leading-7 text-[var(--color-ink-muted)]">
              {he.example.body}
            </p>

            <div className="mt-8 rounded-[var(--radius-xl)] border border-[var(--color-line)] bg-[var(--color-olive-soft)] p-6">
              <p className="text-sm text-[var(--color-ink-muted)]">{he.example.highlightNote}</p>
              <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-4xl font-semibold tracking-tight text-[var(--color-accent)] md:text-5xl">
                  {he.example.highlightTotal}
                </span>
                <span className="text-lg font-medium text-[var(--color-ink)]">
                  {he.example.highlightStore}
                </span>
              </p>
            </div>

            <div className="mt-8">
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
          </MotionReveal>

          <MotionReveal delay={0.08} className="grid grid-cols-2 gap-4 sm:gap-5">
            <figure className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-line)] bg-white shadow-[0_20px_50px_-32px_oklch(0.45_0.08_230_/_0.35)]">
              <div className="relative aspect-[604/1400] w-full bg-[var(--color-olive-soft)]">
                <Image
                  src="/example-chat-map.webp"
                  alt="צילום מסך: השוואת חנויות ומפה ליד הרצליה"
                  fill
                  sizes="(max-width: 640px) 45vw, 260px"
                  className="object-cover object-top"
                />
              </div>
              <figcaption className="px-3 py-2.5 text-xs leading-5 text-[var(--color-ink-muted)]">
                {he.example.mapCaption}
              </figcaption>
            </figure>

            <figure className="mt-8 overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-line)] bg-white shadow-[0_20px_50px_-32px_oklch(0.45_0.08_230_/_0.35)]">
              <div className="relative aspect-[841/1400] w-full bg-[var(--color-olive-soft)]">
                <Image
                  src="/example-chat-table.webp"
                  alt="צילום מסך: טבלת מחירים ופריטים חסרים בקארפור נווה עמל"
                  fill
                  sizes="(max-width: 640px) 45vw, 260px"
                  className="object-cover object-top"
                />
              </div>
              <figcaption className="px-3 py-2.5 text-xs leading-5 text-[var(--color-ink-muted)]">
                {he.example.tableCaption}
              </figcaption>
            </figure>
          </MotionReveal>
        </div>
      </Container>
    </Section>
  );
}
