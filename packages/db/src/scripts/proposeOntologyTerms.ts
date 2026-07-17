/**
 * Offline growth loop: read top misses + current ontology, ask Claude to
 * propose new semantic terms / promo patterns. Writes a reviewable JSON
 * proposals file; NEVER writes to the database. Requires ANTHROPIC_API_KEY
 * (or an `ant auth login` profile).
 * Usage: tsx src/scripts/proposeOntologyTerms.ts [outfile]
 */
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { closePool, getPool } from "../client/index.js";
import { topMisses, type MissKind } from "../queries/misses.js";

const KINDS: MissKind[] = ["promo_other", "unit_unparseable", "region_unmatched", "ontology_no_hit"];

const PROPOSALS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["proposals"],
  properties: {
    proposals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["missKind", "missTerm", "action", "rationale"],
        properties: {
          missKind: { type: "string" },
          missTerm: { type: "string" },
          action: {
            type: "string",
            enum: [
              "add_semantic_term",
              "add_unit_alias",
              "add_city_alias",
              "add_promo_pattern",
              "ignore",
            ],
          },
          termKind: { type: "string", enum: ["attribute", "concept", "penalty", "alias", "stopword", ""] },
          attribute: { type: "string" },
          value: { type: "string" },
          term: { type: "string" },
          matchMode: { type: "string", enum: ["token", "phrase", "exact", "alias", ""] },
          rationale: { type: "string" },
        },
      },
    },
  },
} as const;

async function main(): Promise<void> {
  const outfile = process.argv[2] ?? "proposals/ontology-proposals.json";

  const misses: Record<string, unknown> = {};
  for (const kind of KINDS) misses[kind] = await topMisses(kind, 40);

  const ontology = await getPool().query(
    `SELECT kind, attribute, value, term, match_mode
     FROM semantic_term WHERE ontology_version = 'he-retail-v1'
     ORDER BY kind, attribute, value`,
  );

  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system:
      "You maintain the Hebrew retail ontology of an Israeli grocery price-comparison service. " +
      "You receive (a) the current ontology terms and (b) 'misses': real inputs the system could not classify. " +
      "Propose additions ONLY where the miss data clearly supports them. Prefer 'ignore' for noise, typos, " +
      "and one-off garbage. Never propose terms that could cause unsafe substitutions (e.g. do not map " +
      "a liquor brand to a produce concept). Output strictly matches the JSON schema.",
    messages: [
      {
        role: "user",
        content:
          `Current ontology terms (he-retail-v1):\n${JSON.stringify(ontology.rows)}\n\n` +
          `Misses by kind:\n${JSON.stringify(misses)}\n\n` +
          "Propose ontology/unit/city/promo additions for the recurring, high-count misses.",
      },
    ],
    output_config: { format: { type: "json_schema", schema: PROPOSALS_SCHEMA } },
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error(`no text block; stop_reason=${response.stop_reason}`);
  }
  const dir = path.dirname(outfile);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outfile, JSON.stringify(JSON.parse(textBlock.text), null, 2));
  console.log(`wrote ${outfile}; review and encode accepted proposals as a new migration`);
}

main()
  .then(async () => closePool().catch(() => undefined))
  .catch(async (err) => {
    console.error(err);
    await closePool().catch(() => undefined);
    process.exit(1);
  });
