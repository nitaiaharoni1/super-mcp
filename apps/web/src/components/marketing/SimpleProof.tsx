import { Container } from "@/components/shared/Container";
import { MotionReveal } from "@/components/shared/MotionReveal";
import { Price } from "@/components/shared/Price";
import { Section } from "@/components/shared/Section";
import { TrackedAnchor } from "@/components/shared/TrackedAnchor";
import { Button } from "@/components/ui/button";
import { demoBasket } from "@/content/demoBasket";
import { he } from "@/content/he";
import { AnalyticsEvent } from "@/lib/analytics";
import { buildAccessMailto, getAccessEmail } from "@/lib/mcp";

export function SimpleProof() {
  const plan = demoBasket.complete.bestSingleStore;
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

        <MotionReveal delay={0.08} className="mx-auto mt-10 max-w-xl">
          <div className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-line)] bg-white text-start shadow-[0_20px_50px_-32px_oklch(0.45_0.08_230_/_0.35)]">
            <div className="border-b border-[var(--color-line)] px-5 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)]">
                {he.example.requestLabel}
              </p>
              <p className="mt-1 text-base leading-7">{demoBasket.prompt}</p>
            </div>

            <div className="border-b border-[var(--color-line)] bg-amber-50/80 px-5 py-4">
              <p className="text-[11px] font-semibold text-amber-900/80">{he.example.clarifyLabel}</p>
              <p className="mt-1 text-sm font-medium">{demoBasket.question.query}</p>
              <ul className="mt-2 grid gap-1.5">
                {demoBasket.question.options.slice(0, 2).map((opt) => (
                  <li
                    key={opt.name}
                    className="flex items-center justify-between gap-3 text-sm text-[var(--color-ink-muted)]"
                  >
                    <span>{opt.name}</span>
                    <Price value={opt.minPrice} />
                  </li>
                ))}
              </ul>
            </div>

            <div className="px-5 py-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-accent)]">
                {he.example.resultLabel}
              </p>
              <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-sm text-[var(--color-ink-muted)]">{he.example.storeLabel}</p>
                  <p className="text-lg font-semibold">
                    {plan.storeName}
                    <span className="font-normal text-[var(--color-ink-muted)]"> · {plan.chainName}</span>
                  </p>
                </div>
                <div className="text-end">
                  <p className="text-sm text-[var(--color-ink-muted)]">{he.example.totalLabel}</p>
                  <p className="text-2xl font-semibold">
                    <Price value={plan.total} />
                  </p>
                </div>
              </div>
              <p className="mt-4 text-sm text-[var(--color-ink-muted)]">
                {he.example.coverageLabel} {plan.pricedLines}/{plan.requestedLines}
                {plan.missingItems.length > 0
                  ? ` · ${he.example.missingLabel}: ${plan.missingItems.join(", ")}`
                  : null}
              </p>
              <ul className="mt-4 grid gap-2 border-t border-[var(--color-line)] pt-4">
                {plan.lines.map((line) => (
                  <li key={line.name} className="flex items-baseline justify-between gap-3 text-sm">
                    <span>
                      {line.name}
                      <span className="text-[var(--color-ink-muted)]"> · {line.qty}</span>
                    </span>
                    <Price value={line.lineTotal} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </MotionReveal>

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
