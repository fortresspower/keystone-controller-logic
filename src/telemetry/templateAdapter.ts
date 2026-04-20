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

export interface TelemetryTemplateCalc {
  from?: string;
  inputs?: Record<string, string>;
  expr: string;
}

export interface TelemetryTemplateSs40k {
  name: string;
  model: string | number;
  exportMultiplier?: number;
}

export interface TelemetryTemplateEntry {
  id: string;
  function?: string | null;
  address?: number | null;
  pollClass?: "fast" | "normal" | "slow" | "startup";
  constant?: string | number | boolean | null;
  calc?: TelemetryTemplateCalc;
  scale?: TelemetryTemplateScale;
  alarmFlag?: boolean;
  alarm?: boolean;
  supporting?: boolean;
  supportingTag?: boolean;
  statusFlag?: boolean;
  enumStatus?: Record<string, string>;
  bitfieldStatus?: boolean | Record<string, string>;
  status?: {
    enum?: Record<string, string>;
    bitfieldStatus?: boolean | Record<string, string>;
    flag?: boolean;
  };
  enum?: Record<string, string>;
  ss40k?: TelemetryTemplateSs40k;
}

export interface TelemetryTemplateCommandEntry extends TelemetryTemplateEntry {
  readback?: boolean;
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
  commands?: TelemetryTemplateCommandEntry[];
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
  function?: string;
  address?: number;
  pollClass?: "fast" | "normal" | "slow" | "startup";
  constant?: string | number | boolean | null;
  calc?: {
    inputs: Record<string, string>;
    expr: string;
  };
  virtual?: true;
  scale?: NormalizedTelemetryScale;
  alarm?: "Yes" | "No";
  supportingTag?: "Yes" | "No";
  status?: string;
  enumStatus?: Record<string, string>;
  bitfieldStatus?: boolean | Record<string, string>;
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
  eGauge_280_ss40k: "eGauge_280_ss40k.json",
  egauge_280_ss40k: "eGauge_280_ss40k.json",
  egauge_280: "eGauge_280_ss40k.json",
  egauge: "eGauge_280_ss40k.json",
  udt_eGauge_V1: "eGauge_280_ss40k.json",
};

function templatesDir() {
  return path.resolve(__dirname, "..", "templates");
}

function fail(message: string): never {
  throw new Error(`Telemetry template error: ${message}`);
}

export function resolveTelemetryTemplatePath(profileName: string): string {
  const aliasCandidate = TEMPLATE_FILE_ALIASES[profileName];
  const directCandidates = [
    aliasCandidate,
    profileName,
    `${profileName}.json`,
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
    validateTemplateEntry(profileName, "telemetry", index, entry);
  });

  if (maybeDoc.commands !== undefined) {
    if (!Array.isArray(maybeDoc.commands)) {
      fail(`profile "${profileName}" commands is not an array`);
    }
    maybeDoc.commands.forEach((entry, index) => {
      validateTemplateEntry(profileName, "commands", index, entry);
    });
  }

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
    tags: [
      ...template.telemetry.map((entry, index) =>
        adaptTelemetryEntry(profileName, entry, index)
      ),
      ...((template.commands || [])
        .filter((entry) => entry.readback === true)
        .map((entry, index) =>
          adaptTelemetryEntry(profileName, entry, index, "commands")
        )),
    ],
  };
}

function adaptTelemetryEntry(
  profileName: string,
  entry: TelemetryTemplateEntry,
  index: number,
  section: "telemetry" | "commands" = "telemetry"
): NormalizedTelemetryTag {
  const normalized: NormalizedTelemetryTag = {
    name: entry.id,
    alarm: (entry.alarmFlag ?? entry.alarm) ? "Yes" : "No",
    supportingTag: (entry.supporting ?? entry.supportingTag) ? "Yes" : "No",
    status: (entry.statusFlag ?? entry.status?.flag) ? "Yes" : "No",
  };
  const enumStatus = normalizeEnumStatus(entry);
  if (enumStatus) {
    normalized.enumStatus = enumStatus;
  }
  const bitfieldStatus = normalizeBitfieldStatus(entry);
  if (bitfieldStatus !== undefined) {
    normalized.bitfieldStatus = bitfieldStatus;
  }

  if (entry.constant !== undefined) {
    normalized.constant = entry.constant;
  } else if (entry.calc) {
    normalized.calc = {
      inputs: normalizeCalcInputs(entry.calc),
      expr: entry.calc.expr,
    };
  } else if (entry.function == null && entry.address == null) {
    normalized.virtual = true;
  } else {
    normalized.function = entry.function || undefined;
    normalized.address =
      typeof entry.address === "number" ? entry.address : undefined;
  }

  if (entry.pollClass) {
    normalized.pollClass = entry.pollClass;
  } else if (section === "commands") {
    normalized.pollClass = "normal";
  }

  const scale = normalizeScale(profileName, section, entry.scale, index);
  if (scale) {
    normalized.scale = scale;
  }

  return normalized;
}

function normalizeScale(
  profileName: string,
  section: "telemetry" | "commands",
  scale: TelemetryTemplateScale | undefined,
  index: number
): NormalizedTelemetryScale | undefined {
  if (!scale || !scale.mode || scale.mode === "none") {
    return undefined;
  }

  if (scale.mode !== "Linear") {
    fail(
      `profile "${profileName}" ${section}[${index}] uses unsupported scale mode "${scale.mode}"`
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
      `profile "${profileName}" ${section}[${index}] has malformed Linear scale`
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

function normalizeCalcInputs(calc: TelemetryTemplateCalc): Record<string, string> {
  if (calc.inputs && typeof calc.inputs === "object") {
    return Object.fromEntries(
      Object.entries(calc.inputs).filter(
        ([key, value]) =>
          typeof key === "string" &&
          !!key.trim() &&
          typeof value === "string" &&
          !!value.trim()
      )
    );
  }

  if (typeof calc.from === "string" && calc.from.trim()) {
    return { x: calc.from };
  }

  return {};
}

function normalizeEnumStatus(
  entry: TelemetryTemplateEntry | TelemetryTemplateCommandEntry
): Record<string, string> | undefined {
  const candidate = entry.enumStatus ?? entry.enum ?? entry.status?.enum;
  if (!candidate || typeof candidate !== "object") {
    return undefined;
  }

  const normalized = Object.fromEntries(
    Object.entries(candidate).filter(
      ([key, value]) =>
        typeof key === "string" &&
        !!key.trim() &&
        typeof value === "string" &&
        !!value.trim()
    )
  );

  return Object.keys(normalized).length ? normalized : undefined;
}

function normalizeBitfieldStatus(
  entry: TelemetryTemplateEntry | TelemetryTemplateCommandEntry
): boolean | Record<string, string> | undefined {
  const candidate = entry.bitfieldStatus ?? entry.status?.bitfieldStatus;
  if (candidate === true) {
    return true;
  }
  if (!candidate || typeof candidate !== "object") {
    return undefined;
  }

  const normalized = Object.fromEntries(
    Object.entries(candidate).filter(
      ([key, value]) =>
        typeof key === "string" &&
        !!key.trim() &&
        typeof value === "string" &&
        !!value.trim()
    )
  );

  return Object.keys(normalized).length ? normalized : undefined;
}

function validateTemplateEntry(
  profileName: string,
  section: "telemetry" | "commands",
  index: number,
  entry: TelemetryTemplateEntry | TelemetryTemplateCommandEntry
) {
  if (!entry || typeof entry !== "object") {
    fail(`profile "${profileName}" ${section}[${index}] is not an object`);
  }
  if (typeof entry.id !== "string" || !entry.id.trim()) {
    fail(`profile "${profileName}" ${section}[${index}] is missing id`);
  }
  const hasConstant = Object.prototype.hasOwnProperty.call(entry, "constant");
  const hasCalc = !!entry.calc;
  const hasFunction = typeof entry.function === "string" && !!entry.function.trim();
  const hasAddress = typeof entry.address === "number" && Number.isFinite(entry.address);
  const hasPhysical = hasFunction && hasAddress;
  const isVirtualPlaceholder =
    entry.function == null &&
    entry.address == null &&
    !hasConstant &&
    !hasCalc;
  const sourceCount =
    Number(hasConstant) + Number(hasCalc) + Number(hasPhysical) + Number(isVirtualPlaceholder);

  if (sourceCount === 0) {
    fail(`profile "${profileName}" ${section}[${index}] is missing function/address, constant, or calc`);
  }
  if (sourceCount > 1) {
    fail(`profile "${profileName}" ${section}[${index}] mixes multiple source types`);
  }
  if (hasCalc) {
    const inputs = normalizeCalcInputs(entry.calc!);
    const expr = entry.calc?.expr;
    if (!Object.keys(inputs).length || typeof expr !== "string" || !expr.trim()) {
      fail(`profile "${profileName}" ${section}[${index}] has malformed calc`);
    }
  }
  if (!hasConstant && !hasCalc && !hasAddress && !isVirtualPlaceholder) {
    fail(`profile "${profileName}" ${section}[${index}] has invalid address`);
  }
  if (
    entry.scale !== undefined &&
    (!entry.scale || typeof entry.scale !== "object")
  ) {
    fail(`profile "${profileName}" ${section}[${index}] has invalid scale`);
  }
  if (
    entry.ss40k !== undefined &&
    (!entry.ss40k ||
      typeof entry.ss40k !== "object" ||
      typeof entry.ss40k.name !== "string" ||
      (typeof entry.ss40k.model !== "string" &&
        typeof entry.ss40k.model !== "number") ||
      (entry.ss40k.exportMultiplier !== undefined &&
        (typeof entry.ss40k.exportMultiplier !== "number" ||
          !Number.isFinite(entry.ss40k.exportMultiplier))))
  ) {
    fail(`profile "${profileName}" ${section}[${index}] has invalid ss40k metadata`);
  }
}
