import { buildOntologySnapshot } from "../src/intent/semanticMatcher.js";
import type { OntologySnapshot } from "../src/types/semanticTypes.js";

/** Minimal color/size ontology for generic semantic matcher unit tests. */
export function syntheticWidgetOntology(): OntologySnapshot {
  return buildOntologySnapshot({
    terms: [
      {
        kind: "attribute",
        attribute: "color",
        value: "red",
        term: "red",
      },
      {
        kind: "attribute",
        attribute: "color",
        value: "blue",
        term: "blue",
      },
      {
        kind: "attribute",
        attribute: "size",
        value: "large",
        term: "xl",
        impliesAttribute: "color",
        impliesValue: "red",
      },
      {
        kind: "concept",
        attribute: "shopping",
        value: "widget",
        term: "widget",
      },
    ],
    relaxations: [{ attribute: "color", fromValue: "red", toValue: "blue", label: "color:red_blue" }],
    attributes: [
      {
        attribute: "color",
        constraintStrength: "hard",
        missingValueBehavior: "allow",
        enablesNearbyAlternative: false,
        conflictPolicy: "different_value",
      },
      {
        attribute: "size",
        constraintStrength: "hard",
        missingValueBehavior: "allow",
        enablesNearbyAlternative: true,
        conflictPolicy: "different_value",
      },
    ],
  });
}

/** Non-food synthetic ontology proving policy is attribute-definition driven. */
export function syntheticMaterialOntology(): OntologySnapshot {
  return buildOntologySnapshot({
    locale: "en",
    terms: [
      {
        kind: "attribute",
        attribute: "temperature",
        value: "hot",
        term: "hot",
      },
      {
        kind: "attribute",
        attribute: "temperature",
        value: "cold",
        term: "cold",
      },
      {
        kind: "attribute",
        attribute: "material",
        value: "steel",
        term: "steel",
        impliesAttribute: "temperature",
        impliesValue: "cold",
      },
      {
        kind: "attribute",
        attribute: "material",
        value: "wood",
        term: "wood",
      },
      {
        kind: "concept",
        attribute: "shopping",
        value: "widget",
        term: "widget",
      },
      {
        kind: "attribute",
        attribute: "brand",
        value: "acme",
        term: "and",
        matchMode: "token",
        priority: 0,
      },
      {
        kind: "attribute",
        attribute: "label",
        value: "alpha_beta",
        term: "alpha beta",
        matchMode: "phrase",
        priority: 10,
      },
      {
        kind: "attribute",
        attribute: "label",
        value: "alpha",
        term: "alpha",
        matchMode: "token",
        priority: 0,
      },
      {
        kind: "attribute",
        attribute: "label",
        value: "beta",
        term: "beta",
        matchMode: "token",
        priority: 0,
      },
      {
        kind: "attribute",
        attribute: "brand",
        value: "of_tov",
        term: "עוף טוב",
        matchMode: "phrase",
        priority: 5,
      },
    ],
    relaxations: [
      {
        attribute: "temperature",
        fromValue: "hot",
        toValue: "warm",
        label: "temperature:hot_warm",
      },
    ],
    attributes: [
      {
        attribute: "temperature",
        constraintStrength: "hard",
        missingValueBehavior: "allow",
        enablesNearbyAlternative: false,
        conflictPolicy: "different_value",
      },
      {
        attribute: "material",
        constraintStrength: "hard",
        missingValueBehavior: "allow",
        enablesNearbyAlternative: true,
        conflictPolicy: "different_value",
      },
      {
        attribute: "brand",
        constraintStrength: "soft",
        missingValueBehavior: "relax",
        enablesNearbyAlternative: false,
        conflictPolicy: "different_value",
      },
      {
        attribute: "label",
        constraintStrength: "ranking",
        missingValueBehavior: "allow",
        enablesNearbyAlternative: false,
        conflictPolicy: "different_value",
      },
    ],
  });
}
