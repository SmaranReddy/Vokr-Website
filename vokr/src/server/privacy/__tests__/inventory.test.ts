import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { LOCATION_MODELS, PERSONAL_DATA_FIELD_PATTERN, PERSONAL_DATA_INVENTORY } from "../inventory";

/**
 * Plan §5 Phase 17 Testing Requirements: "a test enumerates the inventory
 * and asserts coverage, so adding a PII field without adding it to export
 * fails". Reads the schema itself, so a new column cannot be missed.
 */

function schemaFields(): string[] {
  const schema = readFileSync(path.resolve(import.meta.dirname, "../../../../prisma/schema.prisma"), "utf8");
  const fields: string[] = [];
  let model: string | null = null;
  for (const line of schema.split(/\r?\n/)) {
    const open = /^model\s+(\w+)\s*\{/.exec(line);
    if (open) {
      model = open[1] ?? null;
      continue;
    }
    if (/^\}/.test(line)) {
      model = null;
      continue;
    }
    const field = /^\s+(\w+)\s+[A-Z]\w*[?[\]]*\s*(?:@|$)/.exec(line);
    if (model && field?.[1]) fields.push(`${model}.${field[1]}`);
  }
  return fields;
}

describe("personal-data inventory", () => {
  const fields = schemaFields();
  const listed = new Set(PERSONAL_DATA_INVENTORY.map((entry) => entry.field));

  it("parses the schema", () => {
    expect(fields).toContain("Order.shipNameEnc");
    expect(fields.length).toBeGreaterThan(100);
  });

  it("lists every personal-data column in the schema", () => {
    const personal = fields.filter((qualified) => {
      const [model, field] = qualified.split(".") as [string, string];
      return PERSONAL_DATA_FIELD_PATTERN.test(field) || (LOCATION_MODELS.has(model) && /^(?:city|state|pincode)$/.test(field));
    });
    expect(personal.length).toBeGreaterThan(15);
    expect(personal.filter((qualified) => !listed.has(qualified))).toEqual([]);
  });

  it("lists nothing that is not in the schema", () => {
    expect([...listed].filter((qualified) => !fields.includes(qualified))).toEqual([]);
  });

  it("explains every exclusion from the export", () => {
    for (const entry of PERSONAL_DATA_INVENTORY) {
      if (entry.exported !== true) expect(entry.exported.length).toBeGreaterThan(20);
    }
  });
});
