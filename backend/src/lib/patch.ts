import { z } from "zod";

export function parsePatch(schema: z.ZodObject<any>, raw: unknown) {
  const parsed = schema.partial().parse(raw);
  // Zod 4 applies defaults inside optional fields. PATCH must change only
  // explicitly supplied keys, never creation defaults on omitted fields.
  return Object.fromEntries(
    Object.entries(parsed).filter(([key]) =>
      Object.prototype.hasOwnProperty.call(raw, key),
    ),
  );
}
