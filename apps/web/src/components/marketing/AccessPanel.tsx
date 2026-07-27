import { AccessRequestForm } from "@/components/marketing/AccessRequestForm";
import { Container } from "@/components/shared/Container";
import { Reveal } from "@/components/shared/Reveal";
import { TrackedAnchor } from "@/components/shared/TrackedAnchor";
import { Button } from "@/components/ui/button";
import { he } from "@/content/he";
import { AnalyticsEvent } from "@/lib/analytics";

/** End of the funnel. The connection details are already open above this, so
 *  everything here is the one remaining action plus the self-host escape hatch. */
export function AccessPanel() {
  const { access } = he;

  return (
    <section
      id={access.id}
      className="scroll-mt-20 bg-[var(--color-accent-soft)] py-[var(--space-section)]"
    >
      <Container>
        <div className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:gap-16">
          <Reveal>
            <h2 className="display max-w-[16ch] text-[length:var(--step-4)]">{access.title}</h2>
            <p className="mt-5 max-w-[38ch] leading-[1.7] text-[var(--color-ink-muted)]">
              {access.body}
            </p>

            <div className="mt-9 border-t border-[var(--color-line-strong)] pt-6">
              <h3 className="text-base font-semibold">{access.selfHost}</h3>
              <p className="mt-2 max-w-[36ch] text-sm leading-6 text-[var(--color-ink-muted)]">
                {access.selfHostHint}
              </p>
              <Button asChild variant="quiet" className="mt-4">
                <TrackedAnchor
                  href="https://github.com/nitaiaharoni1/super-mcp/blob/main/README.md"
                  target="_blank"
                  rel="noreferrer"
                  event={AnalyticsEvent.SelfHostDocsClicked}
                >
                  {access.selfHostCta}
                </TrackedAnchor>
              </Button>
            </div>
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
