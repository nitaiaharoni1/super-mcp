"use client";

import Image from "next/image";

import { Container } from "@/components/shared/Container";
import { CodeBlock } from "@/components/shared/CodeBlock";
import { CopyButton } from "@/components/shared/CopyButton";
import { MotionReveal } from "@/components/shared/MotionReveal";
import { Section } from "@/components/shared/Section";
import { TrackedAnchor } from "@/components/shared/TrackedAnchor";
import { Button } from "@/components/ui/button";
import { AccessRequestForm } from "@/components/marketing/AccessRequestForm";
import { he } from "@/content/he";
import { AnalyticsEvent, capture } from "@/lib/analytics";
import { buildMcpJsonSnippet, getMcpUrl } from "@/lib/mcp";

export function AccessPanel() {
  const url = getMcpUrl();
  const json = buildMcpJsonSnippet(url);

  return (
    <Section id={he.access.id} className="scroll-mt-20 py-16 md:py-24">
      <Container>
        <MotionReveal>
          <div className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-line)] bg-white shadow-[0_24px_60px_-36px_oklch(0.24_0.03_150_/_0.45)]">
            <div className="grid lg:grid-cols-2">
              <div className="relative aspect-[4/3] min-h-[240px] lg:aspect-auto lg:min-h-[420px]">
                <Image
                  src={he.access.imageSrc}
                  alt={he.access.imageAlt}
                  fill
                  sizes="(max-width: 1024px) 100vw, 560px"
                  className="object-cover object-[30%_center]"
                />
              </div>

              <div className="flex flex-col justify-center p-7 md:p-10">
                <h2 className="font-[family-name:var(--font-secular)] text-[clamp(1.85rem,3.2vw,2.5rem)] leading-[1.12] tracking-[-0.02em]">
                  {he.access.title}
                </h2>
                <p className="mt-4 max-w-[38ch] text-[var(--color-ink-muted)] leading-7">
                  {he.access.body}
                </p>

                <div className="mt-7">
                  <AccessRequestForm />
                </div>

                <details
                  className="group mt-8"
                  onToggle={(e) => {
                    if (e.currentTarget.open) capture(AnalyticsEvent.AccessDetailsOpened);
                  }}
                >
                  <summary className="cursor-pointer list-none text-base font-semibold marker:content-none [&::-webkit-details-marker]:hidden">
                    <span className="underline-offset-4 group-open:underline">
                      {he.access.alreadyHaveKey}
                    </span>
                  </summary>
                  <div className="mt-4 grid gap-4">
                    <p className="text-sm leading-6 text-[var(--color-ink-muted)]">
                      {he.access.alreadyHaveKeyHint}
                    </p>
                    <div className="grid gap-2">
                      <CodeBlock code={url} className="min-w-0 overflow-x-auto bg-[var(--color-olive-soft)]" />
                      <div>
                        <CopyButton
                          value={url}
                          label={he.access.copyUrl}
                          analyticsEvent={AnalyticsEvent.McpUrlCopied}
                        />
                      </div>
                    </div>
                    <div className="grid gap-2">
                      <CodeBlock
                        code={json}
                        className="min-w-0 overflow-x-auto bg-[var(--color-data)] text-[var(--color-data-fg)]"
                      />
                      <div>
                        <CopyButton
                          value={json}
                          label={he.access.copyJson}
                          analyticsEvent={AnalyticsEvent.McpJsonCopied}
                        />
                      </div>
                    </div>
                  </div>
                </details>

                <div className="mt-8 border-t border-[var(--color-line)] pt-6">
                  <h3 className="text-base font-semibold">{he.access.selfHost}</h3>
                  <p className="mt-2 text-sm text-[var(--color-ink-muted)]">{he.access.selfHostHint}</p>
                  <Button asChild variant="outline" className="mt-4">
                    <TrackedAnchor
                      href="https://github.com/nitaiaharoni1/super-mcp/blob/main/README.md"
                      target="_blank"
                      rel="noreferrer"
                      event={AnalyticsEvent.SelfHostDocsClicked}
                    >
                      {he.access.selfHostCta}
                    </TrackedAnchor>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </MotionReveal>
      </Container>
    </Section>
  );
}
