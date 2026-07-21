import { AgentJobs } from "@/components/marketing/AgentJobs";
import { BasketStory } from "@/components/marketing/BasketStory";
import { ConnectPanel } from "@/components/marketing/ConnectPanel";
import { Hero } from "@/components/marketing/Hero";
import { ProofStrip } from "@/components/marketing/ProofStrip";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import { ToolsGlance } from "@/components/marketing/ToolsGlance";

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <ProofStrip />
        <AgentJobs />
        <BasketStory />
        <ConnectPanel />
        <ToolsGlance />
      </main>
      <SiteFooter />
    </>
  );
}
