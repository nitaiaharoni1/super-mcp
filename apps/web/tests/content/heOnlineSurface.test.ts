import { describe, expect, it } from "vitest";
import { he } from "@/content/he";

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

  it("does not frame the ledger around travel to a physical branch", () => {
    expect(he.ledger.deltaCaption).not.toMatch(/ק״מ|קמ|הליכה/);
    expect(he.ledger.columns.nearMeta).not.toMatch(/ק״מ|קמ/);
    expect(he.ledger.columns.farMeta).not.toMatch(/ק״מ|קמ/);
  });
});
