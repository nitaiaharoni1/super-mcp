import Image from "next/image";

import { Container } from "@/components/shared/Container";
import { Button } from "@/components/ui/button";
import { copy } from "@/content/he";

export function Hero() {
  return (
    <section id="top" className="relative isolate min-h-[100dvh] overflow-hidden">
      <Image
        src="/hero-market.webp"
        alt="דוכן פירות וירקות בשוק ישראלי"
        fill
        priority
        sizes="100vw"
        className="object-cover object-[65%_center]"
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,oklch(0.97_0.015_95_/_0.98)_0%,oklch(0.97_0.015_95_/_0.9)_35%,oklch(0.97_0.015_95_/_0.08)_72%)]" />
      <Container className="relative flex min-h-[100dvh] items-center pt-20 pb-16">
        <div className="max-w-xl">
          <p className="mb-5 text-sm font-medium text-[var(--color-olive)]">
            <span dir="ltr">{copy.brand}</span>
            <span aria-hidden="true"> · </span>
            {copy.brandSubtitle}
          </p>
          <h1 className="text-balance text-5xl font-semibold leading-[1.06] tracking-[-0.055em] text-[var(--color-ink)] sm:text-6xl md:text-7xl">
            {copy.hero.headline}
          </h1>
          <p className="mt-6 max-w-md text-lg leading-8 text-[var(--color-muted)]">
            {copy.hero.subtext}
          </p>
          <Button asChild size="lg" className="mt-9">
            <a href={copy.navConnectHref}>{copy.cta}</a>
          </Button>
        </div>
      </Container>
    </section>
  );
}
