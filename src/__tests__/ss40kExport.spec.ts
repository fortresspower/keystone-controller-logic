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
});
