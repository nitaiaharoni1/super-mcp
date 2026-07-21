import { Container } from "@/components/shared/Container";
import { Section } from "@/components/shared/Section";
import { copy } from "@/content/he";

export function ConnectPanel() {
  return (
    <Section id="connect" className="scroll-mt-20">
      <Container>
        <div className="border-y border-[color:color-mix(in_oklch,var(--color-accent)_38%,transparent)] py-12 md:py-16">
          <h2 className="text-4xl font-semibold tracking-[-0.05em] md:text-5xl">
            {copy.connect.title}
          </h2>
        </div>
      </Container>
    </Section>
  );
}
