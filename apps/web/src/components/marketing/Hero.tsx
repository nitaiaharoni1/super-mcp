import { Container } from "@/components/shared/Container";
import { Reveal } from "@/components/shared/Reveal";
import { TrackedAnchor } from "@/components/shared/TrackedAnchor";
import { Button } from "@/components/ui/button";
import { he } from "@/content/he";
import { AnalyticsEvent } from "@/lib/analytics";

/**
 * The hero shows the product instead of describing it, as one real exchange:
 * what a person typed, the tool the assistant reached for, and what came back.
 * Every figure is from the measured basket in `he.ts`, and the missing line is
 * shown rather than hidden, because "it tells you what it does not know" is the
 * whole positioning.
 */
export function Hero() {
  const { hero } = he;

  return (
    <section id="top" className="relative isolate overflow-hidden">
      {/* One soft wash so the page does not open on flat white. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[70%] bg-[linear-gradient(to_bottom,var(--color-accent-soft),transparent)]"
      />

      <Container className="grid items-center gap-10 pt-[clamp(2.5rem,1.75rem+3.5vw,5rem)] pb-[var(--space-section-tight)] lg:grid-cols-[1.02fr_0.98fr] lg:gap-16">
        <Reveal on="load" beat={1} className="max-w-[38rem]">
          <p className="text-sm font-semibold tracking-wide text-[var(--color-accent)]">
            {hero.eyebrow}
          </p>

          <h1 className="display mt-5 text-[length:var(--step-5)]">
            {hero.titleLines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
            <span className="block text-[var(--color-accent)]">{hero.titleAccent}</span>
          </h1>

          <p className="mt-6 max-w-[44ch] text-[length:var(--step-1)] leading-[1.6] text-[var(--color-ink-muted)]">
            {hero.subtitle}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-x-7 gap-y-4">
            <Button asChild size="xl">
              <TrackedAnchor
                href="#access"
                event={AnalyticsEvent.MarketingCtaClicked}
                eventProperties={{ cta_id: "request_access", location: "hero" }}
              >
                {hero.primaryCta}
              </TrackedAnchor>
            </Button>
            <Button asChild variant="quiet">
              <a href={hero.secondaryHref}>{hero.secondaryCta}</a>
            </Button>
          </div>

          <p className="mt-3.5 text-xs text-[var(--color-ink-muted)]">{hero.ctaReassurance}</p>

          <div className="mt-9 border-t border-[var(--color-line)] pt-5">
            <p className="text-xs text-[var(--color-ink-muted)]">{hero.assistantsLabel}</p>
            <ul className="mt-2.5 flex flex-wrap items-baseline gap-x-5 gap-y-2">
              {hero.assistants.map((name) => (
                <li
                  key={name}
                  dir="ltr"
                  className="text-sm font-semibold tracking-[-0.01em] text-[var(--color-ink)]"
                >
                  {name}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>

        <Reveal on="load" beat={2}>
          <ChatExchange />
        </Reveal>
      </Container>
    </section>
  );
}

/**
 * A chat exchange, not a dashboard. No fake client chrome and no borrowed
 * branding: a message the reader could have typed, what the assistant went and
 * checked, and the answer. Showing a real tool run is what makes the page
 * credible without asking a shopper to learn what a protocol is.
 */
function ChatExchange() {
  const { chat } = he.hero;

  return (
    <figure className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-line)] bg-[var(--color-paper-raised)] p-4 shadow-[0_30px_70px_-45px_oklch(0.31_0.098_236/0.45)] md:p-5">
      {/* What the person typed. */}
      <div className="flex justify-start">
        <p className="max-w-[92%] rounded-[var(--radius-lg)] rounded-tr-[6px] bg-[var(--color-accent-soft)] px-4 py-3 text-[0.9375rem] leading-[1.55] text-[var(--color-ink)]">
          {chat.userMessage}
        </p>
      </div>

      {/* What the assistant went and did. Plain sentence first: a shopper reads
          that and understands. The tool name underneath is for credibility, and
          is the only place above the developer disclosure where it appears. */}
      <div className="mt-3.5 rounded-[var(--radius-lg)] bg-[var(--color-paper-sunk)] px-3.5 py-2.5">
        <p className="flex items-center gap-2.5 text-[0.8125rem] text-[var(--color-ink)]">
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--color-accent)]" />
          {chat.toolLabel}
        </p>
        <p dir="ltr" className="figure mt-1 ps-[1rem] text-[0.6875rem] text-[var(--color-ink-faint)]">
          {chat.toolName}
        </p>
      </div>

      {/* What came back. */}
      <div className="mt-3.5 px-1">
        <p className="text-sm text-[var(--color-ink-muted)]">{chat.replyLead}</p>

        <div className="mt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <p className="display text-[length:var(--step-3)]">{chat.planStore}</p>
            <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
              {/* No `.ltr` here: "2.14 ק״מ" mixes digits with a Hebrew unit, and
                  forcing the run LTR puts the unit first, reading "ק״מ 2.14". */}
              <span className="figure">{chat.planDistance}</span>
              <span className="px-1.5 text-[var(--color-ink-faint)]">·</span>
              {chat.planDistancePrecision}
            </p>
          </div>
          <p className="figure ltr text-[length:var(--step-4)] leading-none text-[var(--color-ink)]">
            {chat.planTotal}
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[var(--color-line)] pt-3 text-xs">
          <span className="text-[var(--color-ink-muted)]">{chat.planCoverage}</span>
          <span className="inline-flex items-baseline gap-1.5 rounded-[var(--radius-pill)] bg-[color-mix(in_oklch,var(--color-over)_12%,transparent)] px-2.5 py-1 font-medium text-[var(--color-over)]">
            {chat.planMissingLabel}
            <span className="font-semibold">{chat.planMissing}</span>
          </span>
          <figcaption className="ms-auto text-[var(--color-ink-faint)]">{chat.footnote}</figcaption>
        </div>
      </div>
    </figure>
  );
}
