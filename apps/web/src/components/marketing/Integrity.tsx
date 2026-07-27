import { Container } from "@/components/shared/Container";
import { Reveal } from "@/components/shared/Reveal";
import { he } from "@/content/he";

/**
 * Three failure modes of price comparison and what we do instead. Deliberately
 * not three matching cards: the real question the agent returned is the anchor,
 * and the three points sit beside it as a hairline-ruled list.
 */
export function Integrity() {
  const { integrity } = he;

  return (
    <section id={integrity.id} className="scroll-mt-20 py-[var(--space-section)]">
      <Container>
        <Reveal className="max-w-[46rem]">
          <h2 className="display text-[length:var(--step-4)]">{integrity.title}</h2>
          <p className="mt-5 max-w-[52ch] text-[length:var(--step-1)] leading-[1.65] text-[var(--color-ink-muted)]">
            {integrity.lead}
          </p>
        </Reveal>

        <div className="mt-14 grid gap-12 lg:grid-cols-[0.88fr_1.12fr] lg:gap-16">
          <Reveal>
            <figure className="border-t-2 border-[var(--color-accent)] pt-6">
              <figcaption className="text-xs font-semibold tracking-wide text-[var(--color-accent)]">
                {integrity.question.label}
              </figcaption>
              <blockquote className="display mt-4 text-[length:var(--step-2)] leading-[1.3] text-[var(--color-ink)]">
                {integrity.question.text}
              </blockquote>
              <p className="mt-5 max-w-[34ch] text-sm leading-6 text-[var(--color-ink-muted)]">
                {integrity.question.caption}
              </p>
            </figure>
          </Reveal>

          <ol className="grid gap-0">
            {integrity.points.map((point, index) => (
              <Reveal key={point.title}>
                <li className="grid grid-cols-[2.25rem_1fr] gap-x-4 border-b border-[var(--color-line)] py-6 first:pt-0 last:border-b-0 last:pb-0">
                  <span
                    aria-hidden
                    className="figure ltr pt-1 text-sm text-[var(--color-ink-faint)]"
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3 className="text-[length:var(--step-2)] font-semibold leading-snug tracking-[-0.01em]">
                      {point.title}
                    </h3>
                    <p className="mt-2.5 max-w-[54ch] leading-[1.7] text-[var(--color-ink-muted)]">
                      {point.body}
                    </p>
                  </div>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>
      </Container>
    </section>
  );
}
