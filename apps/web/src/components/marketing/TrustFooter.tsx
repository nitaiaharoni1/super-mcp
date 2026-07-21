import { Container } from "@/components/shared/Container";
import { MotionReveal } from "@/components/shared/MotionReveal";
import { Section } from "@/components/shared/Section";
import { he } from "@/content/he";

export function TrustFooter() {
  return (
    <Section id={he.trust.id} className="scroll-mt-20 pb-12 pt-4 md:pb-16">
      <Container>
        <MotionReveal className="rounded-[var(--radius-xl)] bg-[var(--color-olive-soft)]/70 px-6 py-8 text-center md:px-10">
          <h2 className="font-[family-name:var(--font-secular)] text-2xl tracking-[-0.02em] md:text-3xl">
            {he.trust.title}
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-[var(--color-ink-muted)] md:text-base">
            {he.trust.body}
          </p>
          <ul className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            {he.trust.links.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-semibold text-[var(--color-accent)] underline-offset-4 hover:underline"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </MotionReveal>
      </Container>
    </Section>
  );
}
