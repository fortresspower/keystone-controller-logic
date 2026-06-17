import {
  buildSs40kFixedPayloads,
  buildSs40kLookup,
  DEFAULT_SS40K_MODEL_INDEX_MAP,
} from "../telemetry/ss40k";
import { buildAmpaceBcu42kEquipmentConfig } from "../telemetry/ampaceBcu42k";

describe("SS40K export helpers", () => {
  test("buildSs40kLookup carries exportMultiplier metadata from templates", () => {
    const result = buildSs40kLookup({
      MBMU: { profileName: "MBMU_280_ss40k", route: "MBMU" },
      PCS: { profileName: "Delta_280_ss40k", route: "PCS" },
    });

    expect(result.lookup["MBMU.System_SOC_pct"]).toMatchObject({
      equipment: "MBMU",
      name: "socBat",
      model: "40101",
      exportMultiplier: 100,
    });

    expect(result.lookup["PCS.SYSTEM_POWER_ACTIVE_ALL"]).toMatchObject({
      equipment: "PCS",
      name: "W",
      model: "40101",
      exportMultiplier: 10000,
    });

    expect(result.routeMap).toEqual({
      MBMU: "MBMU",
      PCS: "PCS",
    });
  });

  test("buildSs40kFixedPayloads applies multipliers and splits by SS40K model", () => {
    const { lookup } = buildSs40kLookup({
      MBMU: "MBMU_280_ss40k",
      PCS: "Delta_280_ss40k",
    });

    const messages = buildSs40kFixedPayloads({
      lookup,
      telemetry: {
        MBMU: [
          {
            tagID: "MBMU.System_Voltage_V",
            value: 52.4,
            timestamp: "2026-04-16T12:00:00.000Z",
          },
          {
            tagID: "MBMU.System_SOC_pct",
            value: 0.57,
            timestamp: "2026-04-16T12:00:01.000Z",
          },
        ],
        PCS: [
          {
            tagID: "PCS.SYSTEM_POWER_ACTIVE_ALL",
            value: 12.34,
            timestamp: "2026-04-16T12:00:02.000Z",
          },
          {
            tagID: "PCS.SYSTEM_MAX_POWER_AVAILABLE",
            value: 125,
            timestamp: "2026-04-16T12:00:03.000Z",
          },
        ],
      },
      topic: "fort/v1/things/test/telem",
    });

    expect(messages).toHaveLength(3);

    const byKey = Object.fromEntries(
      messages.map((message) => [
        `${message.ss40k.equipment}.${message.ss40k.model}`,
        message,
      ])
    );

    expect(byKey["PCS.40100"]).toMatchObject({
      topic: "fort/v1/things/test/telem",
      payload: {
        "0": {
          id: 40100,
          version: "3.0",
          fixed: {
            ID: 40100,
            pNom: 1250000,
          },
        },
      },
      ss40k: {
        equipment: "PCS",
        model: "40100",
        modelIndex: "0",
      },
    });

    expect(byKey["MBMU.40101"]).toMatchObject({
      payload: {
        "1": {
          id: 40101,
          version: "3.0",
          fixed: {
            ID: 40101,
            socBat: 57,
            vBat: 524,
          },
        },
      },
      ss40k: {
        equipment: "MBMU",
        model: "40101",
        modelIndex: "1",
        timestamp: "2026-04-16T12:00:01.000Z",
      },
    });

    expect(byKey["PCS.40101"]).toMatchObject({
      payload: {
        "1": {
          id: 40101,
          version: "3.0",
          fixed: {
            ID: 40101,
            W: 123400,
          },
        },
      },
      ss40k: {
        equipment: "PCS",
        model: "40101",
        modelIndex: "1",
        timestamp: "2026-04-16T12:00:02.000Z",
      },
    });
  });

  test("AMPACE Mini BMS maps battery telemetry into SS40K monitoring models", () => {
    const { lookup } = buildSs40kLookup({
      BMS: "AMPACE_Mini_ss40k",
    });

    expect(lookup["BMS.BamsSoc"]).toMatchObject({
      name: "socBat",
      model: "40101",
      modelIndex: "1",
      exportMultiplier: 100,
    });
    expect(lookup["BMS.BamsVoltage"]).toMatchObject({
      name: "vBat",
      model: "40101",
      exportMultiplier: 10,
    });
    expect(lookup["BMS.BamsDischargePower"]).toMatchObject({
      name: "pBatDischg",
      model: "40101",
      exportMultiplier: 1000,
    });
    expect(lookup["BMS.BamsChargePower"]).toMatchObject({
      name: "pBatChg",
      model: "40101",
      exportMultiplier: 1000,
    });
    expect(lookup["BMS.BamsPermitChgCurrent"]).toMatchObject({
      name: "iBatChgMaxBms",
      model: "40201",
      modelIndex: "5",
      exportMultiplier: 100,
    });
    expect(lookup["BMS.BamsPermitDsgCurrent"]).toMatchObject({
      name: "iBatDischgMaxBms",
      model: "40201",
      modelIndex: "5",
      exportMultiplier: 100,
    });
    expect(lookup["BMS.batWarning"]).toMatchObject({
      name: "batWarning",
      model: "40103",
      modelIndex: "3",
      exportMultiplier: 1,
    });
    expect(lookup["BMS.batFault"]).toMatchObject({
      name: "batFault",
      model: "40103",
      modelIndex: "3",
      exportMultiplier: 1,
    });

    const messages = buildSs40kFixedPayloads({
      lookup,
      telemetry: {
        BMS: [
          { tagID: "BMS.BamsSoc", value: 0.72 },
          { tagID: "BMS.BamsVoltage", value: 700.5 },
          { tagID: "BMS.BamsDischargePower", value: 23.5 },
          { tagID: "BMS.BamsChargePower", value: 0 },
          { tagID: "BMS.BamsMaxCellVol", value: 3.42 },
          { tagID: "BMS.BamsPermitChgCurrent", value: 120.5 },
          { tagID: "BMS.batWarning", value: 20 },
          { tagID: "BMS.batFault", value: 1 },
        ],
      },
      topic: "fort/v1/things/test/telem",
    });

    const byModel = Object.fromEntries(
      messages.map((message) => [message.ss40k.model, message])
    );

    expect(byModel["40101"]).toMatchObject({
      payload: {
        "1": {
          id: 40101,
          fixed: {
            ID: 40101,
            socBat: 72,
            vBat: 7005,
            pBatDischg: 23500,
            pBatChg: 0,
            vBatCellMax: 3420,
          },
        },
      },
    });
    expect(byModel["40201"]).toMatchObject({
      payload: {
        "5": {
          id: 40201,
          fixed: {
            ID: 40201,
            iBatChgMaxBms: 12050,
          },
        },
      },
    });
    expect(byModel["40103"]).toMatchObject({
      payload: {
        "3": {
          id: 40103,
          fixed: {
            ID: 40103,
            batWarning: 20,
            batFault: 1,
          },
        },
      },
    });
  });

  test("generated AMPACE BCU readers map each BCU into SS42K battery models", () => {
    const equipmentConfig = buildAmpaceBcu42kEquipmentConfig({
      count: 2,
      route: "AMPACE",
      modelName: "MINI-90-135-288",
    });
    const { lookup, routeMap } = buildSs40kLookup(equipmentConfig);

    expect(Object.keys(equipmentConfig)).toEqual(["AMPACE_BCU_1", "AMPACE_BCU_2"]);
    expect(routeMap).toEqual({
      AMPACE_BCU_1: "AMPACE",
      AMPACE_BCU_2: "AMPACE",
    });
    expect(lookup["AMPACE_BCU_2.SerialNumber"]).toMatchObject({
      equipment: "AMPACE_BCU_2",
      name: "SN",
      model: "42100",
      modelIndex: "20",
    });
    expect(lookup["AMPACE_BCU_2.BcuCurrent"]).toMatchObject({
      name: "A",
      model: "42101",
      modelIndex: "21",
      exportMultiplier: 10,
    });
    expect(lookup["AMPACE_BCU_2.BcuPower"]).toMatchObject({
      name: "W",
      model: "42101",
      exportMultiplier: 0.1,
    });
    expect(lookup["AMPACE_BCU_2.BcuBatteryFault"]).toMatchObject({
      name: "BatteryFault",
      model: "42103",
      modelIndex: "23",
    });
  });

  test("SS42K AMPACE BCU payloads keep per-BCU SN and BatteryId", () => {
    const { lookup } = buildSs40kLookup(
      buildAmpaceBcu42kEquipmentConfig({ count: 1, route: "AMPACE" })
    );

    const messages = buildSs40kFixedPayloads({
      lookup,
      telemetry: {
        AMPACE_BCU_1: [
          { tagID: "AMPACE_BCU_1.SerialNumber", value: 2350317571 },
          { tagID: "AMPACE_BCU_1.BatteryId", value: 1 },
          { tagID: "AMPACE_BCU_1.USOC", value: 0.72 },
          { tagID: "AMPACE_BCU_1.SOH", value: 0.98 },
          { tagID: "AMPACE_BCU_1.InternalSumVoltage", value: 720.5 },
          { tagID: "AMPACE_BCU_1.BcuCurrent", value: -12.3 },
          { tagID: "AMPACE_BCU_1.BcuPower", value: -8862.15 },
          { tagID: "AMPACE_BCU_1.BcuBatteryFault", value: 1 },
        ],
      },
      topic: "fort/v1/things/test/telem",
      fixedSerialNumber: "PCS-SN",
    });

    const byModel = Object.fromEntries(
      messages.map((message) => [message.ss40k.model, message])
    );

    expect(byModel["42100"]).toMatchObject({
      payload: {
        "20": {
          id: 42100,
          fixed: expect.objectContaining({
            ID: 42100,
            SN: "2350317571",
            BatteryId: 1,
          }),
        },
      },
    });
    expect(byModel["42101"]).toMatchObject({
      payload: {
        "21": {
          id: 42101,
          fixed: expect.objectContaining({
            ID: 42101,
            SN: "2350317571",
            BatteryId: 1,
            SoC: 72,
            SoH: 98,
            V: 7205,
            A: -123,
            W: -886,
          }),
        },
      },
    });
    expect(byModel["42103"]).toMatchObject({
      payload: {
        "23": {
          id: 42103,
          fixed: expect.objectContaining({
            ID: 42103,
            SN: "2350317571",
            BatteryId: 1,
            BatteryFault: 1,
          }),
        },
      },
    });
  });

  test("Sinexcel Mini PCS calculated faults export into SS40K 40103", () => {
    const { lookup } = buildSs40kLookup({
      PCS: "Sinexcel_Mini_PCS_ss40k",
    });

    expect(lookup["PCS.pcsFault"]).toMatchObject({
      name: "pcsFault",
      model: "40103",
      modelIndex: "3",
      exportMultiplier: 1,
    });
    expect(lookup["PCS.gridWarning"]).toMatchObject({
      name: "gridWarning",
      model: "40103",
      modelIndex: "3",
    });
    expect(lookup["PCS.rsdEPOFault"]).toMatchObject({
      name: "rsdEPOFault",
      model: "40103",
      modelIndex: "3",
    });

    const messages = buildSs40kFixedPayloads({
      lookup,
      telemetry: {
        PCS: [
          { tagID: "PCS.pcsFault", value: 8 },
          { tagID: "PCS.gridWarning", value: 72 },
          { tagID: "PCS.rsdEPOFault", value: 2 },
        ],
      },
      topic: "fort/v1/things/test/telem",
    });

    expect(messages).toEqual([
      expect.objectContaining({
        payload: {
          "3": {
            id: 40103,
            version: "3.0",
            fixed: {
              ID: 40103,
              pcsFault: 8,
              gridWarning: 72,
              rsdEPOFault: 2,
            },
          },
        },
      }),
    ]);
  });

  test("SS40K payloads stamp one fixed SN across all 40K models", () => {
    const { lookup } = buildSs40kLookup({
      PCS: "Sinexcel_Mini_PCS_ss40k",
      BMS: "AMPACE_Mini_ss40k",
    });

    expect(lookup["PCS.SerialNumber"]).toMatchObject({
      name: "SN",
      model: "40101",
    });

    const messages = buildSs40kFixedPayloads({
      lookup,
      telemetry: {
        PCS: [
          { tagID: "PCS.SerialNumber", value: "SH0P600458852403070035" },
          { tagID: "PCS.ACBusTotalActivePower", value: 44.4 },
          { tagID: "PCS.pcsFault", value: 8 },
        ],
        BMS: [
          { tagID: "BMS.BamsSoc", value: 0.72 },
          { tagID: "BMS.batFault", value: 1 },
        ],
      },
      topic: "fort/v1/things/test/telem",
    });

    expect(messages.length).toBeGreaterThan(1);
    for (const message of messages) {
      const modelPayload = Object.values(message.payload)[0];
      expect(modelPayload.fixed.SN).toBe("SH0P600458852403070035");
    }
  });

  test("Sinexcel Mini PVDC calculated faults export into SS40K 40103", () => {
    const { lookup } = buildSs40kLookup({
      PVDC1: "Sinexcel_Mini_PVDC_Module1_ss40k",
    });

    expect(lookup["PVDC1.dcPvWarning"]).toMatchObject({
      name: "dcPvWarning",
      model: "40103",
      modelIndex: "3",
      exportMultiplier: 1,
    });
    expect(lookup["PVDC1.dcPvFault"]).toMatchObject({
      name: "dcPvFault",
      model: "40103",
      modelIndex: "3",
      exportMultiplier: 1,
    });

    const messages = buildSs40kFixedPayloads({
      lookup,
      telemetry: {
        PVDC1: [
          { tagID: "PVDC1.dcPvWarning", value: 1 },
          { tagID: "PVDC1.dcPvFault", value: 36 },
        ],
      },
      topic: "fort/v1/things/test/telem",
    });

    expect(messages).toEqual([
      expect.objectContaining({
        payload: {
          "3": {
            id: 40103,
            version: "3.0",
            fixed: {
              ID: 40103,
              dcPvWarning: 1,
              dcPvFault: 36,
            },
          },
        },
      }),
    ]);
  });

  test("Sinexcel Mini load telemetry reuses SS40K 40101 load points", () => {
    const { lookup } = buildSs40kLookup({
      LOAD: "Sinexcel_Mini_Load",
    });

    expect(lookup["LOAD.LoadTotalActivePower"]).toMatchObject({
      name: "pLoad",
      model: "40101",
      modelIndex: "1",
      exportMultiplier: 1000,
    });
    expect(lookup["LOAD.LoadL2ReactivePower"]).toMatchObject({
      name: "qLoadL2",
      model: "40101",
      exportMultiplier: 1000,
    });
    expect(lookup["LOAD.LoadL3NVoltage"]).toMatchObject({
      name: "vLoadL3N",
      model: "40101",
      exportMultiplier: 1,
    });

    const messages = buildSs40kFixedPayloads({
      lookup,
      telemetry: {
        LOAD: [
          { tagID: "LOAD.LoadTotalActivePower", value: 42.5 },
          { tagID: "LOAD.LoadL1ActivePower", value: 14.1 },
          { tagID: "LOAD.LoadL2ReactivePower", value: 2.25 },
          { tagID: "LOAD.LoadFrequency", value: 60 },
          { tagID: "LOAD.LoadL3NVoltage", value: 277.2 },
        ],
      },
      topic: "fort/v1/things/test/telem",
    });

    expect(messages).toEqual([
      expect.objectContaining({
        payload: {
          "1": {
            id: 40101,
            version: "3.0",
            fixed: {
              ID: 40101,
              pLoad: 42500,
              pLoadL1: 14100,
              qLoadL2: 2250,
              fLoad: 60,
              vLoadL3N: 277.2,
            },
          },
        },
      }),
    ]);
  });

  test("Assisted Living eGauge profile maps signed utility and backup load into SS40K", () => {
    const { lookup } = buildSs40kLookup({
      Meter: "eGauge_Assisted_Living",
    });

    expect(lookup["Meter.Utility_Import_Power"]).toMatchObject({
      name: "pGridImpTot",
      model: "40101",
      modelIndex: "1",
      exportMultiplier: 1000,
    });
    expect(lookup["Meter.Utility_Export_Power"]).toMatchObject({
      name: "pGridExpTot",
      model: "40101",
      modelIndex: "1",
      exportMultiplier: 1000,
    });
    expect(lookup["Meter.Backup_Load_Total_Power"]).toMatchObject({
      name: "pBkupTot",
      model: "40101",
      modelIndex: "1",
      exportMultiplier: 1000,
    });
    expect(lookup["Meter.Load_Active_Power"]).toMatchObject({
      name: "pLoad",
      model: "40101",
      modelIndex: "1",
      exportMultiplier: 1000,
    });

    const messages = buildSs40kFixedPayloads({
      lookup,
      telemetry: {
        Meter: [
          { tagID: "Meter.Utility_Import_Power", value: 40.2 },
          { tagID: "Meter.Utility_Export_Power", value: 0 },
          { tagID: "Meter.Backup_Load_Total_Power", value: 52.4 },
          { tagID: "Meter.Load_Active_Power", value: 88.8 },
        ],
      },
      topic: "fort/v1/things/test/telem",
    });

    expect(messages).toEqual([
      expect.objectContaining({
        payload: {
          "1": {
            id: 40101,
            version: "3.0",
            fixed: expect.objectContaining({
              ID: 40101,
              pGridImpTot: 40200,
              pGridExpTot: 0,
              pBkupTot: 52400,
              pLoad: 88800,
            }),
          },
        },
      }),
    ]);
  });

  test("Mission Energy eGauge profile maps live site grid, load, and solar readings", () => {
    const { lookup } = buildSs40kLookup({
      Meter: "eGauge_Mission_Energy",
    });

    expect(lookup["Meter.Utility_Import_Power"]).toMatchObject({
      name: "pGridImpTot",
      model: "40101",
      modelIndex: "1",
      exportMultiplier: 1000,
    });
    expect(lookup["Meter.Load_Active_Power"]).toMatchObject({
      name: "pLoad",
      model: "40101",
      exportMultiplier: 1000,
    });
    expect(lookup["Meter.Utility_L1_Power"]).toMatchObject({
      name: "pGridL1",
      model: "40101",
      exportMultiplier: 1000,
    });
    expect(lookup["Meter.Utility_Total_Power"]).toBeUndefined();
    expect(lookup["Meter.AC_Combiner_Total_Power"]).toBeUndefined();

    const messages = buildSs40kFixedPayloads({
      lookup,
      telemetry: {
        Meter: [
          { tagID: "Meter.Utility_Import_Power", value: 31.25 },
          { tagID: "Meter.Utility_Export_Power", value: 0 },
          { tagID: "Meter.Load_Active_Power", value: 42.5 },
          { tagID: "Meter.Utility_L1_Power", value: 10.25 },
          { tagID: "Meter.L1_Voltage", value: 277.1 },
        ],
      },
      topic: "fort/v1/things/test/telem",
    });

    expect(messages).toEqual([
      expect.objectContaining({
        payload: {
          "1": {
            id: 40101,
            version: "3.0",
            fixed: expect.objectContaining({
              ID: 40101,
              pGridImpTot: 31250,
              pGridExpTot: 0,
              pLoad: 42500,
              pGridL1: 10250,
              vGridL1N: 277.1,
            }),
          },
        },
      }),
    ]);
  });

  test("SolarEdge profile exports AC-coupled PV power and energy", () => {
    const { lookup } = buildSs40kLookup({
      SolarEdge1: "solarEdge",
    });

    expect(lookup["SolarEdge1.AC_POWER"]).toMatchObject({
      name: "pAcCplTot",
      model: "40101",
      modelIndex: "1",
    });
    expect(lookup["SolarEdge1.AC_ENERGY_WH"]).toMatchObject({
      name: "ePvTot",
      model: "40102",
      modelIndex: "2",
    });

    const messages = buildSs40kFixedPayloads({
      lookup,
      telemetry: {
        SolarEdge1: [
          { tagID: "SolarEdge1.AC_POWER", value: 12500 },
          { tagID: "SolarEdge1.AC_ENERGY_WH", value: 987654 },
        ],
      },
      topic: "fort/v1/things/test/telem",
    });

    const byModel = Object.fromEntries(
      messages.map((message) => [message.ss40k.model, message])
    );

    expect(byModel["40101"]).toMatchObject({
      payload: {
        "1": {
          id: 40101,
          fixed: {
            ID: 40101,
            pAcCplTot: 12500,
          },
        },
      },
    });
    expect(byModel["40102"]).toMatchObject({
      payload: {
        "2": {
          id: 40102,
          fixed: {
            ID: 40102,
            ePvTot: 987654,
          },
        },
      },
    });
  });

  test("Mission Energy Meter2 profile maps the Solar register to AC-coupled PV", () => {
    const { lookup } = buildSs40kLookup({
      Meter2: "eGauge_Mission_Energy_Meter2",
    });

    expect(lookup["Meter2.Solar"]).toMatchObject({
      name: "pAcCplTot",
      model: "40101",
      modelIndex: "1",
      exportMultiplier: 1000,
    });

    const messages = buildSs40kFixedPayloads({
      lookup,
      telemetry: {
        Meter2: [{ tagID: "Meter2.Solar", value: 6.5 }],
      },
      topic: "fort/v1/things/test/telem",
    });

    expect(messages).toEqual([
      expect.objectContaining({
        payload: {
          "1": {
            id: 40101,
            version: "3.0",
            fixed: {
              ID: 40101,
              pAcCplTot: 6500,
            },
          },
        },
      }),
    ]);
  });

  test("Sinexcel Mini PVDC telemetry reuses SS40K PV and energy points", () => {
    const { lookup } = buildSs40kLookup({
      PVDC1: "pvdc_module_1",
      PCS: "Sinexcel_Mini_PCS_ss40k",
    });

    expect(lookup["PVDC1.PVSideTotalPower"]).toMatchObject({
      name: "pPvTotal",
      model: "40101",
      modelIndex: "1",
      exportMultiplier: 1000,
    });
    expect(lookup["PVDC1.PV1SideVoltage"]).toMatchObject({
      name: "vMppt1",
      model: "40101",
    });
    expect(lookup["PVDC1.PVGeneratedEnergy"]).toMatchObject({
      name: "ePvTot",
      model: "40102",
      modelIndex: "2",
      exportMultiplier: 1000,
    });
    expect(lookup["PCS.ACBusTotalActivePower"]).toMatchObject({
      name: "W",
      model: "40101",
      exportMultiplier: 1000,
    });

    const messages = buildSs40kFixedPayloads({
      lookup,
      telemetry: {
        PVDC1: [
          { tagID: "PVDC1.PVSideTotalPower", value: 31.2 },
          { tagID: "PVDC1.PV1SideTotalPower", value: 10.1 },
          { tagID: "PVDC1.PV1SideVoltage", value: 620.5 },
          { tagID: "PVDC1.PVGeneratedEnergy", value: 123.4 },
        ],
        PCS: [{ tagID: "PCS.ACBusTotalActivePower", value: 44.4 }],
      },
      topic: "fort/v1/things/test/telem",
    });

    const byKey = Object.fromEntries(
      messages.map((message) => [
        `${message.ss40k.equipment}.${message.ss40k.model}`,
        message,
      ])
    );

    expect(byKey["PVDC1.40101"]).toMatchObject({
      payload: {
        "1": {
          id: 40101,
          fixed: {
            ID: 40101,
            pPvTotal: 31200,
            pMppt1: 10100,
            vMppt1: 620.5,
          },
        },
      },
    });
    expect(byKey["PVDC1.40102"]).toMatchObject({
      payload: {
        "2": {
          id: 40102,
          fixed: {
            ID: 40102,
            ePvTot: 123400,
          },
        },
      },
    });
    expect(byKey["PCS.40101"]).toMatchObject({
      payload: {
        "1": {
          id: 40101,
          fixed: {
            ID: 40101,
            W: 44400,
          },
        },
      },
    });
  });

  test("site signal mapping overrides Mini site-level SS40K fields", () => {
    const { lookup } = buildSs40kLookup(
      {
        Meter: "eGauge_Assisted_Living",
        BMS: "AMPACE_Mini_ss40k",
        PVDC1: "pvdc_module_1",
        PVDC2: "pvdc_module_2",
        PVDC3: "pvdc_module_3",
        PCS: "Sinexcel_Mini_PCS_ss40k",
      },
      {
        ...DEFAULT_SS40K_MODEL_INDEX_MAP,
        "40101": "0",
      }
    );

    const messages = buildSs40kFixedPayloads({
      lookup,
      mergeByModelIndex: true,
      signalMapping: {
        signals: {
          utilityPowerKw: { expr: "Meter.Utility_Total_Power" },
          pvKw: {
            expr: "PVDC1.PVSideTotalPower + PVDC2.PVSideTotalPower + PVDC3.PVSideTotalPower",
          },
          siteLoadKw: {
            expr: "Meter.Utility_Total_Power - PCS.ACBusTotalActivePower",
          },
          backupLoadKw: { expr: "Meter.Backup_Load_Total_Power" },
          batteryPowerKw: { expr: "BMS.BamsPower" },
        },
      },
      telemetry: {
        Meter: [
          { tagID: "Meter.Utility_Total_Power", value: -13.9 },
          { tagID: "Meter.Backup_Load_Total_Power", value: 6.18 },
        ],
        BMS: [{ tagID: "BMS.BamsPower", value: 26.5 }],
        PCS: [{ tagID: "PCS.ACBusTotalActivePower", value: -39.4 }],
        PVDC1: [{ tagID: "PVDC1.PVSideTotalPower", value: 1.3 }],
        PVDC2: [{ tagID: "PVDC2.PVSideTotalPower", value: 1.1 }],
        PVDC3: [{ tagID: "PVDC3.PVSideTotalPower", value: 1 }],
      },
      topic: "fort/v1/things/test/telem",
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      payload: {
        "0": {
          id: 40101,
          fixed: expect.objectContaining({
            ID: 40101,
            pPvTotal: 3400,
            pGridImpTot: 0,
            pGridExpTot: 13900,
            pLoad: 25500,
            pBkupTot: 6180,
            pBatDischg: 26500,
            pBatChg: 0,
          }),
        },
      },
      ss40k: {
        equipment: "site",
        model: "40101",
        modelIndex: "0",
      },
    });
  });
});
