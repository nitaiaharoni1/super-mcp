"use client";

import Image from "next/image";

import { CodeBlock } from "@/components/shared/CodeBlock";
import { Container } from "@/components/shared/Container";
import { CopyButton } from "@/components/shared/CopyButton";
import { Reveal } from "@/components/shared/Reveal";
import { he } from "@/content/he";
import { AnalyticsEvent } from "@/lib/analytics";
import { buildMcpJsonSnippet, getMcpUrl } from "@/lib/mcp";

/**
 * The conversion moment for the actual audience. This used to be a `<details>`
 * labelled "developer details" near the bottom; an agent builder had to open two
 * disclosures to find out whether the thing was even connectable. It is now open
 * on the page, above the access form, with one real screenshot as proof that the
 * integration exists rather than a mockup of it.
 */
export function Connect() {
  const { connect } = he;
  const url = getMcpUrl();
  const json = buildMcpJsonSnippet(url);

  return (
    <section id={connect.id} className="scroll-mt-20 py-[var(--space-section)]">
      <Container>
        <Reveal className="max-w-[44rem]">
          <p className="text-sm font-semibold text-[var(--color-accent)]">{connect.eyebrow}</p>
          <h2 className="display mt-4 text-[length:var(--step-4)]">{connect.title}</h2>
          <p className="mt-5 max-w-[52ch] text-[length:var(--step-1)] leading-[1.65] text-[var(--color-ink-muted)]">
            {connect.body}
          </p>

          <div className="mt-7 flex flex-wrap items-baseline gap-x-5 gap-y-2">
            <span className="text-xs text-[var(--color-ink-muted)]">{connect.clientsLabel}</span>
            {connect.clients.map((client) => (
              <span
                key={client}
                dir="ltr"
                className="text-sm font-semibold tracking-[-0.01em] text-[var(--color-ink)]"
              >
                {client}
              </span>
            ))}
            <span className="text-xs text-[var(--color-ink-muted)]">{connect.clientsNote}</span>
          </div>
        </Reveal>

        <div className="mt-12 grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14">
          <Reveal className="min-w-0">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="figure text-xs text-[var(--color-ink-muted)]">
                  {connect.jsonLabel}
                </h3>
                <CopyButton
                  value={json}
                  label={connect.copyJson}
                  analyticsEvent={AnalyticsEvent.McpJsonCopied}
                />
              </div>
              <CodeBlock code={json} className="mt-3" />
            </div>

            <div className="mt-7 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-xs text-[var(--color-ink-muted)]">{connect.urlLabel}</h3>
                <CopyButton
                  value={url}
                  label={connect.copyUrl}
                  analyticsEvent={AnalyticsEvent.McpUrlCopied}
                />
              </div>
              <CodeBlock code={url} className="mt-3" />
            </div>

            <p className="mt-5 border-s-2 border-[var(--color-over)] ps-4 text-sm leading-6 text-[var(--color-ink-muted)]">
              {connect.secretWarning}
            </p>
          </Reveal>

          <Reveal className="min-w-0">
            <h3 className="text-[length:var(--step-2)] font-semibold tracking-[-0.01em]">
              {connect.toolsLabel}
            </h3>
            <p className="mt-2.5 max-w-[42ch] text-sm leading-6 text-[var(--color-ink-muted)]">
              {connect.toolsHint}
            </p>

            <dl className="mt-6">
              {connect.groups.map((group) => (
                <div
                  key={group.title}
                  className="grid gap-x-6 gap-y-2 border-t border-[var(--color-line)] py-3.5 sm:grid-cols-[8rem_1fr]"
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

            <p className="mt-5 text-sm leading-6 text-[var(--color-ink-muted)]">
              {connect.rateLimit}
            </p>

            {/* Natural aspect, not a crop: a squeezed screenshot is decoration,
                and decoration is exactly what this section should not contain. */}
            <figure className="mt-9 max-w-[23rem]">
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
      </Container>
    </section>
  );
}
