import fs from "fs";
import os from "os";
import path from "path";
import { loadSiteConfig, validateSiteConfig } from "../loader";
import type { SiteConfig } from "../types";

function writeTempConfig(obj: any): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keystone-config-"));
  const file = path.join(dir, "config.json");
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf8");
  return file;
}

describe("SiteConfig loader", () => {
  const baseConfig: SiteConfig = {
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
          type: "Fronius",
          model: "Primo-15",
          ratedKwAc: 15,
          ip: "10.10.10.20",
          port: 502,
          modbusProfile: "udt_fronius_ac_v1",
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
    // optional sections omitted here: pcs, mbmu, generator, islanding
  };

  it("validates a minimal valid config", () => {
    const cfg = validateSiteConfig(baseConfig);
    expect(cfg.system.systemProfile).toBe("eSpire280");
  });

  it("loads from file path and returns typed config", () => {
    const file = writeTempConfig(baseConfig);
    const cfg = loadSiteConfig({ path: file });
    expect(cfg.network.controller.modbusServer.port).toBe(502);
    expect(cfg.pv.acInverters[0].modbusProfile).toBe("udt_fronius_ac_v1");
  });

  it("throws on missing pv.acInverters", () => {
    const bad = {
      ...baseConfig,
      pv: { acInverters: [] },
    };
    const file = writeTempConfig(bad);

    expect(() => loadSiteConfig({ path: file })).toThrow(
      /pv\.acInverters must be a non-empty array/i
    );
  });

  it("throws on invalid operation.mode", () => {
    const bad: any = {
      ...baseConfig,
      operation: { ...baseConfig.operation, mode: "INVALID" },
    };
    expect(() => validateSiteConfig(bad)).toThrow(/operation\.mode/);
  });
});
