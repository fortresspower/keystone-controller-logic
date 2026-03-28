import * as fs from "fs";
import * as path from "path";

export interface TelemetryTemplateScale {
  mode?: string;
  rawLow?: number;
  rawHigh?: number;
  scaledLow?: number;
  scaledHigh?: number;
  engLow?: number;
  engHigh?: number;
  clamp?: boolean;
}

export interface TelemetryTemplateEntry {
  id: string;
  function: string;
  address: number;
  pollClass?: "fast" | "normal" | "slow" | "startup";
  scale?: TelemetryTemplateScale;
  alarmFlag?: boolean;
  supporting?: boolean;
  statusFlag?: boolean;
}

export interface TelemetryTemplateDocument {
  version: string;
  device: {
    vendor: string;
    model: string;
    protocol: string;
    defaultByteOrder?: "BE" | "LE";
    defaultWordOrder32?: "ABCD" | "CDAB" | "BADC" | "DCBA";
  };
  telemetry: TelemetryTemplateEntry[];
}

export interface NormalizedTelemetryScale {
  mode: "Linear";
  rawLow: number;
  rawHigh: number;
  engLow: number;
  engHigh: number;
  clamp?: boolean;
}

export interface NormalizedTelemetryTag {
  name: string;
  function: string;
  address: number;
  pollClass?: "fast" | "normal" | "slow";
  scale?: NormalizedTelemetryScale;
  alarm?: "Yes" | "No";
  supportingTag?: "Yes" | "No";
  status?: string;
}

export interface NormalizedTelemetryProfile {
  profileId: string;
  defaults: {
    byteOrder: "BE" | "LE";
    wordOrder32: "ABCD" | "CDAB" | "BADC" | "DCBA";
  };
  tags: NormalizedTelemetryTag[];
}

const TEMPLATE_FILE_ALIASES: Record<string, string> = {
  udt_eGauge_V1: "eGauge_280_ss40k.json",
};

function templatesDir() {
  return path.resolve(__dirname, "..", "templates");
}

function fail(message: string): never {
  throw new Error(`Telemetry template error: ${message}`);
}

export function resolveTelemetryTemplatePath(profileName: string): string {
  const directCandidates = [
    profileName,
    `${profileName}.json`,
    TEMPLATE_FILE_ALIASES[profileName],
  ].filter((candidate): candidate is string => !!candidate);

  for (const candidate of directCandidates) {
    const filePath = path.join(templatesDir(), candidate);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }

  fail(`unknown telemetry profile "${profileName}"`);
}

export function resolveTelemetryTemplate(
  profileName: string
): TelemetryTemplateDocument {
  const filePath = resolveTelemetryTemplatePath(profileName);
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  return validateTelemetryTemplate(profileName, parsed);
}

function validateTelemetryTemplate(
  profileName: string,
  doc: unknown
): TelemetryTemplateDocument {
  if (!doc || typeof doc !== "object") {
    fail(`profile "${profileName}" is not a JSON object`);
  }

  const maybeDoc = doc as Partial<TelemetryTemplateDocument>;
  if (!maybeDoc.device || typeof maybeDoc.device !== "object") {
    fail(`profile "${profileName}" is missing device metadata`);
  }
  if (!Array.isArray(maybeDoc.telemetry)) {
    fail(`profile "${profileName}" is missing telemetry[]`);
  }

  maybeDoc.telemetry.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      fail(`profile "${profileName}" telemetry[${index}] is not an object`);
    }
    if (typeof entry.id !== "string" || !entry.id.trim()) {
      fail(`profile "${profileName}" telemetry[${index}] is missing id`);
    }
    if (typeof entry.function !== "string" || !entry.function.trim()) {
      fail(`profile "${profileName}" telemetry[${index}] is missing function`);
    }
    if (typeof entry.address !== "number" || !Number.isFinite(entry.address)) {
      fail(`profile "${profileName}" telemetry[${index}] has invalid address`);
    }
    if (
      entry.scale !== undefined &&
      (!entry.scale || typeof entry.scale !== "object")
    ) {
      fail(`profile "${profileName}" telemetry[${index}] has invalid scale`);
    }
  });

  return maybeDoc as TelemetryTemplateDocument;
}

export function adaptTelemetryTemplateToReadProfile(
  profileName: string,
  template: TelemetryTemplateDocument
): NormalizedTelemetryProfile {
  return {
    profileId: profileName,
    defaults: {
      byteOrder: template.device.defaultByteOrder ?? "BE",
      wordOrder32: template.device.defaultWordOrder32 ?? "ABCD",
    },
    tags: template.telemetry.map((entry, index) =>
      adaptTelemetryEntry(profileName, entry, index)
    ),
  };
}

function adaptTelemetryEntry(
  profileName: string,
  entry: TelemetryTemplateEntry,
  index: number
): NormalizedTelemetryTag {
  const normalized: NormalizedTelemetryTag = {
    name: entry.id,
    function: entry.function,
    address: entry.address,
    alarm: entry.alarmFlag ? "Yes" : "No",
    supportingTag: entry.supporting ? "Yes" : "No",
    status: entry.statusFlag ? "Yes" : "No",
  };

  if (entry.pollClass && entry.pollClass !== "startup") {
    normalized.pollClass = entry.pollClass;
  }

  const scale = normalizeScale(profileName, entry.scale, index);
  if (scale) {
    normalized.scale = scale;
  }

  return normalized;
}

function normalizeScale(
  profileName: string,
  scale: TelemetryTemplateScale | undefined,
  index: number
): NormalizedTelemetryScale | undefined {
  if (!scale || !scale.mode || scale.mode === "none") {
    return undefined;
  }

  if (scale.mode !== "Linear") {
    fail(
      `profile "${profileName}" telemetry[${index}] uses unsupported scale mode "${scale.mode}"`
    );
  }

  const rawLow = Number(scale.rawLow);
  const rawHigh = Number(scale.rawHigh);
  const engLow = Number(scale.engLow ?? scale.scaledLow);
  const engHigh = Number(scale.engHigh ?? scale.scaledHigh);

  if (
    !Number.isFinite(rawLow) ||
    !Number.isFinite(rawHigh) ||
    !Number.isFinite(engLow) ||
    !Number.isFinite(engHigh)
  ) {
    fail(
      `profile "${profileName}" telemetry[${index}] has malformed Linear scale`
    );
  }

  return {
    mode: "Linear",
    rawLow,
    rawHigh,
    engLow,
    engHigh,
    clamp: scale.clamp,
  };
}
