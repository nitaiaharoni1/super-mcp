import { AssistantRow } from "@/components/shared/AssistantRow";
import { Container } from "@/components/shared/Container";
import { HandArrow, PixelPlus, Sparkle } from "@/components/shared/doodles";
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
      {/* Graph paper under the sticker, top of the page only. */}
      <div aria-hidden className="dot-grid pointer-events-none absolute inset-x-0 top-0 -z-10 h-[62%]" />
      <Sparkle
        aria-hidden
        className="pointer-events-none absolute top-16 end-[5%] -z-10 hidden size-12 rotate-12 text-tangerine md:block"
      />
      <Sparkle
        aria-hidden
        className="pointer-events-none absolute bottom-20 start-[3%] -z-10 hidden size-8 text-grape md:block"
      />
      <PixelPlus
        aria-hidden
        className="pointer-events-none absolute top-40 start-[44%] -z-10 hidden size-4 text-ink/30 lg:block"
      />

      <Container className="grid items-center gap-10 pt-[clamp(2.5rem,1.75rem+3.5vw,5rem)] pb-[var(--space-section-tight)] lg:grid-cols-[1.02fr_0.98fr] lg:gap-16">
        <Reveal on="load" beat={1} className="max-w-[38rem]">
          <p className="inline-block rotate-[-1.5deg] rounded-[var(--radius-pill)] border-2 border-ink bg-lime px-4 py-1.5 text-sm font-bold text-ink shadow-sticker-sm">
            {hero.eyebrow}
          </p>

          <h1 className="display mt-6 text-[length:var(--step-6)]">
            {hero.titleLines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
            <span className="mt-3 inline-block rotate-[-1.2deg] rounded-[var(--radius-card)] border-[3px] border-ink bg-lime px-4 py-1 text-ink shadow-sticker">
              {hero.titleAccent}
            </span>
          </h1>

          <p className="mt-6 max-w-[44ch] text-[length:var(--step-1)] leading-[1.6] text-ink-muted">
            {hero.subtitle}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-4">
            <Button asChild size="xl">
              <TrackedAnchor
                href="#access"
                event={AnalyticsEvent.MarketingCtaClicked}
                eventProperties={{ cta_id: "request_access", location: "hero" }}
              >
                {hero.primaryCta}
              </TrackedAnchor>
            </Button>
            <Button asChild variant="secondary" size="xl">
              <a href={hero.secondaryHref}>{hero.secondaryCta}</a>
            </Button>
          </div>

          <p className="mt-4 text-xs text-ink-muted">{hero.ctaReassurance}</p>

          <div className="mt-9">
            <AssistantRow label={hero.assistantsLabel} />
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
    <figure className="relative rotate-[1.2deg] rounded-[var(--radius-card)] border-[3px] border-ink bg-paper-raised p-4 shadow-sticker-lg md:p-5">
      <HandArrow className="absolute -top-14 right-2 hidden w-24 text-ink lg:block" />

      {/* What the person typed. */}
      <div className="flex justify-start">
        <p className="max-w-[92%] rounded-[var(--radius-card)] border-2 border-ink bg-grape-soft px-4 py-3 text-[0.9375rem] leading-[1.55] text-ink">
          {chat.userMessage}
        </p>
      </div>

      {/* What the assistant went and did. Plain sentence first: a shopper reads
          that and understands. The tool name underneath is for credibility, and
          is the only place above the developer disclosure where it appears. */}
      <div className="mt-3.5 rounded-[var(--radius-card)] border-2 border-ink/15 bg-paper-sunk px-3.5 py-2.5">
        <p className="flex items-center gap-2.5 text-[0.8125rem] text-ink">
          <span aria-hidden className="size-2 shrink-0 bg-grape" />
          {chat.toolLabel}
        </p>
        <p dir="ltr" className="figure mt-1 ps-[1rem] text-[0.6875rem] text-ink-faint">
          {chat.toolName}
        </p>
      </div>

      {/* What came back. */}
      <div className="mt-3.5 px-1">
        <p className="text-sm text-ink-muted">{chat.replyLead}</p>

        <div className="mt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <p className="display text-[length:var(--step-3)]">{chat.planStore}</p>
            <p className="mt-1 text-xs text-ink-muted">
              {/* No `.ltr` here: mixed digit+Hebrew unit runs (e.g. "2.14 ק״מ")
                  reverse awkwardly if forced LTR. */}
              <span className="figure">{chat.planDistance}</span>
              <span className="px-1.5 text-ink-faint">·</span>
              {chat.planDistancePrecision}
            </p>
          </div>
          <p className="figure ltr inline-block rotate-[1deg] rounded-[var(--radius-card)] border-[3px] border-ink bg-lime px-3 py-1.5 text-[length:var(--step-4)] leading-none text-ink shadow-sticker-sm">
            {chat.planTotal}
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t-2 border-ink/10 pt-3 text-xs">
          <span className="text-ink-muted">{chat.planCoverage}</span>
          <span className="inline-flex items-baseline gap-1.5 rounded-[var(--radius-pill)] border-2 border-over bg-over-soft px-2.5 py-1 font-medium text-over">
            {chat.planMissingLabel}
            <span className="font-bold">{chat.planMissing}</span>
          </span>
          <figcaption className="ms-auto text-ink-faint">{chat.footnote}</figcaption>
        </div>
      </div>
    </figure>
  );
}
