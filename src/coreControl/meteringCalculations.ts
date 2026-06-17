import type {
  MeteringCalculationConfig,
  MeteringReadingCalculation,
  MeteringReadingKey,
} from "../config";

export interface TelemetrySampleLike {
  tagID: string;
  value: unknown;
}

export type MeteringTelemetryInput =
  | Record<string, unknown>
  | Record<string, TelemetrySampleLike[] | undefined>;

export interface MeteringCalculationDiagnostic {
  reading: MeteringReadingKey;
  status: "missing-config" | "missing-input" | "invalid-value" | "calc-error";
  message: string;
  tagID?: string;
}

export interface MeteringCalculationResult {
  readings: Partial<Record<MeteringReadingKey, number>>;
  diagnostics: MeteringCalculationDiagnostic[];
}

const READING_KEYS: MeteringReadingKey[] = [
  "utilityPowerKw",
  "siteLoadKw",
  "pvKw",
];

export function evaluateMeteringCalculations(
  calculations: MeteringCalculationConfig | undefined,
  telemetry: MeteringTelemetryInput
): MeteringCalculationResult {
  const index = buildTelemetryIndex(telemetry);
  const readings: Partial<Record<MeteringReadingKey, number>> = {};
  const diagnostics: MeteringCalculationDiagnostic[] = [];

  for (const reading of READING_KEYS) {
    const calc = calculations?.[reading];
    if (!calc) {
      diagnostics.push({
        reading,
        status: "missing-config",
        message: "No metering calculation configured",
      });
      continue;
    }

    const value = evaluateReading(reading, calc, index, diagnostics);
    if (value != null) {
      readings[reading] = value;
    }
  }

  return { readings, diagnostics };
}

function evaluateReading(
  reading: MeteringReadingKey,
  calc: MeteringReadingCalculation,
  index: Record<string, unknown>,
  diagnostics: MeteringCalculationDiagnostic[]
): number | null {
  if (calc.source === "tag") {
    return readNumericTag(reading, calc.tagID, index, diagnostics);
  }

  const scope: Record<string, number> = {};
  for (const [name, tagID] of Object.entries(calc.inputs || {})) {
    const value = readNumericTag(reading, tagID, index, diagnostics);
    if (value == null) return null;
    scope[name] = value;
  }

  try {
    const value = evalExpression(calc.expr, scope);
    if (!Number.isFinite(value)) {
      diagnostics.push({
        reading,
        status: "invalid-value",
        message: "Calculation did not produce a finite number",
      });
      return null;
    }
    return value;
  } catch (error) {
    diagnostics.push({
      reading,
      status: "calc-error",
      message: (error as Error).message || "Failed to evaluate calculation",
    });
    return null;
  }
}

function readNumericTag(
  reading: MeteringReadingKey,
  tagID: string,
  index: Record<string, unknown>,
  diagnostics: MeteringCalculationDiagnostic[]
): number | null {
  if (!tagID || !(tagID in index)) {
    diagnostics.push({
      reading,
      status: "missing-input",
      message: "Telemetry input is missing",
      tagID,
    });
    return null;
  }

  const value = Number(index[tagID]);
  if (!Number.isFinite(value)) {
    diagnostics.push({
      reading,
      status: "invalid-value",
      message: "Telemetry input is not numeric",
      tagID,
    });
    return null;
  }

  return value;
}

function buildTelemetryIndex(
  telemetry: MeteringTelemetryInput
): Record<string, unknown> {
  const index: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(telemetry || {})) {
    if (Array.isArray(value)) {
      for (const sample of value) {
        if (!sample?.tagID) continue;
        index[sample.tagID] = sample.value;
      }
      continue;
    }
    index[key] = value;
  }

  return index;
}

function evalExpression(expr: string, scope: Record<string, number>): number {
  if (typeof expr !== "string" || !expr.trim()) {
    throw new Error("Calculation expression is required");
  }

  const names = Object.keys(scope);
  const values = names.map((name) => scope[name]);
  const fn = new Function(
    ...names,
    "Math",
    `"use strict"; return (${expr});`
  ) as (...args: Array<number | Math>) => unknown;

  return Number(fn(...values, Math));
}
