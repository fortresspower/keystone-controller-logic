import * as fs from "fs";
import * as path from "path";
import { isDeepStrictEqual } from "util";
import type { SiteConfig, CustomGridProfile } from "../config";
import { deriveCapabilities, type SiteCapabilities } from "../capabilities";

const yaml = require("js-yaml") as { load: (src: string) => unknown };

export type CloudFieldType = "String" | "Number" | "enum16";

export interface CloudFieldRange {
  min?: number;
  max?: number;
}

export interface CloudFieldSpec {
  arg: string;
  dtype: CloudFieldType;
  meanings?: Record<string, string>;
  range?: CloudFieldRange;
}

export interface CloudCommandSpec {
  commandId: string;
  title: string;
  fields: Record<string, CloudFieldSpec>;
}

export interface CloudConfigSpec {
  commands: Record<string, CloudCommandSpec>;
}

export interface CloudConfigUpdate {
  commandId?: string;
  command_id?: string;
  values: Record<string, unknown>;
}

export interface NormalizedCloudConfigUpdate {
  commandId: string;
  values: Record<string, unknown>;
}

export interface SiteConfigValidationIssue {
  path: string;
  message: string;
}

export type ApplyClassification = "hot" | "restart";

export interface ConfigApplyDiagnostic {
  commandId: string;
  arg?: string;
  path?: string;
  status: "applied" | "applied-restart-required" | "rejected";
  classification?: ApplyClassification;
  message?: string;
}

export interface SiteConfigApplyResult {
  success: boolean;
  nextConfig: SiteConfig;
  nextCapabilities: SiteCapabilities;
  restartRequired: boolean;
  diagnostics: ConfigApplyDiagnostic[];
  validationIssues: SiteConfigValidationIssue[];
}

type ApplyArgResult = {
  changed: boolean;
  path: string;
  classification: ApplyClassification;
};

type ParsedPoint = {
  command_id?: string;
  title?: string;
  entries?: Array<{
    arg?: string;
    dtype?: string;
    meanings?: Record<string, string>;
    range?: CloudFieldRange;
  }>;
};

function specYamlPath() {
  const candidates = [
    path.resolve(__dirname, "..", "coreControl", "keystone_ci_addition.yaml"),
    path.resolve(process.cwd(), "src", "coreControl", "keystone_ci_addition.yaml"),
    path.resolve(process.cwd(), "dist", "coreControl", "keystone_ci_addition.yaml"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("Cannot locate keystone_ci_addition.yaml");
}

let cachedSpec: CloudConfigSpec | null = null;

export function loadSiteConfigCommandSpec(forceReload = false): CloudConfigSpec {
  if (cachedSpec && !forceReload) return cachedSpec;

  const raw = fs.readFileSync(specYamlPath(), "utf8");
  const parsed = yaml.load(raw) as { points?: ParsedPoint[] };
  const points = Array.isArray(parsed?.points) ? parsed.points : [];

  const commands: Record<string, CloudCommandSpec> = {};

  for (const point of points) {
    if (!point || typeof point !== "object") continue;
    const commandId = point.command_id;
    if (!commandId || typeof commandId !== "string") continue;

    const fields: Record<string, CloudFieldSpec> = {};
    const entries = Array.isArray(point.entries) ? point.entries : [];

    for (const entry of entries) {
      const arg = entry?.arg;
      const dtype = entry?.dtype;
      if (!arg || typeof arg !== "string") continue;
      if (dtype !== "String" && dtype !== "Number" && dtype !== "enum16") continue;

      fields[arg] = {
        arg,
        dtype,
        meanings:
          entry?.meanings && typeof entry.meanings === "object"
            ? entry.meanings
            : undefined,
        range:
          entry?.range && typeof entry.range === "object"
            ? entry.range
            : undefined,
      };
    }

    commands[commandId] = {
      commandId,
      title: point.title || commandId,
      fields,
    };
  }

  cachedSpec = { commands };
  return cachedSpec;
}

export function normalizeCloudConfigUpdates(
  updates: CloudConfigUpdate[]
): NormalizedCloudConfigUpdate[] {
  return updates
    .map((update) => ({
      commandId: String(update.commandId || update.command_id || "").trim(),
      values: update.values || {},
    }))
    .filter((update) => !!update.commandId);
}

export function applyCloudConfigUpdates(
  currentConfig: SiteConfig,
  updates: CloudConfigUpdate[],
  spec: CloudConfigSpec = loadSiteConfigCommandSpec()
): SiteConfigApplyResult {
  const diagnostics: ConfigApplyDiagnostic[] = [];
  const normalizedUpdates = normalizeCloudConfigUpdates(updates);
  const working = cloneConfig(currentConfig);

  for (const update of normalizedUpdates) {
    const command = spec.commands[update.commandId];
    if (!command) {
      diagnostics.push({
        commandId: update.commandId,
        status: "rejected",
        message: "Unknown commandId",
      });
      continue;
    }

    for (const [arg, rawValue] of Object.entries(update.values || {})) {
      const fieldSpec = command.fields[arg];
      if (!fieldSpec) {
        diagnostics.push({
          commandId: update.commandId,
          arg,
          status: "rejected",
          message: "Unknown arg for command",
        });
        continue;
      }

      const converted = convertCloudValue(rawValue, fieldSpec);
      if (!converted.ok) {
        diagnostics.push({
          commandId: update.commandId,
          arg,
          status: "rejected",
          message: converted.error,
        });
        continue;
      }

      let applied: ApplyArgResult | null = null;
      try {
        applied = applyArgToSiteConfig(working, arg, converted.value);
      } catch (error) {
        diagnostics.push({
          commandId: update.commandId,
          arg,
          status: "rejected",
          message: (error as Error).message || "Failed to apply arg",
        });
        continue;
      }
      if (!applied) {
        diagnostics.push({
          commandId: update.commandId,
          arg,
          status: "rejected",
          message: "Arg is valid but has no SiteConfig mapping",
        });
        continue;
      }

      if (!applied.changed) continue;

      diagnostics.push({
        commandId: update.commandId,
        arg,
        path: applied.path,
        status:
          applied.classification === "restart"
            ? "applied-restart-required"
            : "applied",
        classification: applied.classification,
      });
    }
  }

  const validationIssues = validateSiteConfig(working);
  if (validationIssues.length) {
    return {
      success: false,
      nextConfig: cloneConfig(currentConfig),
      nextCapabilities: deriveCapabilities(currentConfig),
      restartRequired: false,
      diagnostics: [
        ...diagnostics,
        ...validationIssues.map((issue) => ({
          commandId: "(post-apply)",
          path: issue.path,
          status: "rejected" as const,
          message: issue.message,
        })),
      ],
      validationIssues,
    };
  }

  const restartRequired = diagnostics.some(
    (d) => d.status === "applied-restart-required"
  );

  return {
    success: true,
    nextConfig: working,
    nextCapabilities: deriveCapabilities(working),
    restartRequired,
    diagnostics,
    validationIssues: [],
  };
}

function cloneConfig(config: SiteConfig): SiteConfig {
  return JSON.parse(JSON.stringify(config)) as SiteConfig;
}

function convertCloudValue(
  raw: unknown,
  field: CloudFieldSpec
): { ok: true; value: unknown } | { ok: false; error: string } {
  switch (field.dtype) {
    case "String": {
      if (typeof raw !== "string") {
        return { ok: false, error: "Expected String" };
      }
      return { ok: true, value: raw };
    }

    case "Number": {
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        return { ok: false, error: "Expected Number" };
      }
      if (field.range?.min != null && value < field.range.min) {
        return {
          ok: false,
          error: `Value below minimum ${field.range.min}`,
        };
      }
      if (field.range?.max != null && value > field.range.max) {
        return {
          ok: false,
          error: `Value above maximum ${field.range.max}`,
        };
      }
      return { ok: true, value };
    }

    case "enum16": {
      const meanings = field.meanings || {};
      if (!Object.keys(meanings).length) {
        return { ok: false, error: "enum16 field missing meanings" };
      }

      if (typeof raw === "number" || (typeof raw === "string" && /^\d+$/.test(raw.trim()))) {
        const key = String(raw).trim();
        const label = meanings[key];
        if (typeof label !== "string") {
          return { ok: false, error: `Invalid enum key: ${key}` };
        }
        return { ok: true, value: label };
      }

      if (typeof raw === "string") {
        const label = raw.trim();
        const matched = Object.values(meanings).find((candidate) => candidate === label);
        if (!matched) {
          return { ok: false, error: `Invalid enum label: ${label}` };
        }
        return { ok: true, value: matched };
      }

      return { ok: false, error: "Expected enum16 key or label" };
    }

    default:
      return { ok: false, error: "Unsupported field dtype" };
  }
}

function applyArgToSiteConfig(
  config: SiteConfig,
  arg: string,
  value: unknown
): ApplyArgResult | null {
  switch (arg) {
    case "SystemProfile":
      return setPath(config, "system.systemProfile", mustString(value), "restart");
    case "ControllerTimezone":
      return setPath(config, "system.controllerTimezone", mustString(value), "hot");
    case "ControllerIp":
      return setPath(config, "network.controller.ip", mustString(value), "hot");
    case "ModbusServerIp":
      return setPath(config, "network.controller.modbusServer.ip", mustString(value), "hot");
    case "ModbusServerPort":
      return setPath(config, "network.controller.modbusServer.port", mustNumber(value), "hot");

    case "GridCode":
      return setPath(config, "operation.gridCode", mustString(value), "hot");

    case "CustomGridProfileJson": {
      const profile = parseCustomGridProfile(mustString(value));
      return setPath(config, "operation.customGridProfile", profile, "hot");
    }

    case "CRDMode":
      return setPath(config, "operation.crdMode", mustString(value), "hot");

    case "ScheduledControlEnabled": {
      const booleanValue = labelToBoolean(mustString(value));
      return setPath(
        config,
        "operation.scheduledControlEnabled",
        booleanValue,
        "hot"
      );
    }

    case "PcsDaisyChain": {
      const chain = parseNumberArrayJson(mustString(value));
      if (!config.pcs) {
        config.pcs = {
          pcsDaisyChain: chain,
          maxChargeKw: 0,
          maxDischargeKw: 0,
        };
        return {
          changed: true,
          path: "pcs.pcsDaisyChain",
          classification: "restart",
        };
      }
      return setPath(config, "pcs.pcsDaisyChain", chain, "restart");
    }

    case "SiteMaxChargekW": {
      ensurePcs(config);
      return setPath(config, "pcs.maxChargeKw", mustNumber(value), "hot");
    }

    case "SiteMaxDischargekW": {
      ensurePcs(config);
      return setPath(config, "pcs.maxDischargeKw", mustNumber(value), "hot");
    }

    case "SbmuStrings": {
      const strings = parseNumberArrayJson(mustString(value));
      if (!config.mbmu) {
        config.mbmu = { sbmuStrings: strings };
        return {
          changed: true,
          path: "mbmu.sbmuStrings",
          classification: "restart",
        };
      }
      return setPath(config, "mbmu.sbmuStrings", strings, "restart");
    }

    case "ControllerMinSOC":
      return setPath(config, "battery.minSoc", mustNumber(value), "hot");
    case "ControllerMaxSOC":
      return setPath(config, "battery.maxSoc", mustNumber(value), "hot");

    case "AcInvertersJson": {
      const inverters = parseAcInvertersJson(mustString(value));
      return setPath(config, "pv.acInverters", inverters, "restart");
    }

    case "PvCurtailmentMethod": {
      const mode = mustString(value);
      const mapped = mode === "none" ? null : mode;
      return setPath(config, "pv.curtailmentMethod", mapped, "hot");
    }

    case "IslandingDevice": {
      const mode = mustString(value);
      if (mode === "None") {
        const had = !!config.islanding;
        delete config.islanding;
        return {
          changed: had,
          path: "islanding",
          classification: "hot",
        };
      }
      const prev = config.islanding?.device;
      config.islanding = { device: mode as any };
      return {
        changed: prev !== mode,
        path: "islanding.device",
        classification: "hot",
      };
    }

    case "PrimaryMeterModel":
      return setPath(config, "metering.meterType", mustString(value), "restart");
    case "MeterModbusProfile":
      return setPath(config, "metering.modbusProfile", mustString(value), "restart");
    case "MeterIp":
      return setPath(config, "metering.ip", mustString(value), "hot");

    case "ReadsPV":
      return setPath(config, "metering.reads.pv", labelToBoolean(mustString(value)), "hot");
    case "PVFromInverter":
      return setPath(
        config,
        "metering.reads.pvFromInverter",
        labelToBoolean(mustString(value)),
        "hot"
      );
    case "ReadsUtility":
      return setPath(config, "metering.reads.utility", labelToBoolean(mustString(value)), "hot");
    case "ReadsLoad":
      return setPath(config, "metering.reads.load", labelToBoolean(mustString(value)), "hot");

    case "GeneratorMaxkW": {
      ensureGenerator(config);
      return setPath(config, "generator.maxKw", mustNumber(value), "hot");
    }

    case "ChargeFromGenerator": {
      ensureGenerator(config);
      return setPath(
        config,
        "generator.chargeFromGenerator",
        labelToBoolean(mustString(value)),
        "hot"
      );
    }

    case "GeneratorChargekWLimit": {
      ensureGenerator(config);
      return setPath(config, "generator.chargeKwLimit", mustNumber(value), "hot");
    }

    case "GeneratorStartSOC": {
      ensureGenerator(config);
      return setPath(config, "generator.startSoc", mustNumber(value), "hot");
    }

    case "GeneratorStopSOC": {
      ensureGenerator(config);
      return setPath(config, "generator.stopSoc", mustNumber(value), "hot");
    }

    case "GeneratorControlType": {
      ensureGenerator(config);
      return setPath(config, "generator.controlType", mustString(value), "hot");
    }

    default:
      return null;
  }
}

function setPath(
  target: any,
  dotPath: string,
  value: unknown,
  classification: ApplyClassification
): ApplyArgResult {
  const segments = dotPath.split(".");
  const leaf = segments.pop() as string;

  let cursor = target;
  for (const segment of segments) {
    if (!cursor[segment] || typeof cursor[segment] !== "object") {
      cursor[segment] = {};
    }
    cursor = cursor[segment];
  }

  const prev = cursor[leaf];
  const changed = !isDeepStrictEqual(prev, value);
  cursor[leaf] = value;

  return {
    changed,
    path: dotPath,
    classification,
  };
}

function mustString(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Expected string value");
  }
  return value;
}

function mustNumber(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("Expected numeric value");
  }
  return parsed;
}

function parseNumberArrayJson(value: string): number[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Expected JSON array");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Expected JSON array");
  }

  const output: number[] = [];
  for (const entry of parsed) {
    const num = Number(entry);
    if (!Number.isFinite(num)) {
      throw new Error("JSON array must contain only numbers");
    }
    output.push(num);
  }
  return output;
}

function parseAcInvertersJson(value: string): SiteConfig["pv"]["acInverters"] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Expected JSON array for AC inverters");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Expected JSON array for AC inverters");
  }

  return parsed as SiteConfig["pv"]["acInverters"];
}

function parseCustomGridProfile(value: string): CustomGridProfile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Expected JSON object for custom grid profile");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected JSON object for custom grid profile");
  }

  return parsed as CustomGridProfile;
}

function labelToBoolean(label: string): boolean {
  switch (label) {
    case "true":
    case "enable":
      return true;
    case "false":
    case "disable":
      return false;
    default:
      throw new Error(`Unsupported boolean enum label: ${label}`);
  }
}

function ensurePcs(config: SiteConfig) {
  if (config.pcs) return;
  config.pcs = {
    pcsDaisyChain: [],
    maxChargeKw: 0,
    maxDischargeKw: 0,
  };
}

function ensureGenerator(config: SiteConfig) {
  if (config.generator) return;
  config.generator = {
    maxKw: 0,
    chargeFromGenerator: false,
    chargeKwLimit: 0,
    startSoc: 0,
    stopSoc: 0,
    controlType: "RemoteIO",
  };
}

export function validateSiteConfig(config: SiteConfig): SiteConfigValidationIssue[] {
  const issues: SiteConfigValidationIssue[] = [];

  if (!config.system?.systemProfile) {
    issues.push({ path: "system.systemProfile", message: "systemProfile is required" });
  }
  if (!config.system?.controllerTimezone) {
    issues.push({
      path: "system.controllerTimezone",
      message: "controllerTimezone is required",
    });
  }

  if (!config.network?.controller?.ip) {
    issues.push({ path: "network.controller.ip", message: "controller.ip is required" });
  }

  const mbPort = config.network?.controller?.modbusServer?.port;
  if (!Number.isFinite(mbPort) || mbPort < 1 || mbPort > 65535) {
    issues.push({
      path: "network.controller.modbusServer.port",
      message: "modbusServer port must be 1..65535",
    });
  }

  const validGridCodes = new Set([
    "IEEE1547-2018",
    "Rule21",
    "Rule14H",
    "PREPA-MTR",
    "Ontario-ESA",
    "ISO",
    "Custom",
  ]);
  if (!validGridCodes.has(config.operation.gridCode)) {
    issues.push({ path: "operation.gridCode", message: "unsupported gridCode" });
  }

  const validCrdModes = new Set([
    "no-restriction",
    "no-import",
    "no-export",
    "no-exchange",
  ]);
  if (!validCrdModes.has(config.operation.crdMode)) {
    issues.push({ path: "operation.crdMode", message: "unsupported CRD mode" });
  }

  if (config.operation.gridCode === "Custom" && !config.operation.customGridProfile) {
    issues.push({
      path: "operation.customGridProfile",
      message: "customGridProfile required when gridCode=Custom",
    });
  }

  if (!Number.isFinite(config.battery.minSoc) || config.battery.minSoc < 0 || config.battery.minSoc > 1) {
    issues.push({ path: "battery.minSoc", message: "minSoc must be between 0 and 1" });
  }
  if (!Number.isFinite(config.battery.maxSoc) || config.battery.maxSoc < 0 || config.battery.maxSoc > 1) {
    issues.push({ path: "battery.maxSoc", message: "maxSoc must be between 0 and 1" });
  }
  if (config.battery.minSoc > config.battery.maxSoc) {
    issues.push({ path: "battery", message: "minSoc must be <= maxSoc" });
  }

  if (config.system.systemProfile === "eSpire280") {
    if (!config.pcs) {
      issues.push({ path: "pcs", message: "pcs required for eSpire280" });
    }
    if (!config.mbmu) {
      issues.push({ path: "mbmu", message: "mbmu required for eSpire280" });
    }
  }

  if (!config.metering?.meterType) {
    issues.push({ path: "metering.meterType", message: "meterType is required" });
  }
  if (!config.metering?.modbusProfile) {
    issues.push({
      path: "metering.modbusProfile",
      message: "metering.modbusProfile is required",
    });
  }
  if (!config.metering?.ip) {
    issues.push({ path: "metering.ip", message: "metering.ip is required" });
  }

  if (config.generator) {
    if (config.generator.startSoc < 0 || config.generator.startSoc > 1) {
      issues.push({ path: "generator.startSoc", message: "startSoc must be between 0 and 1" });
    }
    if (config.generator.stopSoc < 0 || config.generator.stopSoc > 1) {
      issues.push({ path: "generator.stopSoc", message: "stopSoc must be between 0 and 1" });
    }
  }

  return issues;
}
