import { he } from "@/content/he";

/**
 * The ticker, the one marquee on the page. It separates the pitch (hero) from
 * the proof (ledger) the way a market chant separates the stall from the
 * price board. Every phrase is already claimed and sourced elsewhere on the
 * page; the strip adds rhythm, not information.
 *
 * The track is duplicated once and translated by half its width for a seamless
 * loop. The duplicate is hidden from assistive technology.
 */
export function Marquee() {
  const { marquee } = he;

  return (
    <div className="marquee border-y-[3px] border-ink bg-grape py-3.5" aria-hidden="true">
      <div className="marquee-track">
        {[0, 1].map((copy) => (
          <div key={copy} aria-hidden={copy === 1} className="flex items-center">
            {marquee.items.map((item) => (
              <span key={item} className="flex items-center whitespace-nowrap">
                <span className="display px-6 text-[length:var(--step-2)] text-paper-raised">
                  {item}
                </span>
                <span aria-hidden className="text-xl text-lime">
                  ✦
                </span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
