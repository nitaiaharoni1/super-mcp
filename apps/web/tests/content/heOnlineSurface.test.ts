import { describe, expect, it } from "vitest";
import { he } from "@/content/he";
import { buildInstallTargets } from "@/lib/mcpInstall";

describe("marketing copy matches the online-only product surface", () => {
  it("connects developers to delivery tools, not physical basket tools", () => {
    const tools = he.connect.dev.groups.flatMap((group) => group.tools);
    expect(tools).toContain("optimize_delivery");
    expect(tools).not.toContain("optimize_basket");
    expect(tools).not.toContain("list_stores");
    expect(tools).not.toContain("compare_prices");
  });

  it("labels the hero chat as delivery without claiming a live measurement", () => {
    expect(he.hero.chat.toolName).toBe("super-mcp · optimize_delivery");
    expect(he.hero.chat.planDistance).not.toMatch(/ק״מ|קמ/);
  });

  it("has an install card copy entry for every target, so no card renders blank", () => {
    const copy = he.connect.install.targets as Record<string, { action: string; hint: string }>;
    for (const target of buildInstallTargets("https://api.example.com/mcp")) {
      expect(copy[target.id]?.action, target.id).toBeTruthy();
      expect(copy[target.id]?.hint, target.id).toBeTruthy();
    }
    expect(Object.keys(copy)).toHaveLength(
      buildInstallTargets("https://api.example.com/mcp").length,
    );
  });

  /*
   * ChatGPT is the one assistant where following the card's face is not enough: the
   * add button does not exist until Developer mode is on, in a different settings
   * pane. Copy that drops the toggle sends the reader hunting for a button that is
   * not there, which is exactly what the previous wording did.
   */
  it("walks ChatGPT through the developer toggle before the pane it is added in", () => {
    const { chatgpt } = he.connect.install.targets;
    expect(chatgpt.steps[0]).toContain("Developer mode");
    expect(chatgpt.steps.join(" ")).toContain("Plugins");
    expect(chatgpt.steps.join(" ")).toContain("No authentication");
    // Renamed out of the ChatGPT settings in 2026; a card still saying it is stale.
    expect(chatgpt.steps.join(" ")).not.toContain("Apps");
    expect(chatgpt.note).toMatch(/Plus|Pro/);
    expect(he.connect.install.stepsLabel).toBeTruthy();
  });

  it("does not frame the ledger around travel to a physical branch", () => {
    expect(he.ledger.deltaCaption).not.toMatch(/ק״מ|קמ|הליכה/);
    expect(he.ledger.columns.nearMeta).not.toMatch(/ק״מ|קמ/);
    expect(he.ledger.columns.farMeta).not.toMatch(/ק״מ|קמ/);
  });
});
