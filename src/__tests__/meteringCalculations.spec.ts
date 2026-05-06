import {
  evaluateMeteringCalculations,
  type MeteringTelemetryInput,
} from "../coreControl";
import type { MeteringCalculationConfig } from "../config";

describe("site metering calculations", () => {
  test("computes utility, load, and PV readings from direct tags and expressions", () => {
    const calculations: MeteringCalculationConfig = {
      utilityPowerKw: {
        source: "tag",
        tagID: "Meter.POI_kW",
      },
      siteLoadKw: {
        source: "calc",
        inputs: {
          utility: "Meter.POI_kW",
          pcs: "PCS.SYSTEM_POWER_ACTIVE_ALL",
          pv: "Meter.PV_kW",
        },
        expr: "utility + pcs + pv",
      },
      pvKw: {
        source: "calc",
        inputs: {
          inv1: "Chint1.PAC",
          inv2: "Chint2.PAC",
        },
        expr: "inv1 + inv2",
      },
    };

    const result = evaluateMeteringCalculations(calculations, {
      "Meter.POI_kW": 35,
      "PCS.SYSTEM_POWER_ACTIVE_ALL": -10,
      "Meter.PV_kW": 42,
      "Chint1.PAC": 20,
      "Chint2.PAC": 22,
    });

    expect(result.readings).toEqual({
      utilityPowerKw: 35,
      siteLoadKw: 67,
      pvKw: 42,
    });
    expect(result.diagnostics).toEqual([]);
  });

  test("accepts grouped telemetry arrays from global telemetry shape", () => {
    const calculations: MeteringCalculationConfig = {
      utilityPowerKw: {
        source: "tag",
        tagID: "Meter2.Grid",
      },
      siteLoadKw: {
        source: "tag",
        tagID: "Meter.Load_Active_Power",
      },
      pvKw: {
        source: "calc",
        inputs: {
          chint1: "Chint1.PAC",
          chint2: "Chint2.PAC",
        },
        expr: "chint1 + chint2",
      },
    };
    const telemetry: MeteringTelemetryInput = {
      Meter: [
        { tagID: "Meter.Load_Active_Power", value: 88 },
        { tagID: "Meter2.Grid", value: -5 },
      ],
      Chint: [
        { tagID: "Chint1.PAC", value: 30 },
        { tagID: "Chint2.PAC", value: 31 },
      ],
    };

    const result = evaluateMeteringCalculations(calculations, telemetry);

    expect(result.readings).toEqual({
      utilityPowerKw: -5,
      siteLoadKw: 88,
      pvKw: 61,
    });
    expect(result.diagnostics).toEqual([]);
  });

  test("reports missing config and missing or nonnumeric inputs", () => {
    const result = evaluateMeteringCalculations(
      {
        utilityPowerKw: {
          source: "tag",
          tagID: "Meter.POI_kW",
        },
        siteLoadKw: {
          source: "calc",
          inputs: {
            load: "Meter.Load_kW",
          },
          expr: "load",
        },
      },
      {
        "Meter.POI_kW": "not-a-number",
      }
    );

    expect(result.readings).toEqual({});
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reading: "utilityPowerKw",
          status: "invalid-value",
          tagID: "Meter.POI_kW",
        }),
        expect.objectContaining({
          reading: "siteLoadKw",
          status: "missing-input",
          tagID: "Meter.Load_kW",
        }),
        expect.objectContaining({
          reading: "pvKw",
          status: "missing-config",
        }),
      ])
    );
  });
});
