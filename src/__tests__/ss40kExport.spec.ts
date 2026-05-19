import {
  buildSs40kFixedPayloads,
  buildSs40kLookup,
} from "../telemetry/ss40k";

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
});
