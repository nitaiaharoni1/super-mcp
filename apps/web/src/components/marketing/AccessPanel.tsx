import { AccessRequestForm } from "@/components/marketing/AccessRequestForm";
import { Container } from "@/components/shared/Container";
import { Reveal } from "@/components/shared/Reveal";
import { he } from "@/content/he";

/**
 * End of the funnel: one action, nothing competing with it. Self-hosting used to
 * sit here as a second path, which asked a shopper to choose between "leave your
 * email" and "run your own server". It now lives in the developer disclosure.
 */
export function AccessPanel() {
  const { access } = he;

  return (
    <section
      id={access.id}
      className="scroll-mt-20 bg-[var(--color-accent-soft)] py-[var(--space-section)]"
    >
      <Container>
        <div className="grid items-center gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:gap-16">
          <Reveal>
            <h2 className="display max-w-[18ch] text-[length:var(--step-4)]">{access.title}</h2>
            <p className="mt-5 max-w-[38ch] leading-[1.7] text-[var(--color-ink-muted)]">
              {access.body}
            </p>
          </Reveal>

          <Reveal>
            <div className="rounded-[var(--radius-xl)] border border-[var(--color-line)] bg-[var(--color-paper-raised)] p-7 md:p-9">
              <AccessRequestForm />
            </div>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
