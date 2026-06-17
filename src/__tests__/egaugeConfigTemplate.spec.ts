import {
  adaptTelemetryTemplateToReadProfile,
  buildConfiguredEgaugeTemplate,
  buildSs40kLookup,
} from "../telemetry";
import type { MeteringConfig } from "../config";

describe("configured eGauge register map template", () => {
  test("builds a site-specific eGauge template from canonical register rows", () => {
    const metering: MeteringConfig = {
      meterType: "eGauge",
      modbusProfile: "configured_eGauge",
      ip: "192.168.1.64",
      reads: {
        pv: true,
        pvFromInverter: false,
        utility: true,
        load: true,
      },
      registerMap: [
        {
          signal: "utilityPowerKw",
          tagID: "Meter.Utility_Total_Power",
          register: 9020,
          function: "IRF",
          scale: 0.001,
          sign: 1,
        },
        {
          signal: "siteLoadKw",
          tagID: "Meter.Load_Active_Power_Raw",
          register: 9032,
          function: "IRF",
          scale: 0.001,
        },
        {
          signal: "pvKw",
          tagID: "Meter.PV_Total_Power_Raw",
          register: 9040,
          function: "IRF",
          scale: 0.001,
          sign: -1,
        },
      ],
    };

    const template = buildConfiguredEgaugeTemplate(metering, "site_eGauge");

    expect(template).not.toBeNull();
    expect(template?.device.sourceFormat).toBe("site-config-register-map");
    expect(template?.telemetry).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "Utility_Total_Power",
          function: "IRF",
          address: 9020,
          scale: expect.objectContaining({ rawHigh: 1, scaledHigh: 0.001 }),
        }),
        expect.objectContaining({
          id: "Utility_Import_Power",
          calc: {
            inputs: { utility: "Utility_Total_Power" },
            expr: "max(utility, 0)",
          },
          ss40k: expect.objectContaining({ name: "pGridImpTot" }),
        }),
        expect.objectContaining({
          id: "Utility_Export_Power",
          calc: {
            inputs: { utility: "Utility_Total_Power" },
            expr: "max(-utility, 0)",
          },
          ss40k: expect.objectContaining({ name: "pGridExpTot" }),
        }),
        expect.objectContaining({
          id: "Load_Active_Power",
          calc: {
            inputs: { load: "Load_Active_Power_Raw" },
            expr: "load",
          },
          ss40k: expect.objectContaining({ name: "pLoad" }),
        }),
        expect.objectContaining({
          id: "PV_Total_Power",
          calc: {
            inputs: { pv: "PV_Total_Power_Raw" },
            expr: "pv",
          },
          ss40k: expect.objectContaining({ name: "pPvTotal" }),
        }),
      ])
    );
  });

  test("generated template normalizes and exports through SS40K lookup", () => {
    const template = buildConfiguredEgaugeTemplate({
      meterType: "eGauge",
      modbusProfile: "configured_eGauge",
      ip: "192.168.1.64",
      reads: { pv: false, pvFromInverter: false, utility: true, load: true },
      registerMap: [
        {
          signal: "utilityPowerKw",
          tagID: "Meter.POI",
          register: 100,
          function: "HRF",
        },
        {
          signal: "siteLoadKw",
          tagID: "Meter.Load",
          register: 102,
          function: "HRF",
        },
      ],
    });

    expect(template).not.toBeNull();
    const profile = adaptTelemetryTemplateToReadProfile("Meter", template!);
    expect(profile.tags.map((tag) => tag.name)).toEqual(
      expect.arrayContaining([
        "POI",
        "Load",
        "Utility_Import_Power",
        "Utility_Export_Power",
        "Load_Active_Power",
      ])
    );

    expect(profile.tags.map((tag) => tag.name)).toContain("Utility_Import_Power");

    const lookup = buildSs40kLookup({
      Meter: { profileName: "configured_eGauge", route: "Meter", template: template! },
    });

    expect(lookup.lookup["Meter.Utility_Import_Power"]).toMatchObject({
      model: "40101",
      name: "pGridImpTot",
    });
    expect(lookup.lookup["Meter.Load_Active_Power"]).toMatchObject({
      model: "40101",
      name: "pLoad",
    });
  });

  test("can model Assisted Living eGauge rows from site config", () => {
    const template = buildConfiguredEgaugeTemplate({
      meterType: "eGauge",
      modbusProfile: "configured_eGauge",
      ip: "192.168.1.64",
      reads: { pv: false, pvFromInverter: false, utility: true, load: true },
      registerMap: [
        { signal: "voltageL1N", tagID: "Meter.L1_Voltage", register: 9002, function: "IRF", ss40kName: "vGridL1N" },
        { signal: "voltageL2N", tagID: "Meter.L2_Voltage", register: 9004, function: "IRF", ss40kName: "vGridL2N" },
        { signal: "voltageL3N", tagID: "Meter.L3_Voltage", register: 9006, function: "IRF", ss40kName: "vGridL3N" },
        { signal: "custom", tagID: "Meter.Utility_L1_Power", register: 9014, function: "IRF", scale: 0.001, ss40kName: "pGridL1" },
        { signal: "custom", tagID: "Meter.Utility_L2_Power", register: 9016, function: "IRF", scale: 0.001, ss40kName: "pGridL2" },
        { signal: "custom", tagID: "Meter.Utility_L3_Power", register: 9018, function: "IRF", scale: 0.001, ss40kName: "pGridL3" },
        { signal: "utilityPowerKw", tagID: "Meter.Utility_Total_Power", register: 9020, function: "IRF", scale: 0.001, supportingTag: true },
        { signal: "custom", tagID: "Meter.Backup_Load_L1_Power", register: 9028, function: "IRF", scale: 0.001, ss40kName: "pLoadL1" },
        { signal: "custom", tagID: "Meter.Backup_Load_L2_Power", register: 9030, function: "IRF", scale: 0.001, ss40kName: "pLoadL2" },
        { signal: "custom", tagID: "Meter.Backup_Load_L3_Power", register: 9000, function: "IRF", scale: 0.001, ss40kName: "pLoadL3" },
        { signal: "backupLoadKw", tagID: "Meter.Backup_Load_Total_Power", register: 9032, function: "IRF", scale: 0.001, ss40kName: "pBkupTot" },
      ],
    }, "assisted_living_eGauge");

    expect(template).not.toBeNull();
    expect(template?.telemetry).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "L1_Voltage", address: 9002, ss40k: expect.objectContaining({ name: "vGridL1N" }) }),
        expect.objectContaining({ id: "Utility_L1_Power", address: 9014, ss40k: expect.objectContaining({ name: "pGridL1" }) }),
        expect.objectContaining({ id: "Utility_Total_Power", address: 9020, supportingTag: true }),
        expect.objectContaining({ id: "Backup_Load_Total_Power", address: 9032, ss40k: expect.objectContaining({ name: "pBkupTot" }) }),
        expect.objectContaining({
          id: "Load_Active_Power",
          calc: {
            inputs: { load: "Backup_Load_Total_Power" },
            expr: "load",
          },
          ss40k: expect.objectContaining({ name: "pLoad" }),
        }),
      ])
    );

    const lookup = buildSs40kLookup({
      Meter: { profileName: "configured_eGauge", route: "Meter", template: template! },
    });
    expect(lookup.lookup["Meter.Load_Active_Power"]).toMatchObject({ name: "pLoad" });
    expect(lookup.lookup["Meter.Backup_Load_Total_Power"]).toMatchObject({ name: "pBkupTot" });
  });

  test("returns null without register rows", () => {
    expect(
      buildConfiguredEgaugeTemplate({
        meterType: "eGauge",
        modbusProfile: "configured_eGauge",
        ip: "192.168.1.64",
        reads: { pv: false, pvFromInverter: false, utility: false, load: false },
      })
    ).toBeNull();
  });
});
