// src/config/loader.ts

import fs from "fs";
import path from "path";
import {
  SiteConfig,
  OperationMode,
  GridCode,
  CrdMode,
} from "./types";

export interface LoadConfigOptions {
  /**
   * Explicit path to config file. If provided, overrides env/defaults.
   */
  path?: string;

  /**
   * Name of env var that may point to the config path.
   * Default: "KEYSTONE_SITE_CONFIG"
   */
  envVarName?: string;

  /**
   * Fallback path when neither `path` nor env var is set.
   * Default: "config.json" in process.cwd().
   */
  defaultPath?: string;
}

/**
 * Resolve which config file path to use, based on:
 *   1) options.path
 *   2) process.env[envVarName]
 *   3) defaultPath
 */
export function resolveConfigPath(opts: LoadConfigOptions = {}): string {
  const envVar = opts.envVarName ?? "KEYSTONE_SITE_CONFIG";
  if (opts.path && opts.path.trim().length > 0) {
    return path.resolve(opts.path);
  }

  const fromEnv = process.env[envVar];
  if (fromEnv && fromEnv.trim().length > 0) {
    return path.resolve(fromEnv);
  }

  const fallback = opts.defaultPath ?? "config.json";
  return path.resolve(fallback);
}

// ---- tiny runtime validators (not exhaustive, just guardrails) ----

function assertObject(value: unknown, ctx: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`SiteConfig validation error: expected object at ${ctx}`);
  }
}

function assertString(value: unknown, ctx: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`SiteConfig validation error: expected non-empty string at ${ctx}`);
  }
}

function assertNumber(value: unknown, ctx: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`SiteConfig validation error: expected finite number at ${ctx}`);
  }
}

function assertBoolean(value: unknown, ctx: string): asserts value is boolean {
  if (typeof value !== "boolean") {
    throw new Error(`SiteConfig validation error: expected boolean at ${ctx}`);
  }
}

function assertOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  ctx: string
): asserts value is T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(
      `SiteConfig validation error: expected one of [${allowed.join(
        ", "
      )}] at ${ctx}, got ${JSON.stringify(value)}`
    );
  }
}

// ---- shallow SiteConfig validation ----
//
// This is intentionally not exhaustive. It just sanity-checks the
// most critical fields so you fail fast with a clear error.

export function validateSiteConfig(raw: unknown): SiteConfig {
  assertObject(raw, "root");
  const cfg = raw as any;

  // system
  assertObject(cfg.system, "system");
  assertString(cfg.system.systemProfile, "system.systemProfile");
  assertString(cfg.system.controllerTimezone, "system.controllerTimezone");
  assertObject(cfg.system.nominal, "system.nominal");
  assertNumber(cfg.system.nominal.voltageVll, "system.nominal.voltageVll");
  assertNumber(cfg.system.nominal.frequencyHz, "system.nominal.frequencyHz");

  // network
  assertObject(cfg.network, "network");
  assertObject(cfg.network.controller, "network.controller");
  assertString(cfg.network.controller.ip, "network.controller.ip");
  assertObject(cfg.network.controller.modbusServer, "network.controller.modbusServer");
  assertString(cfg.network.controller.modbusServer.ip, "network.controller.modbusServer.ip");
  assertNumber(cfg.network.controller.modbusServer.port, "network.controller.modbusServer.port");

  // operation
  assertObject(cfg.operation, "operation");
  assertOneOf<OperationMode>(
    cfg.operation.mode,
    ["grid-tied", "backup", "off-grid"],
    "operation.mode"
  );
  assertOneOf<GridCode>(
    cfg.operation.gridCode,
    ["IEEE1547-2018", "Rule21", "Rule14H", "PREPA-MTR", "Ontario-ESA", "Custom"],
    "operation.gridCode"
  );
  assertOneOf<CrdMode>(
    cfg.operation.crdMode,
    ["no-restriction", "no-import", "no-export", "no-exchange"],
    "operation.crdMode"
  );
  assertBoolean(cfg.operation.scheduledControlEnabled, "operation.scheduledControlEnabled");

  // battery
  assertObject(cfg.battery, "battery");
  assertNumber(cfg.battery.minSoc, "battery.minSoc");
  assertNumber(cfg.battery.maxSoc, "battery.maxSoc");

  // PV
  assertObject(cfg.pv, "pv");
  if (!Array.isArray(cfg.pv.acInverters) || cfg.pv.acInverters.length === 0) {
    throw new Error("SiteConfig validation error: pv.acInverters must be a non-empty array");
  }
  cfg.pv.acInverters.forEach((inv: any, idx: number) => {
    const ctx = `pv.acInverters[${idx}]`;
    assertObject(inv, ctx);
    assertString(inv.type, `${ctx}.type`);
    assertString(inv.model, `${ctx}.model`);
    assertNumber(inv.ratedKwAc, `${ctx}.ratedKwAc`);
    assertString(inv.ip, `${ctx}.ip`);
    assertNumber(inv.port, `${ctx}.port`);
    assertString(inv.modbusProfile, `${ctx}.modbusProfile`);
  });

  // metering
  assertObject(cfg.metering, "metering");
  assertString(cfg.metering.meterType, "metering.meterType");
  assertString(cfg.metering.modbusProfile, "metering.modbusProfile");
  assertString(cfg.metering.ip, "metering.ip");
  assertObject(cfg.metering.reads, "metering.reads");
  assertBoolean(cfg.metering.reads.pv, "metering.reads.pv");
  assertBoolean(cfg.metering.reads.pvFromInverter, "metering.reads.pvFromInverter");
  assertBoolean(cfg.metering.reads.utility, "metering.reads.utility");
  assertBoolean(cfg.metering.reads.load, "metering.reads.load");

  // generator (optional)
  if (cfg.generator != null) {
    assertObject(cfg.generator, "generator");
    assertNumber(cfg.generator.maxKw, "generator.maxKw");
    assertBoolean(cfg.generator.chargeFromGenerator, "generator.chargeFromGenerator");
    assertNumber(cfg.generator.chargeKwLimit, "generator.chargeKwLimit");
    assertNumber(cfg.generator.startSoc, "generator.startSoc");
    assertNumber(cfg.generator.stopSoc, "generator.stopSoc");
    assertString(cfg.generator.controlType, "generator.controlType");
  }

  // PCS / MBMU optional checks (only on 280)
  if (cfg.pcs != null) {
    assertObject(cfg.pcs, "pcs");
    if (!Array.isArray(cfg.pcs.pcsDaisyChain)) {
      throw new Error("SiteConfig validation error: pcs.pcsDaisyChain must be an array");
    }
  }
  if (cfg.mbmu != null) {
    assertObject(cfg.mbmu, "mbmu");
    if (!Array.isArray(cfg.mbmu.sbmuStrings)) {
      throw new Error("SiteConfig validation error: mbmu.sbmuStrings must be an array");
    }
  }

  // If we got here, it's "good enough" for runtime.
  return cfg as SiteConfig;
}

/**
 * Load and validate the site config JSON.
 *
 * Usage:
 *   const cfg = loadSiteConfig();
 *   const cfg = loadSiteConfig({ path: "/data/site-config.json" });
 */
export function loadSiteConfig(opts: LoadConfigOptions = {}): SiteConfig {
  const filePath = resolveConfigPath(opts);
  let raw: string;

  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err: any) {
    throw new Error(
      `Failed to read site config from "${filePath}": ${err?.message || String(err)}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    throw new Error(
      `Failed to parse site config JSON from "${filePath}": ${err?.message || String(err)}`
    );
  }

  return validateSiteConfig(parsed);
}