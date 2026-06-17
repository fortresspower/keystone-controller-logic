import {
  adaptTelemetryTemplateToWriteProfile,
  buildTemplateWriteProfile,
  createWriterRuntimeState,
  handleWriterMessage,
} from "../writer";

const instance = {
  equipmentId: "PCS",
  serverKey: "PCS_SERVER",
  unitId: 7,
};

describe("Writer template + runtime", () => {
  test("command sections normalize into write profiles", () => {
    const profile = adaptTelemetryTemplateToWriteProfile("writer_test", {
      version: "2",
      device: {
        vendor: "Delta",
        model: "PCS",
        protocol: "modbus-tcp",
      },
      telemetry: [],
      commands: [
        {
          id: "SYSTEM_ACTIVE_POWER_DEMAND",
          function: "HR",
          address: 4103,
          scale: {
            mode: "Linear",
            rawLow: 0,
            rawHigh: 10,
            scaledLow: 0,
            scaledHigh: 1,
          },
        },
      ],
    } as any);

    expect(profile.commands).toEqual([
      {
        name: "SYSTEM_ACTIVE_POWER_DEMAND",
        function: "HR",
        address: 4103,
        scale: {
          mode: "Linear",
          rawLow: 0,
          rawHigh: 10,
          engLow: 0,
          engHigh: 1,
          clamp: undefined,
        },
        readback: false,
      },
    ]);
  });

  test("template command sections compile into write lookup metadata", () => {
    const compiled = buildTemplateWriteProfile("Delta_280_ss40k", instance);
    const activePower = compiled.profile.tagsById.get("SYSTEM_ACTIVE_POWER_DEMAND");

    expect(activePower).toMatchObject({
      tagID: "SYSTEM_ACTIVE_POWER_DEMAND",
      unitId: 7,
      modbusType: "HR",
      address: 4103,
      rawLow: 0,
      rawHigh: 10,
      scaledLow: 0,
      scaledHigh: 1,
    });
    expect(compiled.serverKey).toBe("PCS_SERVER");
    expect(compiled.profile.devicesByUnitId.get(7)?.writeConfig).toEqual({
      holdingWriteMode: "FC16",
      coilWriteMode: "FC15",
    });
  });

  test("SolarEdge template exposes dynamic active power limit as a command", () => {
    const compiled = buildTemplateWriteProfile("udt_solarEdge_V1", {
      equipmentId: "SolarEdge1",
      serverKey: "AC_PV_1",
      unitId: 1,
    });

    expect(compiled.profile.tagsById.get("Dynamic_Active_Power_Limit")).toMatchObject({
      tagID: "Dynamic_Active_Power_Limit",
      unitId: 1,
      modbusType: "HRF",
      address: 64290,
      rawLow: 0,
      rawHigh: 100,
      scaledLow: 0,
      scaledHigh: 1,
    });
  });

  test("Sinexcel Mini template exposes PVDC controls", () => {
    const compiled = buildTemplateWriteProfile("Sinexcel_Mini_PCS_ss40k", {
      equipmentId: "PCS",
      serverKey: "PCS_SERVER",
      unitId: 1,
    });

    expect(compiled.profile.tagsById.get("PvDcdcConverterEnable")).toMatchObject({
      tagID: "PvDcdcConverterEnable",
      unitId: 1,
      modbusType: "HRUS",
      address: 1270,
    });
    expect(compiled.profile.tagsById.get("PVDCStop")).toMatchObject({
      tagID: "PVDCStop",
      unitId: 1,
      modbusType: "HRUS",
      address: 34162,
    });
    expect(compiled.profile.tagsById.get("PVBusCurrentLimit")).toMatchObject({
      tagID: "PVBusCurrentLimit",
      unitId: 1,
      modbusType: "HRUS",
      address: 34222,
      rawLow: 0,
      rawHigh: 10,
      scaledLow: 0,
      scaledHigh: 1,
    });
  });

  test("Sinexcel Mini PVDC module templates expose offset write commands", () => {
    const modules = [
      {
        profileName: "pvdc_module_1",
        startAddress: 34161,
        stopAddress: 34162,
        clearFaultAddress: 34163,
        currentLimitAddress: 34222,
      },
      {
        profileName: "pvdc_module_2",
        startAddress: 34461,
        stopAddress: 34462,
        clearFaultAddress: 34463,
        currentLimitAddress: 34522,
      },
      {
        profileName: "pvdc_module_3",
        startAddress: 34761,
        stopAddress: 34762,
        clearFaultAddress: 34763,
        currentLimitAddress: 34822,
      },
    ];

    for (const module of modules) {
      const compiled = buildTemplateWriteProfile(module.profileName, {
        equipmentId: "PVDC",
        serverKey: "PCS_SERVER",
        unitId: 1,
      });

      expect(compiled.profile.tagsById.get("PVDCStart")).toMatchObject({
        tagID: "PVDCStart",
        address: module.startAddress,
      });
      expect(compiled.profile.tagsById.get("PVDCStop")).toMatchObject({
        tagID: "PVDCStop",
        address: module.stopAddress,
      });
      expect(compiled.profile.tagsById.get("PVDCClearFault")).toMatchObject({
        tagID: "PVDCClearFault",
        address: module.clearFaultAddress,
      });
      expect(compiled.profile.tagsById.get("PVBusCurrentLimit")).toMatchObject({
        tagID: "PVBusCurrentLimit",
        address: module.currentLimitAddress,
        rawLow: 0,
        rawHigh: 10,
        scaledLow: 0,
        scaledHigh: 1,
      });
    }
  });

  test("writer runtime compiles then emits modbus-flex-write requests", () => {
    let state = createWriterRuntimeState();

    const compileRes = handleWriterMessage(
      {
        cmd: "compile",
        profileName: "Delta_280_ss40k",
        instance,
      },
      {},
      state
    );
    state = compileRes.state;

    const writeRes = handleWriterMessage(
      {
        cmd: "write",
        topic: "PCS",
        payload: [
          { tagID: "SYSTEM_RUN_MODE", value: 2 },
          { tagID: "SYSTEM_ON_OFF", value: 1 },
        ],
      },
      { MODBUS_ZERO_BASED: false },
      state
    );

    expect(writeRes.out1).toHaveLength(1);
    expect(writeRes.out1?.[0]).toMatchObject({
      topic: "PCS",
      serverKey: "PCS_SERVER",
      unitId: 7,
      fc: 16,
      address: 4096,
      quantity: 2,
      payload: {
        value: [2, 1],
        fc: 16,
        address: 4096,
        quantity: 2,
        unitid: 7,
      },
    });
    expect(writeRes.out3).toEqual({
      payload: expect.objectContaining({
        equipmentId: "PCS",
        state: "write",
        frameCount: 1,
        commandCount: 2,
      }),
    });
  });

  test("writer runtime applies inverse scaling for command values", () => {
    let state = createWriterRuntimeState();

    state = handleWriterMessage(
      {
        cmd: "compile",
        profileName: "Delta_280_ss40k",
        instance,
      },
      {},
      state
    ).state;

    const writeRes = handleWriterMessage(
      {
        cmd: "write",
        topic: "PCS",
        payload: [{ tagID: "SYSTEM_ACTIVE_POWER_DEMAND", value: 0.5 }],
      },
      { MODBUS_ZERO_BASED: false },
      state
    );

    expect(writeRes.out1).toHaveLength(1);
    expect(writeRes.out1?.[0]).toMatchObject({
      fc: 16,
      address: 4103,
      quantity: 1,
      payload: {
        value: [5],
        fc: 16,
        address: 4103,
        quantity: 1,
      },
    });
  });

  test("writer runtime emits single-coil payloads as scalar booleans", () => {
    let state = createWriterRuntimeState();

    state = handleWriterMessage(
      {
        cmd: "compile",
        profile: {
          profileId: "coil_profile",
          commands: [
            {
              name: "ENABLE",
              function: "C",
              address: 25,
            },
          ],
        },
        instance: {
          equipmentId: "GEN",
          serverKey: "GEN_SERVER",
          unitId: 3,
        },
      },
      {},
      state
    ).state;

    const writeRes = handleWriterMessage(
      {
        cmd: "write",
        topic: "GEN",
        payload: [{ tagID: "ENABLE", value: true }],
      },
      { MODBUS_ZERO_BASED: true },
      state
    );

    expect(writeRes.out1).toHaveLength(1);
    expect(writeRes.out1?.[0]).toMatchObject({
      serverKey: "GEN_SERVER",
      fc: 5,
      address: 24,
      quantity: 1,
      payload: {
        value: true,
        fc: 5,
        address: 24,
        quantity: 1,
        unitid: 3,
      },
    });
  });
});
