import { type ZodType } from "zod";

// Convert Zod schema to JSON Schema for MCP tool registration.
// We use a lightweight approach that walks the Zod schema definition. The
// output is pinned by test/unit/schemas/__snapshots__/tool-schemas.json, so a
// change here (or a zod upgrade) shows up as a reviewable diff.

export function zodToJsonSchema(schema: ZodType): Record<string, unknown> {
  return convertZodType(schema);
}

interface ZodDef {
  type: string;
  [key: string]: unknown;
}

function defOf(schema: ZodType): ZodDef {
  return (schema as unknown as { _zod: { def: ZodDef } })._zod.def;
}

// Scalars publish their description straight after `type`; everything else,
// including a description set on a wrapper, appends it. Key order is part of
// the pinned snapshot.
const DESCRIPTION_AFTER_TYPE = new Set(["string", "number", "boolean"]);

function convertZodType(schema: ZodType): Record<string, unknown> {
  const def = defOf(schema);
  const result = convertByType(schema, def);
  // Wrappers like .optional().describe(...) carry the description on the
  // wrapper, not the inner type - keep it, or tool callers never see it.
  // When both are set the inner description wins.
  if (!schema.description || result.description !== undefined) return result;
  if (!DESCRIPTION_AFTER_TYPE.has(def.type)) return { ...result, description: schema.description };
  const { type, ...rest } = result;
  return { type, description: schema.description, ...rest };
}

function convertByType(schema: ZodType, def: ZodDef): Record<string, unknown> {
  switch (def.type) {
    case "object":
      return convertObject(def);
    case "string":
      return convertString(schema as unknown as StringLike);
    case "number":
      return convertNumber(schema as unknown as NumberLike);
    case "boolean":
      return { type: "boolean" };
    case "enum":
      return { type: "string", enum: (schema as unknown as { options: unknown[] }).options };
    case "literal": {
      const value = (def.values as unknown[])[0];
      return { type: typeof value === "number" ? "number" : "string", const: value };
    }
    case "array":
      return { type: "array", items: convertZodType(def.element as ZodType) };
    case "optional":
    case "nullable":
      return convertZodType(def.innerType as ZodType);
    case "default":
      return { ...convertZodType(def.innerType as ZodType), default: def.defaultValue };
    case "record":
      return { type: "object", additionalProperties: true };
    case "union":
      return { anyOf: (def.options as ZodType[]).map(convertZodType) };
    case "pipe": {
      // .transform() is pipe(schema, transform); z.preprocess() is
      // pipe(transform, schema). Publish the side that describes the input.
      const input = def.in as ZodType;
      return convertZodType(defOf(input).type === "transform" ? (def.out as ZodType) : input);
    }
    default:
      return { type: "string" };
  }
}

function convertObject(def: ZodDef): Record<string, unknown> {
  const shape = def.shape as Record<string, ZodType>;

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    properties[key] = convertZodType(value);
    if (!isOptional(value)) {
      required.push(key);
    }
  }

  const result: Record<string, unknown> = {
    type: "object",
    properties,
  };

  if (required.length > 0) {
    result.required = required;
  }

  return result;
}

interface StringLike {
  minLength: number | null;
  maxLength: number | null;
  format: string | null;
}

function convertString(schema: StringLike): Record<string, unknown> {
  const result: Record<string, unknown> = { type: "string" };
  if (schema.minLength !== null) result.minLength = schema.minLength;
  if (schema.maxLength !== null) result.maxLength = schema.maxLength;
  if (schema.format === "email") result.format = "email";
  return result;
}

interface NumberLike {
  minValue: number | null;
  maxValue: number | null;
  isInt: boolean;
}

function convertNumber(schema: NumberLike): Record<string, unknown> {
  const result: Record<string, unknown> = { type: schema.isInt ? "integer" : "number" };
  // .positive() is an exclusive bound of 0; it has always been published as minimum: 0.
  // zod 4's .int() means safe integer and implies +/-MAX_SAFE_INTEGER bounds, which
  // were never published, so only explicit bounds count.
  if (isExplicitBound(schema.minValue)) result.minimum = schema.minValue;
  if (isExplicitBound(schema.maxValue)) result.maximum = schema.maxValue;
  return result;
}

function isExplicitBound(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && Math.abs(value) !== Number.MAX_SAFE_INTEGER;
}

function isOptional(schema: ZodType): boolean {
  const type = defOf(schema).type;
  return type === "optional" || type === "default";
}
