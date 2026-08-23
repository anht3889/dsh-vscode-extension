import type { SettingsDescriptor } from "@deepseek-ai/dsh-settings";
import type { SettingsFieldWire } from "@dsh-vscode/contract";

interface SchemaNode {
  type?: unknown;
  meta?: Record<string, unknown>;
  dict?: Record<string, unknown>;
  inner?: unknown;
  list?: unknown[];
  value?: unknown;
}

interface SchemaEnvelope {
  uid: unknown;
  refs: Record<string, SchemaNode>;
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function schemaEnvelope(value: unknown): SchemaEnvelope | undefined {
  const record = recordOf(value);
  const refs = recordOf(record?.refs);
  if (record === undefined || refs === undefined || record.uid === undefined) {
    return undefined;
  }
  return { uid: record.uid, refs: refs as Record<string, SchemaNode> };
}

function schemaNode(
  envelope: SchemaEnvelope,
  reference: unknown,
): SchemaNode | undefined {
  return envelope.refs[String(reference)];
}

function profileSchemaNode(
  schema: unknown,
  path: readonly string[],
): { envelope: SchemaEnvelope; node: SchemaNode } | undefined {
  const envelope = schemaEnvelope(schema);
  if (envelope === undefined) return undefined;
  let node = schemaNode(envelope, envelope.uid);
  for (const segment of path) {
    if (node?.type === "object") {
      node = schemaNode(envelope, node.dict?.[segment]);
    } else if (node?.type === "dict") {
      node = schemaNode(envelope, node.inner);
    } else {
      return undefined;
    }
  }
  return node === undefined ? undefined : { envelope, node };
}

function unionOptions(
  envelope: SchemaEnvelope,
  node: SchemaNode,
): { value: string; label: string }[] | undefined {
  if (!Array.isArray(node.list)) return undefined;
  const values = node.list.flatMap((reference) => {
    const option = schemaNode(envelope, reference);
    return option?.type === "const" && typeof option.value === "string"
      ? [option.value]
      : [];
  });
  return values.length === node.list.length && values.length > 0
    ? values.map((value) => ({ value, label: value }))
    : undefined;
}

function projectField(
  envelope: SchemaEnvelope,
  path: readonly string[],
  field: { name: string; label: string },
  node: SchemaNode,
): SettingsFieldWire | undefined {
  const common = { path: [...path, field.name], label: field.label };
  if (node.type === "string") {
    return {
      ...common,
      kind: node.meta?.role === "credential-ref" ? "credential-ref" : "string",
    };
  }
  if (node.type === "number") {
    return {
      ...common,
      kind: "number",
      ...(typeof node.meta?.min === "number" ? { min: node.meta.min } : {}),
      ...(typeof node.meta?.max === "number" ? { max: node.meta.max } : {}),
      ...(typeof node.meta?.step === "number" ? { step: node.meta.step } : {}),
    };
  }
  if (node.type === "boolean") return { ...common, kind: "boolean" };
  if (node.type === "union") {
    const options = unionOptions(envelope, node);
    return options === undefined
      ? undefined
      : { ...common, kind: "union", options };
  }
  return undefined;
}

/** Project only explicitly declared scalar fields from one serialized schema node. */
export function projectSchemaFields(
  descriptor: SettingsDescriptor,
  path: readonly string[],
  fields: readonly { name: string; label: string }[],
): SettingsFieldWire[] {
  const located = profileSchemaNode(descriptor.schema, path);
  if (located?.node.type !== "object") return [];
  return fields.flatMap((field) => {
    const node = schemaNode(located.envelope, located.node.dict?.[field.name]);
    const projected = node === undefined
      ? undefined
      : projectField(located.envelope, path, field, node);
    return projected === undefined ? [] : [projected];
  });
}
