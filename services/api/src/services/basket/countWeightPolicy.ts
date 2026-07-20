import type { CanonicalUnit } from "@super-mcp/shared";

export interface CountWeightClassInput {
  classL1?: string | null;
  classL2?: string | null;
  productClass?: string | null;
}

export interface CountWeightPolicyInput extends CountWeightClassInput {
  /**
   * When true, wine only allows count↔weight for unit/null requests (intent path).
   * When false/omitted, wine always allows (equivalence peer matching).
   */
  constrainWineByRequestUnit?: boolean;
  requestedCanonUnit?: CanonicalUnit | null;
}

/**
 * Classes where a count request / unit primary may match a weighted shelf SKU:
 * produce (₪/kg), pita multipacks labeled as grams, and wine bottles (יח ↔ ml).
 */
export function allowsCountToWeight(input: CountWeightPolicyInput): boolean {
  const l1 = input.classL1 ?? input.productClass;
  if (l1 === "produce" || input.classL2 === "pita_flatbread") return true;
  if (input.classL2 === "wine") {
    if (input.constrainWineByRequestUnit) {
      return input.requestedCanonUnit === "unit" || input.requestedCanonUnit == null;
    }
    return true;
  }
  return false;
}
