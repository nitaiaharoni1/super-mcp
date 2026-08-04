import { Container } from "@/components/shared/Container";
import { Sparkle } from "@/components/shared/doodles";
import { Reveal } from "@/components/shared/Reveal";
import { he } from "@/content/he";

/*
 * Three failure modes of price comparison and what we do instead. The real
 * question the agent returned is the anchor sticker, and the three points sit
 * beside it as tinted tags, each rotated like it was slapped on the board by
 * hand rather than cloned from a template.
 */
const POINT_STYLES = [
  { card: "bg-paper-raised rotate-[0.6deg]", chip: "bg-grape-soft" },
  { card: "bg-lime-soft rotate-[-0.6deg]", chip: "bg-lime" },
  { card: "bg-grape-soft rotate-[0.6deg]", chip: "bg-grape-soft" },
] as const;

export function Integrity() {
  const { integrity } = he;

  return (
    <section id={integrity.id} className="scroll-mt-20 py-[var(--space-section)]">
      <Container>
        <Reveal className="max-w-[46rem]">
          <h2 className="display text-[length:var(--step-4)]">{integrity.title}</h2>
          <p className="mt-5 max-w-[52ch] text-[length:var(--step-1)] leading-[1.65] text-ink-muted">
            {integrity.lead}
          </p>
        </Reveal>

        <div className="mt-14 grid gap-12 lg:grid-cols-[0.88fr_1.12fr] lg:gap-16">
          <Reveal>
            <figure className="relative rotate-[-1deg] rounded-[var(--radius-card)] border-[3px] border-ink bg-paper-raised p-6 shadow-sticker-lg md:p-7">
              <Sparkle
                aria-hidden
                className="absolute -top-4 -end-3 size-9 rotate-12 text-tangerine"
              />
              <figcaption className="inline-block rounded-[var(--radius-pill)] border-2 border-ink bg-lime px-3.5 py-1 text-xs font-bold text-ink">
                {integrity.question.label}
              </figcaption>
              <blockquote className="display mt-4 text-[length:var(--step-2)] leading-[1.3] text-ink">
                {integrity.question.text}
              </blockquote>
              <p className="mt-5 max-w-[34ch] text-sm leading-6 text-ink-muted">
                {integrity.question.caption}
              </p>
            </figure>
          </Reveal>

          <ol className="grid content-start gap-6">
            {integrity.points.map((point, index) => (
              <Reveal key={point.title}>
                <li
                  className={`grid grid-cols-[2.75rem_1fr] gap-x-4 rounded-[var(--radius-card)] border-[3px] border-ink p-5 shadow-sticker ${POINT_STYLES[index % POINT_STYLES.length].card}`}
                >
                  <span
                    aria-hidden
                    className={`figure ltr grid size-10 place-items-center rounded-[6px] border-[2.5px] border-ink text-sm font-bold text-ink ${POINT_STYLES[index % POINT_STYLES.length].chip}`}
                  >
                    {index + 1}
                  </span>
                  <div>
                    <h3 className="text-[length:var(--step-2)] font-bold leading-snug tracking-[-0.01em]">
                      {point.title}
                    </h3>
                    <p className="mt-2.5 max-w-[54ch] leading-[1.7] text-ink-muted">
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
