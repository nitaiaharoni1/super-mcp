"use client";

import Image from "next/image";

import { AssistantRow } from "@/components/shared/AssistantRow";
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
const STEP_TILTS = ["rotate-[0.5deg]", "rotate-[-0.5deg]", "rotate-[0.5deg]"];

export function Connect() {
  const { connect } = he;

  return (
    <section id={connect.id} className="scroll-mt-20 py-[var(--space-section)]">
      <Container>
        <Reveal className="max-w-[44rem]">
          <p className="inline-block rotate-[-1.5deg] rounded-[var(--radius-pill)] border-2 border-ink bg-lime px-4 py-1.5 text-sm font-bold text-ink shadow-sticker-sm">
            {connect.eyebrow}
          </p>
          <h2 className="display mt-6 text-[length:var(--step-4)]">{connect.title}</h2>
          <p className="mt-5 max-w-[52ch] text-[length:var(--step-1)] leading-[1.65] text-ink-muted">
            {connect.body}
          </p>
        </Reveal>

        <div className="mt-12 grid gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
          <Reveal>
            <ol className="grid gap-6">
              {connect.steps.map((step, index) => (
                <li
                  key={step.title}
                  className={`grid grid-cols-[2.75rem_1fr] gap-x-4 rounded-[var(--radius-card)] border-[3px] border-ink bg-paper-raised p-5 shadow-sticker ${STEP_TILTS[index % STEP_TILTS.length]}`}
                >
                  <span
                    aria-hidden
                    className="figure ltr grid size-10 rotate-[-3deg] place-items-center rounded-[6px] border-[2.5px] border-ink bg-lime text-sm font-bold text-ink"
                  >
                    {index + 1}
                  </span>
                  <div>
                    <h3 className="text-[length:var(--step-2)] font-bold leading-snug tracking-[-0.01em]">
                      {step.title}
                    </h3>
                    <p className="mt-2 max-w-[46ch] leading-[1.7] text-ink-muted">
                      {step.body}
                    </p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-9">
              <AssistantRow label={connect.assistantsLabel} note={connect.assistantsNote} />
            </div>
          </Reveal>

          <Reveal className="min-w-0">
            <figure className="max-w-[23rem] rotate-[1.5deg]">
              <div className="relative aspect-[841/1400] w-full overflow-hidden rounded-[var(--radius-card)] border-[3px] border-ink bg-paper-sunk shadow-sticker-lg">
                <Image
                  src={connect.proofImageSrc}
                  alt={connect.proofImageAlt}
                  fill
                  priority
                  sizes="(max-width: 1024px) 100vw, 368px"
                  className="object-cover object-top"
                />
              </div>
              <figcaption className="mt-3 text-xs leading-5 text-ink-faint">
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
      className="group rounded-[var(--radius-card)] border-[3px] border-ink bg-paper-raised px-5 py-4 shadow-sticker md:px-7 md:py-5"
      onToggle={(e) => {
        if (e.currentTarget.open) capture(AnalyticsEvent.AccessDetailsOpened);
      }}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-bold marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="underline-offset-4 decoration-2 group-open:underline">{dev.summary}</span>
        <span
          aria-hidden
          className="figure grid size-8 shrink-0 place-items-center rounded-[6px] border-2 border-ink bg-lime text-ink transition-transform duration-200 ease-out group-open:rotate-45"
        >
          +
        </span>
      </summary>

      <div className="mt-5 grid gap-10 border-t-[3px] border-ink pt-6 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14">
        <div className="min-w-0">
          <p className="max-w-[54ch] text-sm leading-7 text-ink-muted">{dev.body}</p>

          <div className="mt-6 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="figure text-xs text-ink-muted">{dev.jsonLabel}</h3>
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
              <h3 className="text-xs text-ink-muted">{dev.urlLabel}</h3>
              <CopyButton
                value={url}
                label={dev.copyUrl}
                analyticsEvent={AnalyticsEvent.McpUrlCopied}
              />
            </div>
            <CodeBlock code={url} className="mt-3" />
          </div>

          <p className="mt-5 rounded-[var(--radius-card)] border-2 border-over bg-over-soft px-4 py-3 text-sm leading-6 text-ink">
            {dev.secretWarning}
          </p>
        </div>

        <div className="min-w-0">
          <h3 className="text-base font-bold">{dev.toolsLabel}</h3>
          <p className="mt-2 max-w-[42ch] text-sm leading-6 text-ink-muted">
            {dev.toolsHint}
          </p>

          <dl className="mt-5">
            {dev.groups.map((group) => (
              <div
                key={group.title}
                className="grid gap-x-6 gap-y-2 border-t-2 border-ink/10 py-3 sm:grid-cols-[7rem_1fr]"
              >
                <dt className="text-sm font-semibold text-ink-muted">{group.title}</dt>
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

          <p className="mt-5 text-sm leading-6 text-ink-muted">{dev.rateLimit}</p>

          <div className="mt-7 border-t-2 border-ink/10 pt-5">
            <h4 className="text-sm font-bold">{dev.selfHost}</h4>
            <p className="mt-2 text-sm leading-6 text-ink-muted">
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
