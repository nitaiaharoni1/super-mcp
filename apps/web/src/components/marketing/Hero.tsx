import Image from "next/image";

import { AssistantRow } from "@/components/shared/AssistantRow";
import { Container } from "@/components/shared/Container";
import { HandArrow, PixelPlus, Sparkle } from "@/components/shared/doodles";
import { Reveal } from "@/components/shared/Reveal";
import { TrackedAnchor } from "@/components/shared/TrackedAnchor";
import { Button } from "@/components/ui/button";
import { he } from "@/content/he";
import { AnalyticsEvent } from "@/lib/analytics";

/**
 * The hero shows the product instead of describing it: a lively grocery photo
 * as the visual plane, and on top of it one real exchange (what a person typed,
 * the tool the assistant reached for, and what came back). Every figure is from
 * the measured basket in `he.ts`, and the missing line is shown rather than
 * hidden, because "it tells you what it does not know" is the whole positioning.
 */
export function Hero() {
  const { coverage, hero } = he;

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

      <Container className="grid max-w-[1280px] items-center gap-14 pt-[clamp(2.5rem,1.75rem+3.5vw,5rem)] pb-[var(--space-section-tight)] lg:grid-cols-[1.3fr_0.7fr] lg:gap-16 xl:grid-cols-[1.15fr_0.85fr] xl:gap-16">
        {/*
          z-20: the chat card in the visual column carries its own z-10 and sits
          later in the DOM, so without this the headline sticker gets buried
          under it when the columns overlap.
        */}
        <Reveal on="load" beat={1} className="relative z-20 max-w-[46rem]">
          <p className="inline-block rotate-[-1.5deg] rounded-[var(--radius-card)] border-[3px] border-ink bg-lime px-4 py-1.5 text-sm font-bold text-ink shadow-sticker-sm">
            {hero.eyebrow}
          </p>

          <h1 className="display mt-6 flex flex-col items-start gap-3 text-[length:clamp(2.25rem,1.5rem+3.1vw,4rem)] sm:flex-row sm:items-center sm:gap-4">
            {hero.titleLines.map((line) => (
              <span key={line} className="block whitespace-nowrap">
                {line}
              </span>
            ))}
            <span className="inline-block whitespace-nowrap rotate-[-1.2deg] rounded-[var(--radius-card)] border-[3px] border-ink bg-lime px-4 py-1 text-ink shadow-sticker">
              {hero.titleAccent}
            </span>
          </h1>

          <p className="mt-2 max-w-[44ch] text-[length:var(--step-1)] leading-[1.6] text-ink-muted">
            {hero.subtitle}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-4">
            <Button asChild size="xl">
              <TrackedAnchor
                href="#connect"
                event={AnalyticsEvent.MarketingCtaClicked}
                eventProperties={{ cta_id: "connect", location: "hero" }}
              >
                {hero.primaryCta}
              </TrackedAnchor>
            </Button>
            <Button asChild variant="secondary" size="xl">
              <a href={hero.secondaryHref}>{hero.secondaryCta}</a>
            </Button>
          </div>

          {/* Above the hero/marquee divide: platforms, not a second CTA block. */}
          <div className="mt-9">
            <AssistantRow label={hero.assistantsLabel} compact href="#connect" />
            <p className="mt-3 font-semibold text-ink-muted text-xs">
              {coverage.chainsLabel}
            </p>
            <ul
              aria-label={coverage.chainsLabel}
              className="mt-2.5 grid max-w-[30rem] grid-cols-5 gap-2"
            >
              {coverage.chains.map((chain) => (
                <li key={chain.slug}>
                  <a
                    href="#coverage"
                    className="flex h-9 items-center justify-center rounded-[var(--radius-card)] border-2 border-ink bg-paper-raised px-1.5 transition-colors hover:bg-lime-soft"
                  >
                    <Image
                      src={`/chains/${chain.slug}.png`}
                      alt={chain.name}
                      width={96}
                      height={32}
                      className="h-auto max-h-5 w-auto max-w-full object-contain"
                    />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>

        <Reveal on="load" beat={2}>
          <HeroVisual />
        </Reveal>
      </Container>
    </section>
  );
}

/**
 * Grocery photo as the right-column visual plane; the chat exchange is the
 * sticker slapped on top of it. The photo carries atmosphere; the card carries
 * the argument. No text is painted onto the photo.
 */
function HeroVisual() {
  const { hero } = he;

  return (
    <div className="relative">
      <div className="relative aspect-[4/3] -translate-x-16 overflow-hidden rounded-[var(--radius-card)] border-[3px] border-ink shadow-sticker-lg rotate-[-0.8deg] sm:-translate-x-24 lg:-translate-x-36">
        <Image
          src="/hero-grocery.webp"
          alt={hero.imageAlt}
          fill
          priority
          sizes="(max-width: 1024px) 92vw, 40vw"
          className="object-cover object-[50%_42%]"
        />
      </div>

      <HandArrow
        aria-hidden
        className="pointer-events-none absolute -top-10 end-6 z-20 hidden w-24 text-ink lg:block"
      />

      <div className="relative z-10 -mt-28 translate-x-10 sm:-mt-36 sm:translate-x-16 lg:-mt-44 lg:translate-x-24 xl:translate-x-36">
        <ChatExchange />
      </div>
    </div>
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

        <div className="mt-4 flex flex-nowrap items-center gap-x-3 border-t-2 border-ink/10 pt-3 text-xs">
          <span className="shrink-0 text-ink-muted">{chat.planCoverage}</span>
          <span className="inline-flex shrink-0 flex-nowrap items-baseline gap-1.5 whitespace-nowrap rounded-[var(--radius-card)] border-2 border-over bg-over-soft px-2.5 py-1 font-medium text-over">
            {chat.planMissingLabel}
            <span className="font-bold">{chat.planMissing}</span>
          </span>
        </div>
      </div>
    </figure>
  );
}
