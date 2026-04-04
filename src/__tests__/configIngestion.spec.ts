import * as fs from "fs";
import * as path from "path";
import type { SiteConfig } from "../config";
import {
  applyCloudConfigUpdates,
  loadSiteConfigCommandSpec,
  validateSiteConfig,
  type CloudConfigUpdate,
} from "../cloudConfig/engine";

function makeBaseConfig(): SiteConfig {
  return {
    system: {
      systemProfile: "eSpire280",
      controllerTimezone: "America/Los_Angeles",
      nominal: {
        voltageVll: 480,
        frequencyHz: 60,
      },
    },
    network: {
      controller: {
        ip: "192.168.1.10",
        modbusServer: {
          ip: "192.168.1.20",
          port: 502,
        },
      },
    },
    operation: {
      mode: "grid-tied",
      gridCode: "IEEE1547-2018",
      crdMode: "no-restriction",
      scheduledControlEnabled: false,
    },
    pcs: {
      pcsDaisyChain: [1, 1],
      maxChargeKw: 250,
      maxDischargeKw: 250,
    },
    mbmu: {
      sbmuStrings: [2, 2],
    },
    battery: {
      minSoc: 0.1,
      maxSoc: 0.9,
    },
    pv: {
      acInverters: [],
      curtailmentMethod: "modbus",
    },
    metering: {
      meterType: "eGauge-4015",
      modbusProfile: "udt_eGauge_V1",
      ip: "192.168.1.88",
      reads: {
        pv: true,
        pvFromInverter: true,
        utility: true,
        load: true,
      },
    },
    generator: {
      maxKw: 100,
      chargeFromGenerator: true,
      chargeKwLimit: 50,
      startSoc: 0.2,
      stopSoc: 0.8,
      controlType: "RemoteIO",
    },
  };
}

describe("Cloud SiteConfig ingestion", () => {
  test("loads authoritative command spec from YAML", () => {
    const spec = loadSiteConfigCommandSpec(true);

    expect(spec.commands["SITE.SystemProfile"]).toBeDefined();
    expect(spec.commands["SITE.ControllerNetwork"]).toBeDefined();
    expect(
      spec.commands["SITE.ControllerNetwork"].fields["ModbusServerPort"].dtype
    ).toBe("Number");
  });

  test("maps representative command args into SiteConfig", () => {
    const base = makeBaseConfig();
    const updates: CloudConfigUpdate[] = [
      {
        commandId: "SITE.ControllerNetwork",
        values: {
          ControllerIp: "10.20.30.40",
          ModbusServerIp: "10.20.30.50",
          ModbusServerPort: 1502,
        },
      },
    ];

    const result = applyCloudConfigUpdates(base, updates);
    expect(result.success).toBe(true);
    expect(result.nextConfig.network.controller.ip).toBe("10.20.30.40");
    expect(result.nextConfig.network.controller.modbusServer.ip).toBe(
      "10.20.30.50"
    );
    expect(result.nextConfig.network.controller.modbusServer.port).toBe(1502);
    expect(result.restartRequired).toBe(false);
  });

  test("rejects invalid enum and number range values", () => {
    const base = makeBaseConfig();
    const updates: CloudConfigUpdate[] = [
      {
        commandId: "SITE.GridCode",
        values: {
          GridCode: 99,
        },
      },
      {
        commandId: "SITE.ControllerNetwork",
        values: {
          ModbusServerPort: 99999,
        },
      },
    ];

    const result = applyCloudConfigUpdates(base, updates);
    expect(result.success).toBe(true);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          commandId: "SITE.GridCode",
          arg: "GridCode",
          status: "rejected",
        }),
        expect.objectContaining({
          commandId: "SITE.ControllerNetwork",
          arg: "ModbusServerPort",
          status: "rejected",
        }),
      ])
    );
  });

  test("classifies topology updates as restart-required", () => {
    const base = makeBaseConfig();
    const updates: CloudConfigUpdate[] = [
      {
        commandId: "SITE.PcsDaisyChain",
        values: {
          PcsDaisyChain: "[1,2,1]",
        },
      },
    ];

    const result = applyCloudConfigUpdates(base, updates);
    expect(result.success).toBe(true);
    expect(result.restartRequired).toBe(true);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          commandId: "SITE.PcsDaisyChain",
          arg: "PcsDaisyChain",
          status: "applied-restart-required",
          classification: "restart",
        }),
      ])
    );
  });

  test("end-to-end fixture updates recompute capabilities", () => {
    const fixturePath = path.resolve(
      __dirname,
      "fixtures",
      "cloudConfigUpdates.json"
    );
    const fixtureUpdates = JSON.parse(
      fs.readFileSync(fixturePath, "utf8")
    ) as CloudConfigUpdate[];

    const result = applyCloudConfigUpdates(makeBaseConfig(), fixtureUpdates);

    expect(result.success).toBe(true);
    expect(result.nextCapabilities.scheduledControlEnabled).toBe(true);
    expect(result.nextCapabilities.crdRestricted).toBe(true);
    expect(result.restartRequired).toBe(true);
  });

  test("validateSiteConfig catches structural errors", () => {
    const invalid = makeBaseConfig();
    invalid.battery.minSoc = 0.95;
    invalid.battery.maxSoc = 0.2;

    const issues = validateSiteConfig(invalid);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "battery",
        }),
      ])
    );
  });
});
