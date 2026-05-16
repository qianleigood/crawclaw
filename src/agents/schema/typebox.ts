import { Type } from "@sinclair/typebox";

export function stringEnum<const T extends readonly [string, ...string[]]>(
  values: T,
  options?: Parameters<typeof Type.Union>[1],
) {
  return Type.Union(
    values.map((value) => Type.Literal(value)),
    options,
  );
}
