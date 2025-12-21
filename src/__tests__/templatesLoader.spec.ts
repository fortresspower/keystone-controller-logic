// src/__tests__/templatesLoader.spec.ts

import { templates } from "../templates/loader";

describe("templates loader", () => {
  it("loads udt_eGauge_V1 without blowing up", () => {
    const tpl = templates.udt_eGauge_V1;
    expect(tpl).toBeDefined();

    // Basic shape checks
    expect(typeof tpl.name).toBe("string");
    expect(Array.isArray(tpl.tags)).toBe(true);
    expect(tpl.tags.length).toBeGreaterThan(0);
  });

  it("normalizes tags to have name/modbusType/modbusAddress", () => {
    const tpl = templates.udt_eGauge_V1;

    for (const tag of tpl.tags) {
      expect(typeof tag.name).toBe("string");
      expect(typeof tag.modbusType).toBe("string");
      expect(typeof tag.modbusAddress).toBe("number");

      // mask, alarm, etc. should never crash even if missing
      if (tag.mask !== undefined) {
        expect(typeof tag.mask).toBe("number");
      }
    }
  });

  it("applies a default endian when none is present", () => {
    const tpl = templates.udt_eGauge_V1;
    // You can tighten this later once you set real defaultEndian in the JSON
    expect(["BE", "LE", "CDAB", "DCBA"]).toContain(tpl.defaultEndian);
  });
});