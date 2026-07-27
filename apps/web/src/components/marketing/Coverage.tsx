import Image from "next/image";

import { Container } from "@/components/shared/Container";
import { Reveal } from "@/components/shared/Reveal";
import { he } from "@/content/he";

/**
 * The moat, stated plainly. The counts are a spec sheet rather than a wall of
 * hero metrics, and the chain names do the real persuading: an Israeli reader
 * recognises them instantly and knows what is and is not covered.
 *
 * This is also the one place photography lives, as a full-bleed strip with no
 * text over it, so a photo never occupies a slot where an argument belongs.
 */
export function Coverage() {
  const { coverage } = he;

  return (
    <>
      <div className="relative aspect-[21/6] w-full overflow-hidden bg-[var(--color-paper-sunk)] md:aspect-[24/5]">
        <Image
          src="/shelf-prices.webp"
          alt="מדפי סופרמרקט עמוסים עם פסי תגי מחיר לאורך כל מדף"
          fill
          sizes="100vw"
          className="object-cover object-center"
        />
      </div>

      <section
        id={coverage.id}
        className="scroll-mt-20 bg-[var(--color-paper-sunk)] py-[var(--space-section)]"
      >
        <Container>
          <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
            <Reveal>
              <p className="text-sm font-semibold text-[var(--color-accent)]">{coverage.eyebrow}</p>
              <h2 className="display mt-4 max-w-[18ch] text-[length:var(--step-4)]">
                {coverage.title}
              </h2>
              <p className="mt-5 max-w-[44ch] leading-[1.7] text-[var(--color-ink-muted)]">
                {coverage.body}
              </p>
            </Reveal>

            <Reveal>
              <dl className="grid grid-cols-2 gap-x-8 sm:grid-cols-3">
                {coverage.stats.map((stat) => (
                  <div
                    key={stat.label}
                    className="border-b border-[var(--color-line)] py-4 first:border-t sm:[&:nth-child(-n+3)]:border-t"
                  >
                    <dt className="text-xs text-[var(--color-ink-muted)]">{stat.label}</dt>
                    {/* `.ltr` stays on an inline span: on the block it would flip
                        text-align to the left and unhook the figure from the
                        RTL column edge its label sits on. */}
                    <dd className="mt-1 text-[length:var(--step-3)] leading-none text-[var(--color-ink)]">
                      <span className="figure ltr">{stat.value}</span>
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-xs text-[var(--color-ink-faint)]">{coverage.statsFootnote}</p>
            </Reveal>
          </div>

          <Reveal className="mt-14">
            <h3 className="text-xs font-semibold tracking-wide text-[var(--color-ink-muted)]">
              {coverage.chainsLabel}
            </h3>
            <ul className="mt-5 flex flex-wrap items-baseline gap-x-6 gap-y-3 border-t border-[var(--color-line)] pt-6">
              {coverage.chains.map((chain) => (
                <li
                  key={chain}
                  className="display text-[length:var(--step-2)] text-[var(--color-ink)]"
                >
                  {chain}
                </li>
              ))}
            </ul>
          </Reveal>
        </Container>
      </section>
    </>
  );
}
