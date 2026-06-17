import { evaluateSignalMapping } from "../coreControl";
import type { SignalMappingConfig } from "../config";

describe("signal mapping", () => {
  test("derives Mini site load from eGauge utility and PCS active power", () => {
    const signalMapping: SignalMappingConfig = {
      signals: {
        utilityPowerKw: {
          expr: "Meter.Utility_Total_Power",
        },
        pcsActivePowerKw: {
          expr: "PCS.ACBusTotalActivePower",
          invertSign: true,
        },
        siteLoadKw: {
          expr: "utilityPowerKw - PCS.ACBusTotalActivePower",
        },
      },
    };

    const result = evaluateSignalMapping(signalMapping, {
      Meter: [
        {
          tagID: "Meter.Utility_Total_Power",
          value: 40,
        },
      ],
      PCS: [
        {
          tagID: "PCS.ACBusTotalActivePower",
          value: -12,
        },
      ],
    });

    expect(result.signals).toEqual({
      utilityPowerKw: 40,
      pcsActivePowerKw: 12,
      siteLoadKw: 52,
    });
    expect(result.diagnostics).toEqual([]);
  });

  test("supports deadband helper and reports expression errors", () => {
    const result = evaluateSignalMapping(
      {
        signals: {
          pvKw: {
            expr: "deadband(PV.Power, 0.3)",
          },
          siteLoadKw: {
            expr: "Meter.Missing + 1",
          },
        },
      },
      {
        "PV.Power": 0.2,
      }
    );

    expect(result.signals).toEqual({
      pvKw: 0,
    });
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        signal: "siteLoadKw",
        status: "calc-error",
      }),
    ]);
  });
});
