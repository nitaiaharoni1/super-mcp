import { Container } from "@/components/shared/Container";
import { Section } from "@/components/shared/Section";
import { copy } from "@/content/he";

export function ProofStrip() {
  return (
    <Section className="border-y border-[color:color-mix(in_oklch,var(--color-olive)_16%,transparent)] py-0">
      <Container className="grid divide-y divide-[color:color-mix(in_oklch,var(--color-olive)_16%,transparent)] md:grid-cols-3 md:divide-x md:divide-y-0 md:divide-x-reverse">
        {copy.proof.map((item) => (
          <p key={item} className="py-5 text-center text-sm font-medium text-[var(--color-olive)]">
            {item}
          </p>
        ))}
      </Container>
    </Section>
  );
}
