import { Container } from "@/components/shared/Container";
import { Reveal } from "@/components/shared/Reveal";
import { he } from "@/content/he";

/**
 * The page's peak and its only colour block.
 *
 * Every row is a product that both stores carry under the identical name and
 * pack size, so the delta column is a real like-for-like comparison rather than
 * one store's premium tomato against another's loose ones. The footnote says out
 * loud that this is one measured basket, not a savings promise.
 */
export function PriceLedger() {
  const { ledger } = he;
  const c = ledger.columns;

  return (
    <section
      id={ledger.id}
      className="scroll-mt-20 bg-[var(--color-band)] py-[var(--space-section)] text-[var(--color-band-ink)]"
    >
      <Container>
        <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-start lg:gap-16">
          <Reveal>
            <p className="text-sm font-semibold text-[var(--color-band-muted)]">{ledger.eyebrow}</p>
            <h2 className="display mt-4 max-w-[20ch] text-[length:var(--step-4)]">
              {ledger.title}
            </h2>
            <p className="mt-5 max-w-[42ch] leading-[1.7] text-[var(--color-band-muted)]">
              {ledger.body}
            </p>

            <div className="mt-9 flex items-baseline gap-4 border-t border-[var(--color-band-line)] pt-7">
              <p className="figure ltr text-[length:var(--step-5)] leading-[0.9] text-[var(--color-over-band)]">
                +{ledger.deltaHeadline}
              </p>
              <p className="max-w-[18ch] text-sm leading-6 text-[var(--color-band-muted)]">
                {ledger.deltaCaption}
              </p>
            </div>
          </Reveal>

          <Reveal>
            <LedgerTable />
            <p className="mt-6 max-w-[62ch] text-xs leading-6 text-[var(--color-band-muted)]">
              {ledger.footnote}
            </p>
          </Reveal>
        </div>
      </Container>
    </section>
  );

  function LedgerTable() {
    return (
      <div className="overflow-x-auto rounded-[var(--radius-lg)] bg-[var(--color-band-raised)]">
        <table className="w-full min-w-[19rem] border-collapse text-start">
          <caption className="sr-only">
            {`${ledger.title}. ${c.far} מול ${c.near}.`}
          </caption>
          <thead>
            <tr className="border-b border-[var(--color-band-line)]">
              <th scope="col" className="px-4 py-3 text-start text-xs font-medium text-[var(--color-band-muted)] md:px-6">
                {c.item}
              </th>
              <NumericHead full={c.far} short={c.farShort} meta={c.farMeta} />
              <NumericHead full={c.near} short={c.nearShort} meta={c.nearMeta} />
              <th scope="col" className="px-3 py-3 text-right text-xs font-medium text-[var(--color-band-muted)] md:px-5">
                {c.delta}
              </th>
            </tr>
          </thead>
          <tbody>
            {ledger.rows.map((row) => {
              const even = row.delta === "0.00";
              return (
                <tr key={row.item} className="border-b border-[var(--color-band-line)]/60">
                  <th scope="row" className="px-4 py-3 text-start text-[0.8125rem] font-normal leading-5 md:px-6 md:text-sm">
                    {row.item}
                    <span className="figure ltr ms-2 text-[var(--color-band-muted)]">{row.qty}</span>
                  </th>
                  <Cell value={row.far} />
                  <Cell value={row.near} />
                  <td
                    className={`figure ltr px-3 py-3 text-right text-[0.8125rem] md:px-5 md:text-sm ${
                      even ? "text-[var(--color-band-muted)]" : "text-[var(--color-over-band)]"
                    }`}
                  >
                    {even ? "0.00" : `+${row.delta}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[var(--color-band-line)]">
              <th scope="row" className="px-4 py-4 text-start text-sm font-semibold md:px-6">
                {ledger.totals.label}
              </th>
              <td className="figure ltr px-3 py-4 text-right text-sm font-semibold md:px-5 md:text-base">
                {ledger.totals.far}
              </td>
              <td className="figure ltr px-3 py-4 text-right text-sm font-semibold md:px-5 md:text-base">
                {ledger.totals.near}
              </td>
              <td className="figure ltr px-3 py-4 text-right text-sm font-semibold text-[var(--color-over-band)] md:px-5 md:text-base">
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
      <span className="block text-xs font-semibold">
        <span className="sm:hidden">{short}</span>
        <span className="hidden sm:inline">{full}</span>
      </span>
      {/* No `.ltr`: "2.14 ק״מ" is digits plus a Hebrew unit, and an LTR run
          would render it "ק״מ 2.14". */}
      <span className="figure mt-0.5 block text-[0.6875rem] font-normal text-[var(--color-band-muted)]">
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
