import { ADVERTISED_ASSISTANTS, AssistantMarkIcon } from "@/components/shared/assistantMarks";

/**
 * The assistants SuperMCP works inside, shown with their own marks.
 *
 * A caption, not an action: the hero uses it to say "this works where you already
 * are". The clickable version lives in InstallButtons.
 *
 * Names stay next to the marks on purpose. The audience is shoppers, and the
 * Anthropic burst and the Cursor cube are not yet things a shopper recognises
 * without a label.
 */
export function AssistantRow({
  label,
  note,
  compact = false,
}: {
  label: string;
  note?: string;
  /** Hero foot: smaller pills so the row reads as a caption, not a second CTA. */
  compact?: boolean;
}) {
  return (
    <div>
      <p className={`font-semibold text-ink-muted ${compact ? "text-[0.6875rem]" : "text-xs"}`}>
        {label}
      </p>
      <ul
        className={`mt-2.5 flex flex-wrap items-center ${compact ? "gap-x-2 gap-y-2" : "gap-x-3 gap-y-3 mt-3"}`}
      >
        {ADVERTISED_ASSISTANTS.map((a) => (
          <li
            key={a.name}
            className={`flex items-center border-2 border-ink bg-paper-raised ${
              compact
                ? "gap-1.5 rounded-[var(--radius-pill)] px-2.5 py-1"
                : "gap-2 rounded-[var(--radius-pill)] px-3.5 py-1.5"
            }`}
          >
            <AssistantMarkIcon mark={a} className={compact ? "size-3.5" : "size-[1.05rem]"} />
            <span
              dir="ltr"
              className={`font-bold text-ink ${compact ? "text-xs" : "text-sm"}`}
            >
              {a.name}
            </span>
          </li>
        ))}
      </ul>
      {note ? <p className="mt-2.5 text-xs text-ink-muted">{note}</p> : null}
    </div>
  );
}
