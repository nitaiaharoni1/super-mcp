"use client";

import { Container } from "@/components/shared/Container";
import { Section } from "@/components/shared/Section";
import { he } from "@/content/he";

export function DeveloperSurface() {
  return (
    <Section id={he.developer.id} className="scroll-mt-20 py-10 md:py-12">
      <Container>
        <details className="group rounded-[var(--radius-xl)] border border-[var(--color-line)] bg-white px-5 py-4 md:px-6">
          <summary className="cursor-pointer list-none text-base font-semibold marker:content-none [&::-webkit-details-marker]:hidden">
            <span className="underline-offset-4 group-open:underline">{he.developer.summary}</span>
          </summary>
          <div className="mt-4 border-t border-[var(--color-line)] pt-4 text-start">
            <h3 className="text-lg font-semibold">{he.developer.title}</h3>
            <p className="mt-2 text-sm leading-6 text-[var(--color-ink-muted)]">{he.developer.body}</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {he.developer.groups.map((group) => (
                <div key={group.title}>
                  <p className="text-sm font-medium">{group.title}</p>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {group.tools.map((tool) => (
                      <li
                        key={tool}
                        dir="ltr"
                        className="rounded-[var(--radius-pill)] bg-[var(--color-olive-soft)] px-3 py-1 font-[family-name:var(--font-geist-mono)] text-xs"
                      >
                        {tool}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </details>
      </Container>
    </Section>
  );
}
