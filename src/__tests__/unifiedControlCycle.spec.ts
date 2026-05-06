import type { SiteConfig } from "../config";
import { runUnifiedControlCycle } from "../coreControl";

function makeConfig(): SiteConfig {
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
      crdMode: "no-export",
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
      acInverters: [
        {
          type: "Chint",
          model: "CPS-60",
          ratedKwAc: 60,
          ip: "192.168.1.201",
          port: 502,
          modbusProfile: "chint_cps_v1",
        },
      ],
      curtailmentMethod: "modbus",
    },
    metering: {
      meterType: "eGauge-4015",
      modbusProfile: "udt_eGauge_V1",
      ip: "192.168.1.88",
      reads: {
        pv: false,
        pvFromInverter: true,
        utility: true,
        load: true,
      },
      calculations: {
        utilityPowerKw: {
          source: "tag",
          tagID: "Meter.POI_kW",
        },
        siteLoadKw: {
          source: "calc",
          inputs: {
            utility: "Meter.POI_kW",
            pcs: "PCS.SYSTEM_POWER_ACTIVE_ALL",
            pv: "Chint1.PAC",
          },
          expr: "utility + pcs + pv",
        },
        pvKw: {
          source: "tag",
          tagID: "Chint1.PAC",
        },
      },
    },
  };
}

describe("unified control cycle", () => {
  test("uses site metering calculations before core dispatch and writer output", () => {
    const result = runUnifiedControlCycle(makeConfig(), {
      telemetry: {
        "Meter.POI_kW": -18,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 0,
        "Chint1.PAC": 42,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        realtimeActivePowerKwRequest: 0,
      },
    });

    expect(result.telemetry).toEqual(
      expect.objectContaining({
        utilityPowerKw: -18,
        siteLoadKw: 24,
        pvKw: 42,
      })
    );
    expect(result.command.pcsActivePowerKw).toBe(-18);
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["realtime-active-setpoint", "crd-no-export"])
    );
    expect(result.routePlan.productPath).toBe("eSpire280");
    expect(result.routePlan.activeRouteIds).toEqual(
      expect.arrayContaining([
        "product-280",
        "metering",
        "crd",
        "pcs-dispatch",
        "pv-curtailment",
        "writer-pcs",
      ])
    );
    expect(result.pipeline.blocked).toBe(false);
    expect(result.pipeline.activeStageIds).toEqual(
      expect.arrayContaining([
        "product-routing",
        "metering",
        "dispatch-source",
        "crd",
        "writer",
      ])
    );
    expect(result.pipeline.warnings).toEqual([]);
    expect(result.writerEnvelopes).toEqual([
      {
        topic: "PCS",
        payload: [
          {
            tagID: "SYSTEM_ACTIVE_POWER_DEMAND",
            value: -18,
          },
        ],
      },
    ]);
    expect(result.diagnostics.metering).toEqual([]);
  });

  test("keeps metering diagnostics with the cycle result", () => {
    const config = makeConfig();
    delete config.metering.calculations!.pvKw;

    const result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": 12,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 2,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        realtimeActivePowerKwRequest: 5,
      },
    });

    expect(result.command.pcsActivePowerKw).toBe(5);
    expect(result.pipeline.blocked).toBe(false);
    expect(result.pipeline.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "metering",
          status: "warning",
          reasons: expect.arrayContaining([
            "siteLoadKw: missing-input",
            "pvKw: missing-config",
            "pvKw is required but unavailable",
          ]),
        }),
      ])
    );
    expect(result.pipeline.warnings).toEqual(
      expect.arrayContaining(["pvKw is required but unavailable"])
    );
    expect(result.diagnostics.metering).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reading: "siteLoadKw",
          status: "missing-input",
          tagID: "Chint1.PAC",
        }),
        expect.objectContaining({
          reading: "pvKw",
          status: "missing-config",
        }),
      ])
    );
  });

  test("blocks to safe zero when CRD utility feedback is required but unavailable", () => {
    const config = makeConfig();
    delete config.metering.calculations!.utilityPowerKw;

    const result = runUnifiedControlCycle(config, {
      telemetry: {
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 2,
        "Chint1.PAC": 20,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        realtimeActivePowerKwRequest: 50,
      },
    });

    expect(result.command).toEqual(
      expect.objectContaining({
        controlMode: "idle",
        pcsActivePowerKw: 0,
        reasons: expect.arrayContaining([
          "safe-zero",
          "crd-missing-utility-power",
        ]),
      })
    );
    expect(result.pipeline.blocked).toBe(true);
    expect(result.pipeline.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "safety-gates",
          status: "blocked",
          reasons: expect.arrayContaining(["crd-missing-utility-power"]),
        }),
      ])
    );
  });

  test("marks availability blocks when charge or discharge is explicitly disabled", () => {
    const result = runUnifiedControlCycle(makeConfig(), {
      telemetry: {
        "Meter.POI_kW": 0,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 0,
        "Chint1.PAC": 0,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        allowDischarge: false,
        realtimeActivePowerKwRequest: 25,
      },
    });

    expect(result.command.pcsActivePowerKw).toBe(0);
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["discharge-disabled"])
    );
    expect(result.pipeline.blocked).toBe(true);
    expect(result.pipeline.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "availability",
          status: "blocked",
          reasons: ["discharge-disabled"],
        }),
      ])
    );
  });

  test("eSpire280 machine faults hard-gate to safe zero", () => {
    const result = runUnifiedControlCycle(makeConfig(), {
      telemetry: {
        "Meter.POI_kW": 0,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 0,
        "Chint1.PAC": 0,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        realtimeActivePowerKwRequest: 25,
        machineStatus: {
          bmsStatus: 2,
          pcsGlobalState: 7,
          epoActive: true,
          contactorsClosed: false,
        },
      },
    });

    expect(result.command).toEqual(
      expect.objectContaining({
        controlMode: "idle",
        pcsActivePowerKw: 0,
        reasons: expect.arrayContaining([
          "safe-zero",
          "e280-bms-not-normal",
          "e280-pcs-faulted",
          "e280-epo-active",
          "e280-contactors-open",
        ]),
      })
    );
    expect(result.pipeline.blocked).toBe(true);
    expect(result.pipeline.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "safety-gates",
          status: "blocked",
          reasons: expect.arrayContaining([
            "e280-bms-not-normal",
            "e280-pcs-faulted",
            "e280-epo-active",
            "e280-contactors-open",
          ]),
        }),
      ])
    );
  });

  test("eSpire280 cell-voltage gates block unsafe charge and discharge", () => {
    let result = runUnifiedControlCycle(makeConfig(), {
      telemetry: {
        "Meter.POI_kW": 0,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 0,
        "Chint1.PAC": 0,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        realtimeActivePowerKwRequest: -25,
        machineStatus: {
          bmsStatus: 1,
          maxCellVoltageV: 3.61,
          minCellVoltageV: 3.2,
        },
      },
    });

    expect(result.command.pcsActivePowerKw).toBe(0);
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["e280-cell-high-charge-block"])
    );
    expect(result.pipeline.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "availability",
          status: "blocked",
          reasons: ["e280-cell-high-charge-block"],
        }),
      ])
    );

    result = runUnifiedControlCycle(makeConfig(), {
      telemetry: {
        "Meter.POI_kW": 0,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 0,
        "Chint1.PAC": 0,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        realtimeActivePowerKwRequest: 25,
        machineStatus: {
          bmsStatus: 1,
          maxCellVoltageV: 3.4,
          minCellVoltageV: 2.89,
        },
      },
    });

    expect(result.command.pcsActivePowerKw).toBe(0);
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["e280-cell-low-discharge-block"])
    );
  });

  test("eSpire280 voltage-current caps limit charge and discharge commands", () => {
    let result = runUnifiedControlCycle(makeConfig(), {
      telemetry: {
        "Meter.POI_kW": 0,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 0,
        "Chint1.PAC": 0,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        realtimeActivePowerKwRequest: -80,
        machineStatus: {
          bmsStatus: 1,
          batteryVoltageV: 800,
          maxChargeCurrentAllowedA: -50,
          maxDischargeCurrentAllowedA: 100,
          maxCellVoltageV: 3.3,
          minCellVoltageV: 3.1,
        },
      },
    });

    expect(result.command.pcsActivePowerKw).toBe(-38);
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["e280-charge-current-limit"])
    );
    expect(result.pipeline.blocked).toBe(false);

    result = runUnifiedControlCycle(makeConfig(), {
      telemetry: {
        "Meter.POI_kW": 0,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 0,
        "Chint1.PAC": 0,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        realtimeActivePowerKwRequest: 120,
        machineStatus: {
          bmsStatus: 1,
          batteryVoltageV: 800,
          maxChargeCurrentAllowedA: -100,
          maxDischargeCurrentAllowedA: 50,
          maxCellVoltageV: 3.3,
          minCellVoltageV: 3.1,
        },
      },
    });

    expect(result.command.pcsActivePowerKw).toBe(38);
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["e280-discharge-current-limit"])
    );
  });

  test("uses configured SOC hysteresis and battery policy values", () => {
    const config = makeConfig();
    config.battery.maxSoc = 0.95;
    config.battery.socHigh = 0.95;
    config.battery.socHighRecover = 0.92;
    config.battery.powerHeadroomKw = 5;
    config.battery.commandRampKwPerSec = 100;

    const state = {};
    let result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": 0,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 0,
        "Chint1.PAC": 0,
      },
      baseTelemetry: {
        soc: 0.95,
        gridStatus: "normal",
        realtimeActivePowerKwRequest: -25,
        machineStatus: {
          bmsStatus: 1,
          batteryVoltageV: 800,
          maxChargeCurrentAllowedA: -50,
          maxDischargeCurrentAllowedA: 100,
          maxCellVoltageV: 3.3,
          minCellVoltageV: 3.1,
        },
      },
      state,
    });

    expect(result.command.pcsActivePowerKw).toBe(0);
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["soc-high-no-charge"])
    );

    result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": 0,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 0,
        "Chint1.PAC": 0,
      },
      baseTelemetry: {
        soc: 0.93,
        gridStatus: "normal",
        realtimeActivePowerKwRequest: -25,
        machineStatus: {
          bmsStatus: 1,
          batteryVoltageV: 800,
          maxChargeCurrentAllowedA: -50,
          maxDischargeCurrentAllowedA: 100,
          maxCellVoltageV: 3.3,
          minCellVoltageV: 3.1,
        },
      },
      state,
    });

    expect(result.command.pcsActivePowerKw).toBe(0);
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["soc-high-no-charge"])
    );

    result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": 0,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 0,
        "Chint1.PAC": 0,
      },
      baseTelemetry: {
        soc: 0.91,
        gridStatus: "normal",
        realtimeActivePowerKwRequest: -80,
        machineStatus: {
          bmsStatus: 1,
          batteryVoltageV: 800,
          maxChargeCurrentAllowedA: -50,
          maxDischargeCurrentAllowedA: 100,
          maxCellVoltageV: 3.3,
          minCellVoltageV: 3.1,
        },
      },
      state,
    });

    expect(result.command.pcsActivePowerKw).toBe(-35);
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["e280-charge-current-limit"])
    );
  });

  test("scheduled meter rule uses configured readings, SOC window, and BESS baseline", () => {
    const config = makeConfig();
    config.operation.crdMode = "no-restriction";
    config.operation.scheduledControlEnabled = true;

    const result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": 80,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 10,
        "Chint1.PAC": 20,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        pcsActivePowerKw: 10,
        realtimeActivePowerKwRequest: 0,
      },
      schedule: {
        activePlan: {
          plan: { planID: "may" },
          start: null,
          end: new Date("2026-05-03T00:00:00.000Z"),
          nowLocal: new Date("2026-05-02T12:00:00.000Z"),
          source: "local",
          via: "timed",
        },
        strategy: {
          meter_rule: {
            discharge: {
              net_load_threshold: { value: 40, unit: "kW" },
            },
            charge: {
              net_load_threshold: { value: 0, unit: "kW" },
            },
          },
        },
      },
    });

    expect(result.telemetry).toEqual(
      expect.objectContaining({
        utilityPowerKw: 80,
        siteLoadKw: 110,
        pvKw: 20,
      })
    );
    expect(result.command.controlMode).toBe("scheduled");
    expect(result.command.pcsActivePowerKw).toBe(50);
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["scheduled-meter-rule-discharge"])
    );
  });

  test("scheduled meter rule holds active discharge inside the threshold band", () => {
    const config = makeConfig();
    config.operation.crdMode = "no-restriction";
    config.operation.scheduledControlEnabled = true;

    const result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": 20,
        "Meter.Load_Total_Power": 98,
        "Meter.PV_Total_Power": 0,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        pcsActivePowerKw: 78,
      },
      schedule: {
        strategy: {
          meter_rule: {
            discharge: {
              net_load_threshold: { value: 20, unit: "kW" },
            },
          },
        },
      },
    });

    expect(result.command.controlMode).toBe("scheduled");
    expect(result.command.pcsActivePowerKw).toBe(78);
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["scheduled-meter-rule-discharge-hold"])
    );
  });

  test("scheduled meter rule hold can use raw PCS measured telemetry", () => {
    const config = makeConfig();
    config.operation.crdMode = "no-restriction";
    config.operation.scheduledControlEnabled = true;

    const result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": 20,
        "Meter.Load_Total_Power": 98,
        "Meter.PV_Total_Power": 0,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 78,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
      },
      schedule: {
        strategy: {
          meter_rule: {
            discharge: {
              net_load_threshold: { value: 20, unit: "kW" },
            },
          },
        },
      },
    });

    expect(result.telemetry.pcsActivePowerKw).toBe(78);
    expect(result.command.pcsActivePowerKw).toBe(78);
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["scheduled-meter-rule-discharge-hold"])
    );
  });

  test("scheduled meter rule holds active discharge when POI dips below threshold", () => {
    const config = makeConfig();
    config.operation.crdMode = "no-restriction";
    config.operation.scheduledControlEnabled = true;

    const result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": 17.5,
        "Meter.Load_Total_Power": 98,
        "Meter.PV_Total_Power": 0,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        pcsActivePowerKw: 78,
      },
      schedule: {
        strategy: {
          meter_rule: {
            discharge: {
              net_load_threshold: { value: 20, unit: "kW" },
            },
          },
        },
      },
    });

    expect(result.command.controlMode).toBe("scheduled");
    expect(result.command.pcsActivePowerKw).toBe(75.5);
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["scheduled-meter-rule-discharge-hold"])
    );
  });

  test("scheduled meter rule SOC guard comes from SiteConfig, not plan constraints", () => {
    const config = makeConfig();
    config.operation.crdMode = "no-restriction";
    config.operation.scheduledControlEnabled = true;
    config.battery.minSoc = 0.4;

    const result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": 80,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 0,
        "Chint1.PAC": 20,
      },
      baseTelemetry: {
        soc: 0.39,
        gridStatus: "normal",
        realtimeActivePowerKwRequest: 0,
      },
      schedule: {
        strategy: {
          meter_rule: {
            discharge: {
              net_load_threshold: { value: 40, unit: "kW" },
            },
          },
        },
        constraints: {
          min_soc: { value: 10, unit: "%" },
        },
      },
    });

    expect(result.command.controlMode).toBe("scheduled");
    expect(result.command.pcsActivePowerKw).toBe(0);
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["scheduled-meter-rule-discharge-blocked"])
    );
  });

  test("scheduled PV self-consumption uses configured load and PV readings", () => {
    const config = makeConfig();
    config.operation.crdMode = "no-restriction";
    config.operation.scheduledControlEnabled = true;

    const result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": -15,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 0,
        "Chint1.PAC": 60,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        realtimeActivePowerKwRequest: 0,
      },
      schedule: {
        strategy: {
          pv_rule: {
            mode: "selfconsumption",
          },
        },
      },
    });

    expect(result.telemetry).toEqual(
      expect.objectContaining({
        siteLoadKw: 45,
        pvKw: 60,
      })
    );
    expect(result.command.controlMode).toBe("scheduled");
    expect(result.command.pcsActivePowerKw).toBe(-15.5);
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["scheduled-self-consumption"])
    );
  });

  test("site-level no-export emits PV curtailment writer envelopes", () => {
    const config = makeConfig();
    config.operation.crdMode = "no-restriction";
    config.operation.siteExportMode = "no-export";
    config.operation.siteExportTargetImportKw = 0.5;
    config.operation.siteExportDeadbandKw = 0.8;
    config.operation.scheduledControlEnabled = false;
    config.pv.curtailmentMethod = "modbus";

    const result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": -10,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 0,
        "Chint1.PAC": 50,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        realtimeActivePowerKwRequest: 0,
      },
    });

    expect(result.command.pcsActivePowerKw).toBe(0);
    expect(result.command.pvCurtailmentKw).toBe(44);
    expect(result.command.pvActivePowerLimitPct).toBeCloseTo(0.1, 6);
    expect(result.writerEnvelopes).toEqual(
      expect.arrayContaining([
        {
          topic: "Chint1",
          payload: [
            {
              tagID: "Chint1.Dynamic_Active_Power_Limit",
              value: result.command.pvActivePowerLimitPct,
            },
          ],
        },
      ])
    );
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["site-no-export", "pv-curtailment-modbus"])
    );
  });

  test("site-level no-export emits PV release when export is already resolved", () => {
    const config = makeConfig();
    config.operation.crdMode = "no-export";
    config.operation.siteExportMode = "no-export";
    config.operation.siteExportTargetImportKw = 0;
    config.operation.siteExportDeadbandKw = 0.8;
    config.operation.scheduledControlEnabled = false;
    config.pv.curtailmentMethod = "modbus";

    const result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": 18.8,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 41.8,
        "Chint1.PAC": 30,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        realtimeActivePowerKwRequest: 40.5,
      },
    });

    expect(result.command.predictedUtilityPowerKw).toBeCloseTo(20.1, 6);
    expect(result.command.pvCurtailmentKw).toBe(24);
    expect(result.writerEnvelopes).toEqual(
      expect.arrayContaining([
        {
          topic: "Chint1",
          payload: [
            {
              tagID: "Chint1.Dynamic_Active_Power_Limit",
              value: 0.1,
            },
          ],
        },
      ])
    );
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["site-no-export", "pv-curtailment-modbus"])
    );
  });

  test("site-level no-export refreshes SolarEdge limit every cycle", () => {
    const config = makeConfig();
    config.operation.crdMode = "no-restriction";
    config.operation.siteExportMode = "no-export";
    config.operation.siteExportTargetImportKw = 0.5;
    config.operation.siteExportDeadbandKw = 0.8;
    config.operation.scheduledControlEnabled = false;
    config.pv.curtailmentMethod = "modbus";

    const input = {
      telemetry: {
        "Meter.POI_kW": -10,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 0,
        "Chint1.PAC": 50,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal" as const,
        realtimeActivePowerKwRequest: 0,
      },
    };

    const first = runUnifiedControlCycle(config, input);
    const second = runUnifiedControlCycle(config, input);

    const expectedSolarEdgeEnvelope = {
      topic: "Chint1",
      payload: [
        {
          tagID: "Chint1.Dynamic_Active_Power_Limit",
          value: first.command.pvActivePowerLimitPct,
        },
      ],
    };
    expect(first.writerEnvelopes).toEqual(
      expect.arrayContaining([expectedSolarEdgeEnvelope])
    );
    expect(second.writerEnvelopes).toEqual(
      expect.arrayContaining([expectedSolarEdgeEnvelope])
    );
  });

  test("allows islanding protection when normalized state is healthy", () => {
    const config = makeConfig();
    config.islanding = {
      device: "SEL851",
    };

    const result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": 0,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 0,
        "Chint1.PAC": 0,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "island",
        protectionState: "islanded",
        pcsRunAllowed: true,
        remoteInterlockClosed: true,
        realtimeActivePowerKwRequest: 20,
      },
    });

    expect(result.command.pcsActivePowerKw).toBe(20);
    expect(result.command.pcsRunMode).toBeUndefined();
    expect(result.command.gridWireConnection).toBeUndefined();
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["pcs-mode-owned-by-islanding-sequencer"])
    );
    expect(result.writerEnvelopes).toEqual([
      {
        topic: "PCS",
        payload: [
          {
            tagID: "SYSTEM_ACTIVE_POWER_DEMAND",
            value: 20,
          },
        ],
      },
    ]);
    expect(result.pipeline.blocked).toBe(false);
    expect(result.pipeline.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "protection",
          status: "active",
          reasons: ["sel-relay protection route configured"],
        }),
      ])
    );
  });

  test("requests PCS grid-tie mode when protection state is normal", () => {
    const config = makeConfig();
    config.islanding = {
      device: "ASCO-ATS",
    };

    const result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": 0,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 0,
        "Chint1.PAC": 0,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        protectionState: "normal",
        pcsRunAllowed: true,
        realtimeActivePowerKwRequest: 0,
      },
    });

    expect(result.command.pcsRunMode).toBe("grid-tie");
    expect(result.command.gridWireConnection).toBe(false);
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["pcs-mode-grid-tie"])
    );
    expect(result.writerEnvelopes[0].payload).toEqual(
      expect.arrayContaining([
        {
          tagID: "SYSTEM_RUN_MODE",
          value: 0,
        },
        {
          tagID: "GRID_WIRE_CONNECTION",
          value: 0,
        },
      ])
    );
  });

  test("blocks to safe zero when configured protection state is missing", () => {
    const config = makeConfig();
    config.islanding = {
      device: "ASCO-ATS",
    };

    const result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": 0,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 0,
        "Chint1.PAC": 0,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        realtimeActivePowerKwRequest: 20,
      },
    });

    expect(result.command).toEqual(
      expect.objectContaining({
        controlMode: "idle",
        pcsActivePowerKw: 0,
        reasons: expect.arrayContaining([
          "safe-zero",
          "protection-state-missing",
        ]),
      })
    );
    expect(result.pipeline.blocked).toBe(true);
    expect(result.pipeline.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "protection",
          status: "blocked",
          reasons: ["protection-state-missing"],
        }),
      ])
    );
  });

  test("blocks to safe zero when SEL remote interlock is open", () => {
    const config = makeConfig();
    config.islanding = {
      device: "SEL851",
    };

    const result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": 0,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 0,
        "Chint1.PAC": 0,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        protectionState: "normal",
        pcsRunAllowed: true,
        remoteInterlockClosed: false,
        realtimeActivePowerKwRequest: 20,
      },
    });

    expect(result.command.pcsActivePowerKw).toBe(0);
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["safe-zero", "remote-interlock-open"])
    );
    expect(result.pipeline.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "safety-gates",
          status: "blocked",
          reasons: expect.arrayContaining(["remote-interlock-open"]),
        }),
      ])
    );
  });
});
