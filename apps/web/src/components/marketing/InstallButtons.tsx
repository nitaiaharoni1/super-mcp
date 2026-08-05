"use client";

import { useEffect, useRef, useState } from "react";

import { ASSISTANT_MARKS, AssistantMarkIcon } from "@/components/shared/assistantMarks";
import { Sparkle } from "@/components/shared/doodles";
import { TrackedAnchor } from "@/components/shared/TrackedAnchor";
import { Button } from "@/components/ui/button";
import { he } from "@/content/he";
import { AnalyticsEvent, capture } from "@/lib/analytics";
import { getMcpUrl } from "@/lib/mcp";
import { buildInstallTargets, mcpRequiresApiKey, type InstallTarget } from "@/lib/mcpInstall";

/**
 * One card per assistant, each with a single action that connects it.
 *
 * Deeplink cards really are one click. Copy cards are a copy plus a paste, and
 * the card says exactly where that paste goes rather than making the reader hunt
 * for the settings screen.
 *
 * Marks and assistant names carry `dir="ltr"`: everything else on this page is
 * Hebrew, and a Latin name inside an RTL paragraph reorders without it.
 */
const CARD_TILTS = [
  "rotate-[-0.6deg]",
  "rotate-[0.5deg]",
  "rotate-[-0.4deg]",
  "rotate-[0.6deg]",
  "rotate-[-0.5deg]",
  "rotate-[0.4deg]",
];

const COPY_RESET_MS = 1_800;

export function InstallButtons() {
  const { install } = he.connect;
  const requiresKey = mcpRequiresApiKey();
  const targets = buildInstallTargets(getMcpUrl(), requiresKey);
  const seenRef = useInstallGridSeen(requiresKey);

  return (
    <div ref={seenRef}>
      <h3 className="display text-[length:var(--step-2)]">{install.title}</h3>
      <p className="mt-3 max-w-[58ch] leading-[1.7] text-ink-muted">{install.body}</p>

      <ul className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {targets.map((target, index) => (
          <li key={target.id}>
            <InstallCard
              target={target}
              tilt={CARD_TILTS[index % CARD_TILTS.length]}
              requiresKey={requiresKey}
            />
          </li>
        ))}
      </ul>

      {requiresKey ? (
        <p className="mt-5 rounded-[var(--radius-card)] border-2 border-over bg-over-soft px-4 py-3 text-sm leading-6 text-ink">
          {install.keyNote}
        </p>
      ) : null}

      <p className="mt-5 max-w-[62ch] text-sm leading-6 text-ink-muted">{install.otherTools}</p>
    </div>
  );
}

function InstallCard({
  target,
  tilt,
  requiresKey,
}: {
  target: InstallTarget;
  tilt: string;
  requiresKey: boolean;
}) {
  const { install } = he.connect;
  const copy = install.targets[target.id as keyof typeof install.targets];
  const mark = target.mark ? ASSISTANT_MARKS[target.mark] : null;

  return (
    <div
      className={`flex h-full flex-col rounded-[var(--radius-card)] border-[3px] border-ink bg-paper-raised p-5 shadow-sticker ${tilt}`}
    >
      <div className="flex items-center gap-2.5">
        {mark ? (
          <AssistantMarkIcon mark={mark} className="size-6" />
        ) : (
          <Sparkle className="size-5 text-grape-band" />
        )}
        <span
          dir={mark ? "ltr" : undefined}
          className="text-[length:var(--step-1)] font-bold text-ink"
        >
          {target.name}
        </span>
      </div>

      <p className="mt-2.5 flex-1 text-sm leading-6 text-ink-muted">{copy.hint}</p>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        {target.kind === "deeplink" ? (
          <Button asChild size="sm">
            <TrackedAnchor
              href={target.href}
              event={AnalyticsEvent.McpInstallClicked}
              eventProperties={{
                target: target.id,
                kind: target.kind,
                requires_key: requiresKey,
              }}
            >
              {copy.action}
            </TrackedAnchor>
          </Button>
        ) : (
          <CopySnippetButton target={target} label={copy.action} requiresKey={requiresKey} />
        )}

        {target.settingsHref ? (
          <TrackedAnchor
            href={target.settingsHref}
            target="_blank"
            rel="noreferrer"
            event={AnalyticsEvent.McpInstallClicked}
            eventProperties={{ target: target.id, kind: "settings", requires_key: requiresKey }}
            className="text-xs font-semibold text-ink underline decoration-2 underline-offset-4 hover:text-grape-band"
          >
            {install.settingsLabel}
          </TrackedAnchor>
        ) : null}

        <a
          href={target.docsHref}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-ink-faint underline decoration-2 underline-offset-4 hover:text-ink"
        >
          {install.docsLabel}
        </a>
      </div>

      {/* Shown for what the reader pastes elsewhere, not for a URL they already know. */}
      {target.snippet && target.kind !== "url" ? (
        <p
          dir="ltr"
          className={`mt-3 whitespace-pre-wrap break-words rounded-[6px] border-2 border-ink/15 bg-paper-sunk px-3 py-2 text-left leading-5 text-ink-muted ${
            target.kind === "command" ? "figure text-[0.6875rem]" : "text-xs leading-[1.6]"
          }`}
        >
          {target.snippet}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Fires once when the grid first reaches the viewport, so a funnel can tell "nobody
 * scrolls this far" apart from "they saw the cards and did not click". Observer is
 * disconnected on the first hit: this is a reach event, not a dwell counter.
 */
function useInstallGridSeen(requiresKey: boolean) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver !== "function") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        capture(AnalyticsEvent.McpInstallViewed, { requires_key: requiresKey });
      },
      { threshold: 0.25 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [requiresKey]);

  return ref;
}

/**
 * Same behaviour as CopyButton, but sized `sm` to sit in a card and reporting the
 * assistant it copied for. CopyButton takes no size and fires a bare event name.
 */
function CopySnippetButton({
  target,
  label,
  requiresKey,
}: {
  target: InstallTarget;
  label: string;
  requiresKey: boolean;
}) {
  const { install } = he.connect;
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const properties = { target: target.id, kind: target.kind, requires_key: requiresKey };

  useEffect(() => {
    if (state === "idle") return;
    const timeout = window.setTimeout(() => setState("idle"), COPY_RESET_MS);
    return () => window.clearTimeout(timeout);
  }, [state]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(target.snippet ?? "");
      setState("copied");
      capture(AnalyticsEvent.McpInstallClicked, properties);
    } catch {
      setState("failed");
      capture(AnalyticsEvent.McpCopyFailed, properties);
    }
  }

  const text =
    state === "copied"
      ? install.copiedLabel
      : state === "failed"
        ? install.copyFailedLabel
        : label;

  return (
    <Button type="button" variant="secondary" size="sm" onClick={handleCopy} aria-live="polite">
      {text}
    </Button>
  );
}
