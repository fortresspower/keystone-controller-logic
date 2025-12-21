import type { CompilerEnv } from "../../types";
import { buildReadPlanFromTemplateName } from "../compiler";
import { templates } from "../../templates/loader";

const env: CompilerEnv = {
  CompilerMaxQty: 120,
  CompilerMaxSpan: 80,
  CompilerMaxHole: 4,
  PollFastMs: 250,
  PollNormalMs: 1000,
  PollSlowMs: 5000,
};

describe("template-native compiler", () => {
  it("builds a read plan from eGauge template", () => {
    // adapt name to your actual key: e.g. "udt_eGauge_V1"
    const tplName = "udt_eGauge_V1";

    expect(templates[tplName]).toBeDefined();

    const instance = {
      equipmentId: "meter-main",
      serverKey: "meter-10.10.10.30",
      unitId: 1,
    };

    const plan = buildReadPlanFromTemplateName(tplName, instance, env);

    expect(plan.equipmentId).toBe("meter-main");
    expect(plan.unitId).toBe(1);
    expect(plan.blocks.length).toBeGreaterThan(0);

    const firstBlock = plan.blocks[0];
    expect(firstBlock.quantity).toBeGreaterThan(0);
    expect(firstBlock.map.length).toBeGreaterThan(0);

    // sanity check a tag mapping
    const anyTag = firstBlock.map[0];
    expect(anyTag.name).toBeDefined();
    expect(anyTag.offset).toBeGreaterThanOrEqual(0);
  });
});