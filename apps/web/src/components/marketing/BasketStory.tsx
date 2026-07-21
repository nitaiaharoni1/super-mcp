import { Container } from "@/components/shared/Container";
import { Section } from "@/components/shared/Section";
import { copy } from "@/content/he";

export function BasketStory() {
  return (
    <Section className="bg-[color:color-mix(in_oklch,var(--color-olive-soft)_45%,var(--color-paper))]">
      <Container className="grid gap-12 md:grid-cols-12 md:gap-8">
        <h2 className="text-4xl font-semibold leading-tight tracking-[-0.05em] md:col-span-5 md:text-5xl">
          {copy.basketStory.title}
        </h2>
        <ol className="md:col-span-6 md:col-start-7">
          {copy.basketStory.steps.map((step, index) => (
            <li
              key={step}
              className="grid grid-cols-[3.5rem_1fr] gap-4 border-t border-[color:color-mix(in_oklch,var(--color-olive)_22%,transparent)] py-6 first:pt-0"
            >
              <span
                dir="ltr"
                className="font-mono text-sm font-medium text-[var(--color-accent)]"
              >
                0{index + 1}
              </span>
              <p className="text-lg leading-8 text-[var(--color-ink)]">{step}</p>
            </li>
          ))}
        </ol>
      </Container>
    </Section>
  );
}
