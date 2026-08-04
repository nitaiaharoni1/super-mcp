import { AccessPanel } from "@/components/marketing/AccessPanel";
import { Connect } from "@/components/marketing/Connect";
import { Coverage } from "@/components/marketing/Coverage";
import { Faq } from "@/components/marketing/Faq";
import { Hero } from "@/components/marketing/Hero";
import { Integrity } from "@/components/marketing/Integrity";
import { Marquee } from "@/components/marketing/Marquee";
import { PriceLedger } from "@/components/marketing/PriceLedger";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";

/*
 * Order is the argument:
 *   Hero      what goes in and what comes back, with real figures
 *   Marquee   the chant between the pitch and the proof (the one ticker)
 *   Ledger    the measured proof, and the page's dominant colour block
 *   Integrity why that number is trustworthy
 *   Coverage  the data behind it
 *   Connect   how to wire it up, open on the page
 *   Access    the single conversion
 */
export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <Marquee />
        <PriceLedger />
        <Integrity />
        <Coverage />
        <Connect />
        <AccessPanel />
        <Faq />
      </main>
      <SiteFooter />
    </>
  );
}
