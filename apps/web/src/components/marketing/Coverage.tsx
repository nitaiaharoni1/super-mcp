import Image from "next/image";

import { Container } from "@/components/shared/Container";
import { Reveal } from "@/components/shared/Reveal";
import { he } from "@/content/he";

/**
 * The moat, stated plainly. The counts are a sheet of shelf tags rather than a
 * wall of hero metrics, and the chain names do the real persuading: an Israeli
 * reader recognises them instantly and knows what is and is not covered.
 *
 * Photography here is a full-bleed strip framed in ink with no text over it, so
 * a photo never occupies a slot where an argument belongs.
 */

/* Tiny rotations so the stat tags read as slapped-on stickers, not a grid template. */
const TAG_TILTS = ["rotate-[-0.8deg]", "rotate-[0.6deg]", "rotate-[-0.4deg]", "rotate-[0.8deg]", "rotate-[-0.6deg]", "rotate-[0.4deg]"];

export function Coverage() {
  const { coverage, visuals } = he;

  return (
    <>
      <div className="relative aspect-[16/4] w-full overflow-hidden border-y-[3px] border-ink bg-paper-sunk md:aspect-[21/3]">
        <Image
          src="/shelf-prices.webp"
          alt={visuals.shelfAlt}
          fill
          sizes="100vw"
          className="object-cover object-[50%_55%]"
        />
      </div>

      <section
        id={coverage.id}
        className="scroll-mt-20 bg-paper-sunk py-[var(--space-section)]"
      >
        <Container>
          <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
            <Reveal>
              <p className="inline-block rotate-[-1.5deg] rounded-[var(--radius-pill)] border-2 border-ink bg-grape-soft px-4 py-1.5 text-sm font-bold text-ink shadow-sticker-sm">
                {coverage.eyebrow}
              </p>
              <h2 className="display mt-6 max-w-[18ch] text-[length:var(--step-4)]">
                {coverage.title}
              </h2>
              <p className="mt-5 max-w-[44ch] leading-[1.7] text-ink-muted">
                {coverage.body}
              </p>
            </Reveal>

            <Reveal>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {coverage.stats.map((stat, index) => (
                  <div
                    key={stat.label}
                    className={`rounded-[var(--radius-card)] border-[2.5px] border-ink bg-paper-raised p-4 shadow-sticker-sm ${TAG_TILTS[index % TAG_TILTS.length]}`}
                  >
                    {/* `.ltr` stays on an inline span: on the block it would flip
                        text-align to the left and unhook the figure from the
                        RTL column edge its label sits on. */}
                    <dd className="text-[length:var(--step-3)] leading-none text-ink">
                      <span className="figure ltr font-bold">{stat.value}</span>
                    </dd>
                    <dt className="mt-2 text-xs font-semibold text-ink-muted">{stat.label}</dt>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-xs text-ink-faint">{coverage.statsFootnote}</p>
            </Reveal>
          </div>

          {/* Small chain marks sit at the foot of the section, after the argument. */}
          <Reveal className="mt-16 border-t-2 border-ink/10 pt-8 md:mt-20">
            <h3 className="text-[0.6875rem] font-bold tracking-wide text-ink-muted">
              {coverage.chainsLabel}
            </h3>
            {/* Always five across: two equal rows of five on every breakpoint. */}
            <ul className="mt-3 grid grid-cols-5 gap-1.5 sm:gap-2">
              {coverage.chains.map((chain) => (
                <li
                  key={chain.slug}
                  className="flex h-14 items-center justify-center rounded-[6px] border-2 border-ink bg-paper-raised px-2 py-1.5 shadow-sticker-sm sm:h-20 sm:px-4 sm:py-2"
                >
                  <Image
                    src={`/chains/${chain.slug}.png`}
                    alt={chain.name}
                    width={180}
                    height={60}
                    className="h-auto max-h-8 w-auto max-w-full object-contain sm:max-h-12"
                  />
                </li>
              ))}
            </ul>
          </Reveal>
        </Container>
      </section>
    </>
  );
}
