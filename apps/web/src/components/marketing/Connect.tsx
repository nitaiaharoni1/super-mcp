"use client";

import Image from "next/image";

import { CodeBlock } from "@/components/shared/CodeBlock";
import { Container } from "@/components/shared/Container";
import { CopyButton } from "@/components/shared/CopyButton";
import { Reveal } from "@/components/shared/Reveal";
import { TrackedAnchor } from "@/components/shared/TrackedAnchor";
import { Button } from "@/components/ui/button";
import { he } from "@/content/he";
import { AnalyticsEvent, capture } from "@/lib/analytics";
import { buildMcpJsonSnippet, getMcpUrl } from "@/lib/mcp";

/**
 * How a shopper gets from here to a priced basket, in three plain steps.
 *
 * Everything technical (the mcp.json block, the tool list, self-hosting) sits
 * behind one disclosure at the bottom. A shopper never opens it; someone wiring
 * this into their own tooling finds it in one click. Before this, the config was
 * the section, which meant the page answered a question shoppers never asked.
 */
export function Connect() {
  const { connect } = he;

  return (
    <section id={connect.id} className="scroll-mt-20 py-[var(--space-section)]">
      <Container>
        <Reveal className="max-w-[44rem]">
          <p className="text-sm font-semibold text-[var(--color-accent)]">{connect.eyebrow}</p>
          <h2 className="display mt-4 text-[length:var(--step-4)]">{connect.title}</h2>
          <p className="mt-5 max-w-[52ch] text-[length:var(--step-1)] leading-[1.65] text-[var(--color-ink-muted)]">
            {connect.body}
          </p>
        </Reveal>

        <div className="mt-12 grid gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
          <Reveal>
            <ol className="grid">
              {connect.steps.map((step, index) => (
                <li
                  key={step.title}
                  className="grid grid-cols-[2.25rem_1fr] gap-x-4 border-b border-[var(--color-line)] py-6 first:pt-0 last:border-b-0 last:pb-0"
                >
                  <span aria-hidden className="figure ltr pt-1 text-sm text-[var(--color-ink-faint)]">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3 className="text-[length:var(--step-2)] font-semibold leading-snug tracking-[-0.01em]">
                      {step.title}
                    </h3>
                    <p className="mt-2 max-w-[46ch] leading-[1.7] text-[var(--color-ink-muted)]">
                      {step.body}
                    </p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-9 border-t border-[var(--color-line)] pt-5">
              <p className="text-xs text-[var(--color-ink-muted)]">{connect.assistantsLabel}</p>
              <ul className="mt-2.5 flex flex-wrap items-baseline gap-x-5 gap-y-2">
                {connect.assistants.map((name) => (
                  <li
                    key={name}
                    dir="ltr"
                    className="text-sm font-semibold tracking-[-0.01em] text-[var(--color-ink)]"
                  >
                    {name}
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 text-xs text-[var(--color-ink-muted)]">
                {connect.assistantsNote}
              </p>
            </div>
          </Reveal>

          <Reveal className="min-w-0">
            <figure className="max-w-[23rem]">
              <div className="relative aspect-[841/1400] w-full overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-paper-sunk)]">
                <Image
                  src={connect.proofImageSrc}
                  alt={connect.proofImageAlt}
                  fill
                  sizes="(max-width: 1024px) 100vw, 368px"
                  className="object-cover object-top"
                />
              </div>
              <figcaption className="mt-3 text-xs leading-5 text-[var(--color-ink-faint)]">
                {connect.proofCaption}
              </figcaption>
            </figure>
          </Reveal>
        </div>

        <Reveal className="mt-14">
          <DeveloperDetails />
        </Reveal>
      </Container>
    </section>
  );
}

function DeveloperDetails() {
  const { dev } = he.connect;
  const url = getMcpUrl();
  const json = buildMcpJsonSnippet(url);

  return (
    <details
      className="group rounded-[var(--radius-xl)] border border-[var(--color-line)] bg-[var(--color-paper-raised)] px-5 py-4 md:px-7 md:py-5"
      onToggle={(e) => {
        if (e.currentTarget.open) capture(AnalyticsEvent.AccessDetailsOpened);
      }}
    >
      <summary className="cursor-pointer list-none font-semibold marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="underline-offset-4 group-open:underline">{dev.summary}</span>
      </summary>

      <div className="mt-5 grid gap-10 border-t border-[var(--color-line)] pt-6 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14">
        <div className="min-w-0">
          <p className="max-w-[54ch] text-sm leading-7 text-[var(--color-ink-muted)]">{dev.body}</p>

          <div className="mt-6 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="figure text-xs text-[var(--color-ink-muted)]">{dev.jsonLabel}</h3>
              <CopyButton
                value={json}
                label={dev.copyJson}
                analyticsEvent={AnalyticsEvent.McpJsonCopied}
              />
            </div>
            <CodeBlock code={json} className="mt-3" />
          </div>

          <div className="mt-6 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-xs text-[var(--color-ink-muted)]">{dev.urlLabel}</h3>
              <CopyButton
                value={url}
                label={dev.copyUrl}
                analyticsEvent={AnalyticsEvent.McpUrlCopied}
              />
            </div>
            <CodeBlock code={url} className="mt-3" />
          </div>

          <p className="mt-5 border-s-2 border-[var(--color-over)] ps-4 text-sm leading-6 text-[var(--color-ink-muted)]">
            {dev.secretWarning}
          </p>
        </div>

        <div className="min-w-0">
          <h3 className="text-base font-semibold">{dev.toolsLabel}</h3>
          <p className="mt-2 max-w-[42ch] text-sm leading-6 text-[var(--color-ink-muted)]">
            {dev.toolsHint}
          </p>

          <dl className="mt-5">
            {dev.groups.map((group) => (
              <div
                key={group.title}
                className="grid gap-x-6 gap-y-2 border-t border-[var(--color-line)] py-3 sm:grid-cols-[7rem_1fr]"
              >
                <dt className="text-sm text-[var(--color-ink-muted)]">{group.title}</dt>
                <dd className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {group.tools.map((tool) => (
                    <span key={tool} dir="ltr" className="figure text-[0.8125rem]">
                      {tool}
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>

          <p className="mt-5 text-sm leading-6 text-[var(--color-ink-muted)]">{dev.rateLimit}</p>

          <div className="mt-7 border-t border-[var(--color-line)] pt-5">
            <h4 className="text-sm font-semibold">{dev.selfHost}</h4>
            <p className="mt-2 text-sm leading-6 text-[var(--color-ink-muted)]">
              {dev.selfHostHint}
            </p>
            <Button asChild variant="quiet" className="mt-3">
              <TrackedAnchor
                href="https://github.com/nitaiaharoni1/super-mcp/blob/main/README.md"
                target="_blank"
                rel="noreferrer"
                event={AnalyticsEvent.SelfHostDocsClicked}
              >
                {dev.selfHostCta}
              </TrackedAnchor>
            </Button>
          </div>
        </div>
      </div>
    </details>
  );
}
