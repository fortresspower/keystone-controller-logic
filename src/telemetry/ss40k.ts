import {
  resolveTelemetryTemplate,
  type TelemetryTemplateDocument,
  type TelemetryTemplateEntry,
} from "./templateAdapter";
import type { SignalMappingConfig } from "../config";
import { evaluateSignalMapping } from "../coreControl/signalMapping";

export interface Ss40kEquipmentConfigEntry {
  profileName: string;
  route?: string;
  template?: TelemetryTemplateDocument;
}

export type Ss40kEquipmentConfig = Record<
  string,
  Ss40kEquipmentConfigEntry | string
>;

export interface Ss40kLookupEntry {
  equipment: string;
  sourceTagID: string;
  profileName: string;
  name: string;
  model: string;
  modelIndex: string;
  exportMultiplier: number;
}

export interface Ss40kBuildLookupResult {
  lookup: Record<string, Ss40kLookupEntry>;
  equipmentToProfile: Record<string, string>;
  routeMap: Record<string, string>;
  modelIndexMap: Record<string, string>;
}

export interface Ss40kTelemetrySample {
  tagID: string;
  value: unknown;
  timestamp?: string | number | Date | null;
  [key: string]: unknown;
}

export type Ss40kTelemetryStore = Record<
  string,
  Ss40kTelemetrySample[] | undefined
>;

export interface Ss40kBuildPayloadOptions {
  lookup: Record<string, Ss40kLookupEntry>;
  telemetry: Ss40kTelemetryStore;
  topic: string;
  version?: string;
  fixedSerialNumber?: string;
  signalMapping?: SignalMappingConfig;
  mergeByModelIndex?: boolean;
}

export interface Ss40kPayloadMeta {
  equipment: string;
  model: string;
  modelIndex: string;
  timestamp: string | null;
  pointCount: number;
}

export interface Ss40kPayloadMessage {
  topic: string;
  payload: Record<
    string,
    {
      fixed: Record<string, unknown>;
      id: number;
      version: string;
    }
  >;
  ss40k: Ss40kPayloadMeta;
}

export const DEFAULT_SS40K_MODEL_INDEX_MAP: Record<string, string> = {
  "40100": "0",
  "40101": "1",
  "40102": "2",
  "40103": "3",
  "40104": "4",
  "40201": "5",
  "40204": "6",
  "40211": "7",
  "40214": "8",
  "42100": "20",
  "42101": "21",
  "42103": "23",
  "42104": "24",
};

export function buildSs40kLookup(
  equipmentConfig: Ss40kEquipmentConfig,
  modelIndexMap: Record<string, string> = DEFAULT_SS40K_MODEL_INDEX_MAP
): Ss40kBuildLookupResult {
  const templateCache: Record<string, TelemetryTemplateDocument> = {};
  const lookup: Record<string, Ss40kLookupEntry> = {};
  const equipmentToProfile: Record<string, string> = {};
  const routeMap: Record<string, string> = {};

  for (const [equipment, rawConfig] of Object.entries(equipmentConfig)) {
    const cfg = normalizeEquipmentConfigEntry(rawConfig);
    equipmentToProfile[equipment] = cfg.profileName;
    if (cfg.route) {
      routeMap[equipment] = cfg.route;
    }

    let template = cfg.template || templateCache[cfg.profileName];
    if (!template) {
      template = resolveTelemetryTemplate(cfg.profileName);
      templateCache[cfg.profileName] = template;
    }

    const telemetryEntries = Array.isArray(template.telemetry)
      ? template.telemetry
      : [];
    for (const entry of telemetryEntries) {
      const lookupEntry = toLookupEntry(equipment, cfg.profileName, entry, modelIndexMap);
      if (!lookupEntry) continue;
      lookup[lookupEntry.sourceTagID] = lookupEntry;
    }
  }

  return {
    lookup,
    equipmentToProfile,
    routeMap,
    modelIndexMap: { ...modelIndexMap },
  };
}

export function buildSs40kFixedPayloads(
  options: Ss40kBuildPayloadOptions
): Ss40kPayloadMessage[] {
  const {
    lookup,
    telemetry,
    topic,
    version = "3.0",
    fixedSerialNumber,
    signalMapping,
    mergeByModelIndex = false,
  } = options;
  const groups: Record<
    string,
    {
      equipment: string;
      model: string;
      modelIndex: string;
      version: string;
      latestTimestamp: string | null;
      fixed: Record<string, unknown>;
    }
  > = {};

  for (const [equipment, samples] of Object.entries(telemetry || {})) {
    if (!Array.isArray(samples)) continue;
    for (const sample of samples) {
      if (!sample || typeof sample.tagID !== "string" || !sample.tagID) continue;
      const meta = lookup[sample.tagID];
      if (!meta) continue;

      const groupKey = mergeByModelIndex
        ? `${meta.modelIndex}::${meta.model}`
        : `${meta.equipment}::${meta.model}`;
      if (!groups[groupKey]) {
        groups[groupKey] = {
          equipment: mergeByModelIndex ? "site" : meta.equipment,
          model: meta.model,
          modelIndex: meta.modelIndex,
          version,
          latestTimestamp: null,
          fixed: {
            ID: Number(meta.model),
          },
        };
      }

      groups[groupKey].fixed[meta.name] =
        meta.name === "SN"
          ? normalizeSerialNumber(sample.value)
          : toFixedValue(sample.value, meta.exportMultiplier);

      const iso = toIsoTimestamp(sample.timestamp);
      if (iso && (!groups[groupKey].latestTimestamp || iso > groups[groupKey].latestTimestamp)) {
        groups[groupKey].latestTimestamp = iso;
      }
    }
  }

  applySiteSignalOverrides(groups, telemetry, signalMapping);
  applyPerEquipmentIdentity(groups, lookup, telemetry);
  applyFixedSerialNumberTo40k(groups, fixedSerialNumber || findSystemSerialNumber(lookup, telemetry));

  return Object.values(groups)
    .sort((a, b) =>
      `${a.equipment}.${a.model}`.localeCompare(`${b.equipment}.${b.model}`)
    )
    .map((group) => ({
      topic,
      payload: {
        [group.modelIndex]: {
          fixed: group.fixed,
          id: Number(group.model),
          version: group.version,
        },
      },
      ss40k: {
        equipment: group.equipment,
        model: group.model,
        modelIndex: group.modelIndex,
        timestamp: group.latestTimestamp,
        pointCount: Object.keys(group.fixed).length,
      },
    }));
}

function applyFixedSerialNumberTo40k(
  groups: Record<string, { model: string; fixed: Record<string, unknown> }>,
  serialNumber: string | null
) {
  if (!serialNumber) return;
  for (const group of Object.values(groups)) {
    if (!group.model.startsWith("40")) continue;
    group.fixed.SN = serialNumber;
  }
}

function applyPerEquipmentIdentity(
  groups: Record<
    string,
    { equipment: string; model: string; fixed: Record<string, unknown> }
  >,
  lookup: Record<string, Ss40kLookupEntry>,
  telemetry: Ss40kTelemetryStore
) {
  const identityByEquipment = findIdentityByEquipment(lookup, telemetry);
  for (const group of Object.values(groups)) {
    if (!group.model.startsWith("42")) continue;
    const identity = identityByEquipment[group.equipment];
    if (!identity) continue;
    if (identity.SN) group.fixed.SN = identity.SN;
    if (identity.BatteryId != null) group.fixed.BatteryId = identity.BatteryId;
  }
}

function findIdentityByEquipment(
  lookup: Record<string, Ss40kLookupEntry>,
  telemetry: Ss40kTelemetryStore
): Record<string, { SN?: string; BatteryId?: unknown }> {
  const out: Record<string, { SN?: string; BatteryId?: unknown }> = {};
  for (const samples of Object.values(telemetry || {})) {
    if (!Array.isArray(samples)) continue;
    for (const sample of samples) {
      if (!sample || typeof sample.tagID !== "string") continue;
      const meta = lookup[sample.tagID];
      if (!meta || !meta.model.startsWith("42")) continue;
      if (meta.name !== "SN" && meta.name !== "BatteryId") continue;
      const identity = (out[meta.equipment] ||= {});
      if (meta.name === "SN") {
        const serial = normalizeSerialNumber(sample.value);
        if (serial) identity.SN = serial;
      } else {
        identity.BatteryId = toFixedValue(sample.value, meta.exportMultiplier);
      }
    }
  }
  return out;
}

function findSystemSerialNumber(
  lookup: Record<string, Ss40kLookupEntry>,
  telemetry: Ss40kTelemetryStore
): string | null {
  const candidates: string[] = [];
  for (const samples of Object.values(telemetry || {})) {
    if (!Array.isArray(samples)) continue;
    for (const sample of samples) {
      if (!sample || typeof sample.tagID !== "string") continue;
      const meta = lookup[sample.tagID];
      const is40kSerial = meta?.name === "SN" && meta.model.startsWith("40");
      const isPcsSerial = /^PCS\.Serial(Number)?$/i.test(sample.tagID);
      if (!is40kSerial && !isPcsSerial) continue;
      const serial = normalizeSerialNumber(sample.value);
      if (!serial) continue;
      if (isPcsSerial) return serial;
      candidates.push(serial);
    }
  }
  return candidates[0] || null;
}

function normalizeSerialNumber(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function applySiteSignalOverrides(
  groups: Record<
    string,
    {
      equipment: string;
      model: string;
      modelIndex: string;
      version: string;
      latestTimestamp: string | null;
      fixed: Record<string, unknown>;
    }
  >,
  telemetry: Ss40kTelemetryStore,
  signalMapping: SignalMappingConfig | undefined
) {
  if (!signalMapping?.signals) return;

  const result = evaluateSignalMapping(signalMapping, telemetry);
  const signals = result.signals;
  const fixed40101 = to40101FixedTargets(groups);
  if (!fixed40101.length) return;

  const setAll = (name: string, value: unknown) => {
    for (const fixed of fixed40101) fixed[name] = value;
  };

  const pvKw = finiteNumber(signals.pvKw);
  if (pvKw !== null) setAll("pPvTotal", Math.round(pvKw * 1000));

  const utilityPowerKw = finiteNumber(signals.utilityPowerKw);
  if (utilityPowerKw !== null) {
    setAll("pGridImpTot", Math.round(Math.max(utilityPowerKw, 0) * 1000));
    setAll("pGridExpTot", Math.round(Math.max(-utilityPowerKw, 0) * 1000));
  }

  const siteLoadKw = finiteNumber(signals.siteLoadKw);
  if (siteLoadKw !== null) setAll("pLoad", Math.round(siteLoadKw * 1000));

  const backupLoadKw = finiteNumber(signals.backupLoadKw);
  if (backupLoadKw !== null) setAll("pBkupTot", Math.round(backupLoadKw * 1000));

  const batteryPowerKw = finiteNumber(signals.batteryPowerKw);
  if (batteryPowerKw !== null) {
    setAll("pBatDischg", Math.round(Math.max(batteryPowerKw, 0) * 1000));
    setAll("pBatChg", Math.round(Math.max(-batteryPowerKw, 0) * 1000));
  }
}

function to40101FixedTargets(
  groups: Record<
    string,
    {
      model: string;
      fixed: Record<string, unknown>;
    }
  >
): Record<string, unknown>[] {
  return Object.values(groups)
    .filter((group) => group.model === "40101")
    .map((group) => group.fixed);
}

function finiteNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeEquipmentConfigEntry(
  rawConfig: Ss40kEquipmentConfigEntry | string
): Ss40kEquipmentConfigEntry {
  if (typeof rawConfig === "string") {
    return { profileName: rawConfig };
  }
  return rawConfig;
}

function toLookupEntry(
  equipment: string,
  profileName: string,
  entry: TelemetryTemplateEntry,
  modelIndexMap: Record<string, string>
): Ss40kLookupEntry | null {
  if (!entry.id || !entry.ss40k?.name || entry.ss40k.model == null) {
    return null;
  }

  const model = String(entry.ss40k.model);
  const exportMultiplier = Number(entry.ss40k.exportMultiplier);

  return {
    equipment,
    sourceTagID: `${equipment}.${entry.id}`,
    profileName,
    name: entry.ss40k.name,
    model,
    modelIndex: modelIndexMap[model] || "0",
    exportMultiplier: Number.isFinite(exportMultiplier)
      ? exportMultiplier
      : 1,
  };
}

function toFixedValue(value: unknown, exportMultiplier: number): unknown {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return value;
  }
  if (!Number.isFinite(exportMultiplier) || exportMultiplier === 1) {
    return value;
  }
  return Math.round(value * exportMultiplier);
}

function toIsoTimestamp(value: unknown): string | null {
  if (value == null) {
    return null;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  return null;
}
