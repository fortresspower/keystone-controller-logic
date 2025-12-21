import type { CompilerEnv } from "../../types";
import type { SiteConfig } from "../../config/types";
import { buildReadPlansFromConfig } from "../buildReadPlansFromConfig";

const env: CompilerEnv = {
  CompilerMaxQty: 120,
  CompilerMaxSpan: 80,
  CompilerMaxHole: 4,
  PollFastMs: 250,
  PollNormalMs: 1000,
  PollSlowMs: 5000,
};

describe("buildReadPlansFromConfig", () => {
  const cfg: SiteConfig = {
    system: {
      systemProfile: "eSpire280",
      controllerTimezone: "America/Los_Angeles",
      nominal: { voltageVll: 480, frequencyHz: 60 },
    },
    network: {
      controller: {
        ip: "10.10.10.10",
        modbusServer: { ip: "10.10.10.10", port: 502 },
      },
    },
    operation: {
      mode: "grid-tied",
      gridCode: "IEEE1547-2018",
      crdMode: "no-restriction",
      scheduledControlEnabled: true,
    },
    battery: {
      minSoc: 0.1,
      maxSoc: 0.9,
    },
    pv: {
      acInverters: [
        {
          type: "solarEdge",
          model: "SE10K",
          ratedKwAc: 10,
          ip: "10.10.10.20",
          port: 502,
          modbusProfile: "udt_solarEdge_V1",
        },
      ],
      curtailmentMethod: "modbus",
    },
    metering: {
      meterType: "eGauge-4015",
      modbusProfile: "udt_eGauge_V1",
      ip: "10.10.10.30",
      reads: {
        pv: true,
        pvFromInverter: false,
        utility: true,
        load: true,
      },
    },
  };

  it("builds meter and PV read plans from config", () => {
    const plans = buildReadPlansFromConfig(cfg, env);

    expect(plans.meter).toBeDefined();
    expect(plans.meter!.readPlan.blocks.length).toBeGreaterThan(0);

    expect(plans.pvInverters.length).toBe(1);
    const inv = plans.pvInverters[0];
    expect(inv.id).toMatch(/^pv-1-/);
    expect(inv.readPlan.blocks.length).toBeGreaterThan(0);
  });
});