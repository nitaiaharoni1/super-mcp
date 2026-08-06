import { Container } from "@/components/shared/Container";
import { Squiggle } from "@/components/shared/doodles";
import { Reveal } from "@/components/shared/Reveal";
import { he } from "@/content/he";

/**
 * The page's peak and its dominant colour block.
 *
 * Every row is a product that both stores carry under the identical name and
 * pack size, so the delta column is a real like-for-like comparison rather than
 * one store's premium tomato against another's loose ones. The footnote says out
 * loud that this is one measured basket, not a savings promise.
 *
 * The grape band carries cream text (AA on `grape-band`), the ledger itself is
 * a cream shelf-label card, and the delta wears lime: the colour of the win,
 * here and everywhere else on the page.
 */
export function PriceLedger() {
  const { ledger } = he;
  const c = ledger.columns;

  return (
    <section
      id={ledger.id}
      className="scroll-mt-20 border-y-[3px] border-ink bg-grape-band py-[var(--space-section)] text-paper-raised"
    >
      <Container>
        <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-start lg:gap-16">
          <Reveal>
            <p className="inline-block rotate-[-1.5deg] rounded-[var(--radius-card)] border-[3px] border-ink bg-lime px-4 py-1.5 text-sm font-bold text-ink shadow-sticker-sm">
              {ledger.eyebrow}
            </p>
            <h2 className="display mt-6 max-w-[20ch] text-[length:var(--step-4)]">
              {ledger.title}
            </h2>
            <Squiggle aria-hidden className="mt-3 h-4 w-44 text-lime" />
            <p className="mt-5 max-w-[42ch] leading-[1.7]">{ledger.body}</p>

            <div className="mt-9 inline-block rotate-[-1.6deg] rounded-[var(--radius-card)] border-[3px] border-ink bg-lime px-6 py-5 text-ink shadow-sticker">
              <p className="figure ltr text-[length:var(--step-5)] leading-[0.9] font-bold">
                +{ledger.deltaHeadline}
              </p>
              <p className="mt-2 max-w-[24ch] text-sm font-semibold leading-6">
                {ledger.deltaCaption}
              </p>
            </div>
          </Reveal>

          <Reveal>
            <LedgerTable />
            <p className="mt-6 max-w-[62ch] text-xs leading-6">{ledger.footnote}</p>
          </Reveal>
        </div>
      </Container>
    </section>
  );

  function LedgerTable() {
    return (
      <div className="overflow-x-auto rounded-[var(--radius-card)] border-[3px] border-ink bg-paper-raised text-ink shadow-sticker-lg">
        <table className="w-full min-w-[19rem] border-collapse text-start">
          <caption className="sr-only">
            {`${ledger.title}. ${c.far} מול ${c.near}.`}
          </caption>
          <thead>
            <tr className="border-b-[3px] border-ink bg-paper-sunk">
              <th scope="col" className="px-4 py-3 text-start text-xs font-bold md:px-6">
                {c.item}
              </th>
              <NumericHead full={c.far} short={c.farShort} meta={c.farMeta} />
              <NumericHead full={c.near} short={c.nearShort} meta={c.nearMeta} />
              <th scope="col" className="px-3 py-3 text-right text-xs font-bold md:px-5">
                {c.delta}
              </th>
            </tr>
          </thead>
          <tbody>
            {ledger.rows.map((row) => {
              const even = row.delta === "0.00";
              return (
                <tr key={row.item} className="border-b-2 border-ink/10">
                  <th scope="row" className="px-4 py-3 text-start text-[0.8125rem] font-normal leading-5 md:px-6 md:text-sm">
                    {row.item}
                    <span className="figure ltr ms-2 text-ink-muted">{row.qty}</span>
                  </th>
                  <Cell value={row.far} />
                  <Cell value={row.near} />
                  <td
                    className={`figure ltr px-3 py-3 text-right text-[0.8125rem] md:px-5 md:text-sm ${
                      even ? "text-ink-muted" : "font-bold text-over"
                    }`}
                  >
                    {even ? "0.00" : `+${row.delta}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-[3px] border-ink bg-lime">
              <th scope="row" className="px-4 py-4 text-start text-sm font-bold md:px-6">
                {ledger.totals.label}
              </th>
              <td className="figure ltr px-3 py-4 text-right text-sm font-bold md:px-5 md:text-base">
                {ledger.totals.far}
              </td>
              <td className="figure ltr px-3 py-4 text-right text-sm font-bold md:px-5 md:text-base">
                {ledger.totals.near}
              </td>
              <td className="figure ltr px-3 py-4 text-right text-sm font-bold md:px-5 md:text-base">
                +{ledger.totals.delta.replace("₪", "")}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }
}

/*
 * Numeric columns align right physically, not logically. `text-end` resolves
 * against each element's own direction, so mixing it with `.ltr` on some cells
 * and not others walks the column edges apart.
 */
function NumericHead({ full, short, meta }: { full: string; short: string; meta: string }) {
  return (
    <th scope="col" className="px-3 py-3 text-right md:px-5">
      <span className="block text-xs font-bold">
        <span className="sm:hidden">{short}</span>
        <span className="hidden sm:inline">{full}</span>
      </span>
      {/* No `.ltr`: "2.14 ק״מ" is digits plus a Hebrew unit, and an LTR run
          would render it "ק״מ 2.14". */}
      <span className="figure mt-0.5 block text-[0.6875rem] font-normal text-ink-muted">
        {meta}
      </span>
    </th>
  );
}

function Cell({ value }: { value: string }) {
  return (
    <td className="figure ltr px-3 py-3 text-right text-[0.8125rem] md:px-5 md:text-sm">{value}</td>
  );
}
