import { ADVERTISED_ASSISTANTS, AssistantMarkIcon } from "@/components/shared/assistantMarks";

/**
 * The assistants SuperMCP works inside, shown with their own marks.
 *
 * The hero uses it to say "this works where you already are"; pass `href` and
 * each pill jumps to the section where that promise is kept (the install
 * cards). The per-assistant actions live in InstallButtons.
 *
 * Names stay next to the marks on purpose. The audience is shoppers, and the
 * Anthropic burst and the Cursor cube are not yet things a shopper recognises
 * without a label.
 */
export function AssistantRow({
  label,
  note,
  compact = false,
  href,
}: {
  label: string;
  note?: string;
  /** Hero foot: a touch smaller than the default row, but still a readable caption. */
  compact?: boolean;
  /** When set, each pill links here (e.g. "#connect"). */
  href?: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-ink-muted">
        {label}
      </p>
      <ul
        className={`mt-2.5 flex flex-wrap items-center ${compact ? "gap-x-2 gap-y-2" : "gap-x-3 gap-y-3 mt-3"}`}
      >
        {ADVERTISED_ASSISTANTS.map((a) => {
          const pill = (
            <>
              <AssistantMarkIcon mark={a} className={compact ? "size-4" : "size-[1.05rem]"} />
              <span
                dir="ltr"
                className="text-sm font-bold text-ink"
              >
                {a.name}
              </span>
            </>
          );
          const pillClass = `flex items-center border-2 border-ink bg-paper-raised ${
            compact
              ? "gap-2 rounded-[var(--radius-card)] px-3 py-1.5"
              : "gap-2 rounded-[var(--radius-card)] px-3.5 py-1.5"
          }`;

          return (
            <li key={a.name}>
              {href ? (
                <a
                  href={href}
                  className={`${pillClass} transition-colors hover:bg-lime-soft`}
                >
                  {pill}
                </a>
              ) : (
                <div className={pillClass}>{pill}</div>
              )}
            </li>
          );
        })}
      </ul>
      {note ? <p className="mt-2.5 text-xs text-ink-muted">{note}</p> : null}
    </div>
  );
}
