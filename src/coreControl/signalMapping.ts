import type {
  CanonicalSignalKey,
  SignalMappingConfig,
  SignalMappingSignalConfig,
} from "../config";
import type { MeteringTelemetryInput } from "./meteringCalculations";

export interface SignalMappingDiagnostic {
  signal: CanonicalSignalKey;
  status: "missing-config" | "invalid-value" | "calc-error";
  message: string;
  expr?: string;
}

export interface SignalMappingResult {
  signals: Partial<Record<CanonicalSignalKey, number | boolean>>;
  diagnostics: SignalMappingDiagnostic[];
}

const SIGNAL_ORDER: CanonicalSignalKey[] = [
  "utilityPowerKw",
  "pvKw",
  "pcsActivePowerKw",
  "siteLoadKw",
  "backupLoadKw",
  "batteryPowerKw",
  "generatorRunning",
];

export function evaluateSignalMapping(
  signalMapping: SignalMappingConfig | undefined,
  telemetry: MeteringTelemetryInput
): SignalMappingResult {
  const signals: Partial<Record<CanonicalSignalKey, number | boolean>> = {};
  const diagnostics: SignalMappingDiagnostic[] = [];

  if (!signalMapping?.signals) {
    return { signals, diagnostics };
  }

  const telemetryScope = buildTelemetryScope(telemetry);
  for (const signal of SIGNAL_ORDER) {
    const spec = signalMapping.signals[signal];
    if (!spec?.expr) continue;

    const value = evaluateSignal(signal, spec, {
      ...telemetryScope.roots,
      ...signals,
    });

    if (value.ok) {
      signals[signal] = value.value;
    } else {
      diagnostics.push({
        signal,
        status: value.status,
        message: value.message,
        expr: spec.expr,
      });
    }
  }

  return { signals, diagnostics };
}

function evaluateSignal(
  signal: CanonicalSignalKey,
  spec: SignalMappingSignalConfig,
  scope: Record<string, unknown>
):
  | { ok: true; value: number | boolean }
  | { ok: false; status: "invalid-value" | "calc-error"; message: string } {
  try {
    const raw = evalExpression(spec.expr, scope);
    if (typeof raw === "boolean") {
      return { ok: true, value: raw };
    }

    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) {
      return {
        ok: false,
        status: "invalid-value",
        message: `${signal} did not produce a finite number`,
      };
    }

    return { ok: true, value: spec.invertSign ? -numeric : numeric };
  } catch (error) {
    return {
      ok: false,
      status: "calc-error",
      message: (error as Error).message || "Failed to evaluate signal mapping",
    };
  }
}

function buildTelemetryScope(telemetry: MeteringTelemetryInput): {
  roots: Record<string, Record<string, unknown>>;
} {
  const roots: Record<string, Record<string, unknown>> = {};

  function put(tagID: string, value: unknown) {
    const parts = String(tagID).split(".");
    if (parts.length < 2) return;

    const root = parts.shift()!;
    const leaf = parts.join(".");
    roots[root] = roots[root] || {};
    roots[root][leaf] = value;
  }

  for (const [key, value] of Object.entries(telemetry || {})) {
    if (Array.isArray(value)) {
      for (const sample of value) {
        if (sample?.tagID) put(sample.tagID, sample.value);
      }
      continue;
    }

    if (key.includes(".")) {
      put(key, value);
    }
  }

  return { roots };
}

function evalExpression(expr: string, scope: Record<string, unknown>): unknown {
  const deadband = (value: unknown, threshold: unknown) => {
    const numeric = Number(value);
    const limit = Math.abs(Number(threshold) || 0);
    return Math.abs(numeric || 0) < limit ? 0 : numeric;
  };
  const names = Object.keys(scope).concat([
    "deadband",
    "max",
    "min",
    "abs",
    "round",
    "Math",
  ]);
  const values = Object.keys(scope)
    .map((name) => scope[name])
    .concat([deadband, Math.max, Math.min, Math.abs, Math.round, Math]);
  const fn = new Function(
    ...names,
    `"use strict"; return (${expr});`
  ) as (...args: unknown[]) => unknown;

  return fn(...values);
}
