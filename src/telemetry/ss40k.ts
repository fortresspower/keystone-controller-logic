import {
  resolveTelemetryTemplate,
  type TelemetryTemplateEntry,
} from "./templateAdapter";

export interface Ss40kEquipmentConfigEntry {
  profileName: string;
  route?: string;
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
};

export function buildSs40kLookup(
  equipmentConfig: Ss40kEquipmentConfig,
  modelIndexMap: Record<string, string> = DEFAULT_SS40K_MODEL_INDEX_MAP
): Ss40kBuildLookupResult {
  const templateCache: Record<string, ReturnType<typeof resolveTelemetryTemplate>> =
    {};
  const lookup: Record<string, Ss40kLookupEntry> = {};
  const equipmentToProfile: Record<string, string> = {};
  const routeMap: Record<string, string> = {};

  for (const [equipment, rawConfig] of Object.entries(equipmentConfig)) {
    const cfg = normalizeEquipmentConfigEntry(rawConfig);
    equipmentToProfile[equipment] = cfg.profileName;
    if (cfg.route) {
      routeMap[equipment] = cfg.route;
    }

    let template = templateCache[cfg.profileName];
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
  const { lookup, telemetry, topic, version = "3.0" } = options;
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

      const groupKey = `${meta.equipment}::${meta.model}`;
      if (!groups[groupKey]) {
        groups[groupKey] = {
          equipment: meta.equipment,
          model: meta.model,
          modelIndex: meta.modelIndex,
          version,
          latestTimestamp: null,
          fixed: {
            ID: Number(meta.model),
          },
        };
      }

      groups[groupKey].fixed[meta.name] = toFixedValue(
        sample.value,
        meta.exportMultiplier
      );

      const iso = toIsoTimestamp(sample.timestamp);
      if (iso && (!groups[groupKey].latestTimestamp || iso > groups[groupKey].latestTimestamp)) {
        groups[groupKey].latestTimestamp = iso;
      }
    }
  }

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
