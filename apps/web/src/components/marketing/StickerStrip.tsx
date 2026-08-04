import Image from "next/image";

import { he } from "@/content/he";

/**
 * A full-bleed breath of brand photography between the ledger (proof) and
 * integrity (trust). No copy over the image: the stickers in the photo are the
 * argument, the section below does the explaining.
 */
export function StickerStrip() {
  return (
    <div className="relative aspect-[16/6] w-full overflow-hidden border-y-[3px] border-ink bg-paper-sunk md:aspect-[21/5]">
      <Image
        src="/price-stickers.webp"
        alt={he.visuals.stickersAlt}
        fill
        sizes="100vw"
        className="object-cover object-[50%_40%]"
      />
    </div>
  );
}
