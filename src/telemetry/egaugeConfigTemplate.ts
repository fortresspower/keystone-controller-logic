import type {
  MeteringConfig,
  MeteringRegisterMapping,
  MeteringRegisterSignalKey,
} from "../config";
import type {
  TelemetryTemplateDocument,
  TelemetryTemplateEntry,
} from "./templateAdapter";

const DEFAULT_TAG_IDS: Record<MeteringRegisterSignalKey, string> = {
  utilityPowerKw: "Utility_Total_Power",
  gridImportPowerKw: "Utility_Import_Power",
  gridExportPowerKw: "Utility_Export_Power",
  siteLoadKw: "Load_Active_Power",
  pvKw: "PV_Total_Power",
  backupLoadKw: "Backup_Load_Total_Power",
  frequencyHz: "MTR_F_GRID",
  voltageL1N: "MTR_V_GRID_L1N",
  voltageL2N: "MTR_V_GRID_L2N",
  voltageL3N: "MTR_V_GRID_L3N",
  voltageL1L2: "MTR_V_GRID_L1L2",
  voltageL2L3: "MTR_V_GRID_L2L3",
  voltageL3L1: "MTR_V_GRID_L3L1",
  energyImportKwh: "Energy_Import",
  energyExportKwh: "Energy_Export",
  custom: "Custom",
};

const DEFAULT_SS40K: Partial<Record<MeteringRegisterSignalKey, string>> = {
  gridImportPowerKw: "pGridImpTot",
  gridExportPowerKw: "pGridExpTot",
  siteLoadKw: "pLoad",
  pvKw: "pPvTotal",
  backupLoadKw: "pBkupTot",
  frequencyHz: "fGrid",
  voltageL1N: "vGridL1N",
  voltageL2N: "vGridL2N",
  voltageL3N: "vGridL3N",
  voltageL1L2: "vGridL1L2",
  voltageL2L3: "vGridL2L3",
  voltageL3L1: "vGridL3L1",
};

const POWER_SIGNALS = new Set<MeteringRegisterSignalKey>([
  "utilityPowerKw",
  "gridImportPowerKw",
  "gridExportPowerKw",
  "siteLoadKw",
  "pvKw",
  "backupLoadKw",
]);

export function buildConfiguredEgaugeTemplate(
  metering: MeteringConfig,
  profileName = "configured_eGauge"
): TelemetryTemplateDocument | null {
  const registerMap = Array.isArray(metering.registerMap)
    ? metering.registerMap.filter(isUsableMapping)
    : [];

  if (!registerMap.length) return null;

  const telemetry = registerMap.map((mapping) => toTemplateEntry(mapping));
  addDerivedPowerTags(telemetry, registerMap);

  return {
    version: "2",
    device: {
      vendor: "eGauge",
      model: profileName,
      protocol: "modbus-tcp",
      name: profileName,
      sourceFormat: "site-config-register-map",
      defaultByteOrder: "BE",
      defaultWordOrder32: "ABCD",
      notes:
        "Generated from siteConfig.metering.registerMap. Register addresses are site-specific eGauge Modbus addresses.",
    },
    telemetry,
  };
}

function isUsableMapping(mapping: MeteringRegisterMapping | undefined): mapping is MeteringRegisterMapping {
  return !!mapping && !!mapping.signal && Number.isFinite(Number(mapping.register)) && !!mapping.function;
}

function toTemplateEntry(mapping: MeteringRegisterMapping): TelemetryTemplateEntry {
  const tagId = normalizeTagId(mapping);
  const scale = Number(mapping.scale ?? 1);
  const sign = mapping.sign === -1 ? -1 : 1;
  const multiplier = Number.isFinite(scale) ? scale * sign : sign;
  const entry: TelemetryTemplateEntry = {
    id: tagId,
    description: mapping.description,
    function: mapping.function,
    address: Number(mapping.register),
    pollClass: mapping.pollClass || "fast",
    supportingTag: mapping.supportingTag ?? !mapping.ss40kName,
  };

  if (multiplier !== 1 || Number(mapping.offset || 0) !== 0) {
    entry.scale = {
      mode: "Linear",
      rawLow: 0,
      rawHigh: 1,
      scaledLow: Number(mapping.offset || 0),
      scaledHigh: Number(mapping.offset || 0) + multiplier,
    };
  }

  const ss40kName = mapping.ss40kName || DEFAULT_SS40K[mapping.signal];
  if (ss40kName && mapping.signal !== "utilityPowerKw") {
    entry.ss40k = {
      name: ss40kName,
      model: "40101",
      exportMultiplier: POWER_SIGNALS.has(mapping.signal) ? 1000 : undefined,
    };
    entry.supportingTag = mapping.supportingTag ?? false;
  }

  return entry;
}

function addDerivedPowerTags(
  telemetry: TelemetryTemplateEntry[],
  registerMap: MeteringRegisterMapping[]
) {
  const utility = registerMap.find((mapping) => mapping.signal === "utilityPowerKw");
  if (utility) {
    const utilityTag = normalizeTagId(utility);
    addCalcIfMissing(telemetry, "Utility_Import_Power", "pGridImpTot", {
      utility: utilityTag,
    }, "max(utility, 0)");
    addCalcIfMissing(telemetry, "Utility_Export_Power", "pGridExpTot", {
      utility: utilityTag,
    }, "max(-utility, 0)");
  }

  const siteLoad = registerMap.find((mapping) => mapping.signal === "siteLoadKw");
  if (siteLoad) {
    const tagId = normalizeTagId(siteLoad);
    addCalcIfMissing(telemetry, "Load_Active_Power", "pLoad", { load: tagId }, "load");
  } else {
    const backupLoad = registerMap.find((mapping) => mapping.signal === "backupLoadKw");
    if (backupLoad) {
      const tagId = normalizeTagId(backupLoad);
      addCalcIfMissing(telemetry, "Load_Active_Power", "pLoad", { load: tagId }, "load");
    }
  }

  const pv = registerMap.find((mapping) => mapping.signal === "pvKw");
  if (pv) {
    const tagId = normalizeTagId(pv);
    addCalcIfMissing(telemetry, "PV_Total_Power", "pPvTotal", { pv: tagId }, "pv");
  }
}

function addCalcIfMissing(
  telemetry: TelemetryTemplateEntry[],
  id: string,
  ss40kName: string,
  inputs: Record<string, string>,
  expr: string
) {
  if (telemetry.some((entry) => entry.id === id)) return;
  telemetry.push({
    id,
    pollClass: "fast",
    calc: { inputs, expr },
    ss40k: {
      name: ss40kName,
      model: "40101",
      exportMultiplier: 1000,
    },
  });
}

function normalizeTagId(mapping: MeteringRegisterMapping): string {
  const raw = mapping.tagID || DEFAULT_TAG_IDS[mapping.signal] || mapping.signal;
  const withoutEquipment = raw.includes(".") ? raw.split(".").slice(1).join(".") : raw;
  return withoutEquipment.replace(/[^A-Za-z0-9_]/g, "_");
}
