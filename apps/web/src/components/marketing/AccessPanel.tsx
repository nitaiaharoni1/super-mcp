import { AccessRequestForm } from "@/components/marketing/AccessRequestForm";
import { Container } from "@/components/shared/Container";
import { Reveal } from "@/components/shared/Reveal";
import { he } from "@/content/he";

/**
 * End of the funnel: one action, nothing competing with it. Self-hosting used to
 * sit here as a second path, which asked a shopper to choose between "leave your
 * email" and "run your own server". It now lives in the developer disclosure.
 *
 * The block wears lime, the colour of the win, because this is where the saving
 * starts. Ink text on lime everywhere, per the palette lock.
 */
export function AccessPanel() {
  const { access } = he;

  return (
    <section
      id={access.id}
      className="scroll-mt-20 border-y-[3px] border-ink bg-lime py-[var(--space-section)]"
    >
      <Container>
        <div className="grid items-center gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:gap-16">
          <Reveal>
            <h2 className="display max-w-[18ch] text-[length:var(--step-4)] text-ink">
              {access.title}
            </h2>
            <p className="mt-5 max-w-[38ch] font-medium leading-[1.7] text-ink">
              {access.body}
            </p>
          </Reveal>

          <Reveal>
            <div className="rounded-[var(--radius-card)] border-[3px] border-ink bg-paper-raised p-7 shadow-sticker-lg md:p-9">
              <AccessRequestForm />
            </div>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
