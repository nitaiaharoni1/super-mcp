import type { Pool, PoolClient } from "pg";
import {
  DEFAULT_SEMANTIC_SEARCH_CONFIG,
  parseSemanticSearchConfig,
  type OntologySnapshot,
  type OntologyTerm,
  type OntologyRelaxation,
  type SemanticAttributeDefinition,
  type SemanticMatchMode,
} from "@super-mcp/shared";
import { resolveOntology } from "./config.js";

export async function loadOntologySnapshot(
  client: Pool | PoolClient,
  version?: string,
): Promise<OntologySnapshot> {
  const ontologyVersion = resolveOntology(version);
  const ver = await client.query<{ id: string; locale: string }>(
    `SELECT id, locale FROM semantic_ontology_version
     WHERE id = $1 OR ($1 IS NULL AND active = true)
     ORDER BY active DESC, id
     LIMIT 1`,
    [ontologyVersion],
  );
  const row = ver.rows[0];
  if (!row) {
    throw new Error(`No semantic ontology version found (wanted ${ontologyVersion})`);
  }

  const termsRes = await client.query<{
    kind: OntologyTerm["kind"];
    attribute: string | null;
    value: string | null;
    term: string;
    implies_attribute: string | null;
    implies_value: string | null;
    weight: string | number;
    match_mode: SemanticMatchMode | null;
    priority: string | number | null;
  }>(
    `SELECT kind, attribute, value, term, implies_attribute, implies_value, weight,
            COALESCE(match_mode, 'token') AS match_mode,
            COALESCE(priority, 0) AS priority
     FROM semantic_term WHERE ontology_version = $1`,
    [row.id],
  );

  const relaxRes = await client.query<{
    attribute: string;
    from_value: string;
    to_value: string;
    label: string | null;
  }>(
    `SELECT attribute, from_value, to_value, label
     FROM semantic_relaxation WHERE ontology_version = $1`,
    [row.id],
  );

  const attrRes = await client.query<{
    attribute: string;
    constraint_strength: SemanticAttributeDefinition["constraintStrength"];
    missing_value_behavior: SemanticAttributeDefinition["missingValueBehavior"];
    enables_nearby_alternative: boolean;
    conflict_policy: SemanticAttributeDefinition["conflictPolicy"];
  }>(
    `SELECT attribute, constraint_strength, missing_value_behavior,
            enables_nearby_alternative, conflict_policy
     FROM semantic_attribute_definition WHERE ontology_version = $1`,
    [row.id],
  );

  const configRes = await client.query<{ config: unknown }>(
    `SELECT config FROM semantic_search_config WHERE ontology_version = $1`,
    [row.id],
  );

  const terms: OntologyTerm[] = termsRes.rows.map((t) => ({
    kind: t.kind,
    attribute: t.attribute,
    value: t.value,
    term: t.term,
    impliesAttribute: t.implies_attribute,
    impliesValue: t.implies_value,
    weight: Number(t.weight),
    matchMode: t.match_mode ?? "token",
    priority: Number(t.priority ?? 0),
  }));

  const relaxations: OntologyRelaxation[] = relaxRes.rows.map((r) => ({
    attribute: r.attribute,
    fromValue: r.from_value,
    toValue: r.to_value,
    label: r.label,
  }));

  const attributes: SemanticAttributeDefinition[] = attrRes.rows.map((a) => ({
    attribute: a.attribute,
    constraintStrength: a.constraint_strength,
    missingValueBehavior: a.missing_value_behavior,
    enablesNearbyAlternative: a.enables_nearby_alternative,
    conflictPolicy: a.conflict_policy,
  }));

  const searchConfig = configRes.rows[0]?.config
    ? parseSemanticSearchConfig(configRes.rows[0].config)
    : { ...DEFAULT_SEMANTIC_SEARCH_CONFIG };

  return {
    version: row.id,
    locale: row.locale,
    terms,
    relaxations,
    attributes,
    searchConfig,
  };
}
