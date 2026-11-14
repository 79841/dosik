import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

/**
 * The bridge's op language, read from `docs/openapi.yaml` (#2).
 *
 * The spec is the single source of truth for what an op may contain, so the MCP tool
 * schema is derived from it rather than retyped. A hand-copied schema drifts
 * the first time an op grows a field, and the drift is silent: the tool keeps
 * advertising the old shape while the bridge rejects what it asked for.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
export const SPEC_PATH = join(HERE, "../../docs/openapi.yaml");

const OPENAPI_PREFIX = "#/components/schemas/";

/**
 * `#/components/schemas/X` is OpenAPI's spelling; JSON Schema wants
 * `#/$defs/X`.
 *
 * Every string is rewritten, not only the ones under a `$ref` key: OpenAPI
 * also points at schemas from `discriminator.mapping`, whose values are bare
 * strings, and those were left pointing at a path the emitted document does
 * not have. Hygiene rather than a break — `discriminator` is an OpenAPI
 * keyword that JSON Schema validators ignore, and every `oneOf` branch here
 * carries `op: {const: …}`, which is what actually picks the branch.
 */
const rewriteRefs = (value) => {
  if (typeof value === "string") {
    return value.startsWith(OPENAPI_PREFIX) ? value.replace(OPENAPI_PREFIX, "#/$defs/") : value;
  }
  if (Array.isArray(value)) return value.map(rewriteRefs);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, rewriteRefs(inner)]),
    );
  }
  return value;
};

export const loadSpec = (path = SPEC_PATH) => parse(readFileSync(path, "utf8"));

/** every op name the bridge accepts, in the order the spec lists them */
export const opNames = (spec) => Object.keys(spec.components.schemas.Op.discriminator.mapping);

/**
 * JSON Schema for `apply_ops`, carrying the spec's own definitions.
 *
 * `$defs` holds every schema the spec defines, not only the reachable ones —
 * pruning would be one more thing to keep in step for no gain.
 */
export const applyOpsSchema = (spec) => ({
  type: "object",
  properties: {
    ops: {
      type: "array",
      minItems: 1,
      description: `Edit operations to apply, in order. One of: ${opNames(spec).join(", ")}.`,
      items: { $ref: "#/$defs/Op" },
    },
  },
  required: ["ops"],
  $defs: rewriteRefs(spec.components.schemas),
});
