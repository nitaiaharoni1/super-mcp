import {
  resolveEmbedBackend,
  resolveEmbedModel,
  resolveOntologyVersion,
} from "@super-mcp/shared";

export function resolveBackend(explicit?: "hasher" | "transformers"): "hasher" | "transformers" {
  return resolveEmbedBackend(explicit);
}

export function resolveModel(explicit?: string): string {
  return resolveEmbedModel(explicit);
}

export function resolveOntology(explicit?: string): string {
  return resolveOntologyVersion(explicit);
}
