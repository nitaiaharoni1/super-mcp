"use client";

import { Container } from "@/components/shared/Container";
import { Section } from "@/components/shared/Section";
import { CodeBlock } from "@/components/shared/CodeBlock";
import { CopyButton } from "@/components/shared/CopyButton";
import { Button } from "@/components/ui/button";
import { copy } from "@/content/he";
import {
  MCP_SERVER_NAME,
  buildCursorInstallLink,
  buildMcpJsonSnippet,
  getMcpUrl,
} from "@/lib/mcp";

function ConnectField({
  label,
  value,
  copyLabel,
}: {
  label?: string;
  value: string;
  copyLabel: string;
}) {
  return (
    <div className="grid gap-3">
      {label ? <p className="text-sm font-medium text-[var(--color-ink)]">{label}</p> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <CodeBlock code={value} className="min-w-0 flex-1" />
        <CopyButton value={value} label={copyLabel} />
      </div>
    </div>
  );
}

export function ConnectPanel() {
  const url = getMcpUrl();
  const json = buildMcpJsonSnippet(url);
  const cursorHref = buildCursorInstallLink(MCP_SERVER_NAME, url);

  return (
    <Section id="connect" className="scroll-mt-20">
      <Container>
        <h2 className="text-4xl font-semibold tracking-[-0.05em] md:text-5xl">
          {copy.connect.title}
        </h2>

        <div className="mt-10 rounded-[var(--radius-lg)] border border-[color:color-mix(in_oklch,var(--color-olive)_28%,transparent)] bg-[color:color-mix(in_oklch,var(--color-olive-soft)_55%,var(--color-paper))] p-6 md:p-8">
          <div className="grid gap-8">
            <ConnectField
              label={copy.connect.urlLabel}
              value={url}
              copyLabel={copy.connect.copyUrl}
            />

            <Button asChild size="lg" className="w-full sm:w-auto">
              <a href={cursorHref}>{copy.connect.openCursor}</a>
            </Button>

            <ConnectField value={json} copyLabel={copy.connect.copyJson} />

            <div>
              <h3 className="text-lg font-semibold text-[var(--color-ink)]">
                {copy.connect.stepsTitle}
              </h3>
              <ol className="mt-4">
                {copy.connect.steps.map((step, index) => (
                  <li
                    key={step}
                    className="grid grid-cols-[3rem_1fr] gap-3 border-t border-[color:color-mix(in_oklch,var(--color-olive)_22%,transparent)] py-4 first:border-t-0 first:pt-0"
                  >
                    <span
                      dir="ltr"
                      className="font-mono text-sm font-medium text-[var(--color-accent)]"
                    >
                      0{index + 1}
                    </span>
                    <p className="leading-7 text-[var(--color-ink)]">{step}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}
