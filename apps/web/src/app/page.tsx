import { AccessPanel } from "@/components/marketing/AccessPanel";
import { BenefitTrio } from "@/components/marketing/BenefitTrio";
import { DeveloperSurface } from "@/components/marketing/DeveloperSurface";
import { Hero } from "@/components/marketing/Hero";
import { HowItWorks } from "@/components/marketing/HowItWorks";
import { SafetyStatement } from "@/components/marketing/SafetyStatement";
import { SimpleProof } from "@/components/marketing/SimpleProof";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import { TrustFooter } from "@/components/marketing/TrustFooter";

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <BenefitTrio />
        <HowItWorks />
        <SimpleProof />
        <SafetyStatement />
        <AccessPanel />
        <DeveloperSurface />
        <TrustFooter />
      </main>
      <SiteFooter />
    </>
  );
}
