// src/templates/loader.ts
import type { UdtTemplate, UdtTag } from "./types";
import type { Endian } from "../types";

// Import your existing JSON templates:
import raw_eGauge_V1 from "./udt_eGauge_V1.json";
import raw_DELTA_125VH_V3 from "./udt_DELTA_125VH_V3.json";
import raw_CATL_MBMU_V17 from "./udt_CATL_MBMU_V17.json";

type LegacyTemplate = {
  name: string;
  defaultEndian?: Endian | "CDAB" | "DCBA";
  tags: any[];
};

function normalizeBool(v: any): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.toLowerCase();
    if (s === "yes" || s === "true") return true;
    if (s === "no" || s === "false") return false;
  }
  return undefined;
}

function normalizeMask(v: any): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    if (v.toLowerCase() === "nan") return undefined;
    const parsed = parseInt(v, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

function normalizeScaleMode(v: any): "off" | "linear" | undefined {
  if (!v) return undefined;
  const s = String(v).toLowerCase();
  if (s === "off") return "off";
  if (s === "linear") return "linear";
  return undefined;
}

function normalizeTag(raw: any): UdtTag {
  const tag: UdtTag = {
    name: raw.name,
    modbusType: raw.modbusType,                          // keep your existing types (HR, IRUS, HRI, etc.)
    modbusAddress: Number(raw.modbusAddress ?? raw.address ?? 0),

    scaleMode: normalizeScaleMode(raw.scaleMode),
    rawLow: raw.rawLow ?? undefined,
    rawHigh: raw.rawHigh ?? undefined,
    scaledLow: raw.scaledLow ?? undefined,
    scaledHigh: raw.scaledHigh ?? undefined,

    unit: raw.unit ?? undefined,

    alarm: normalizeBool(raw.alarm),
    supportingTag: normalizeBool(raw.supportingTag),

    mask: normalizeMask(raw.mask),

    description: raw.description ?? undefined
  };

  // We deliberately ignore:
  // - tagType
  // - mapPrefix / mapIndex
  // - enabled
  // - any other weird legacy fields

  // If/when you start adding statusList/bitfieldStatus in templates,
  // they'll come through as-is because we're not touching them here.

  return tag;
}

function normalizeTemplate(raw: LegacyTemplate): UdtTemplate {
  return {
    name: raw.name,
    defaultEndian: raw.defaultEndian ?? "BE",   // or whatever is correct per-device later
    tags: (raw.tags || []).map(normalizeTag)
  };
}

export const templates: Record<string, UdtTemplate> = {
  udt_eGauge_V1: normalizeTemplate(raw_eGauge_V1 as LegacyTemplate),
  udt_DELTA_125VH_V3: normalizeTemplate(raw_DELTA_125VH_V3 as LegacyTemplate),
  udt_CATL_MBMU_V17: normalizeTemplate(raw_CATL_MBMU_V17 as LegacyTemplate)
};
