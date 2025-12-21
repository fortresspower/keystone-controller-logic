// src/runtime/buildReadPlansFromConfig.ts

import type { CompilerEnv, ReadPlan } from "../types";
// If you moved types into src/config/types.ts, use "../config/types" instead.
import type {
  SiteConfig,
  MeteringConfig,
  PvAcInverterConfig,
} from "../config";

import {
  buildReadPlanFromTemplateName,
} from "../compiler/compiler";

/**
 * Read plan bundle for the main site meter.
 */
export interface MeterReadPlan {
  config: MeteringConfig;
  readPlan: ReadPlan;
}

/**
 * Read plan bundle for one PV AC inverter.
 */
export interface PvInverterReadPlan {
  id: string;                    // logical ID for EMS / telemetry
  config: PvAcInverterConfig;
  readPlan: ReadPlan;
}

/**
 * All read plans derived from a SiteConfig.
 * (For now: meter + PV AC inverters. PCS/MBMU/SEL can be added later.)
 */
export interface ReadPlansFromConfig {
  meter?: MeterReadPlan;
  pvInverters: PvInverterReadPlan[];
}

/**
 * Build all Modbus read plans required by the site,
 * based on the unified SiteConfig and the compiler env.
 *
 * This is the single entry point your Node-RED container / runtime
 * should call at startup.
 */
export function buildReadPlansFromConfig(
  config: SiteConfig,
  env: CompilerEnv
): ReadPlansFromConfig {
  const meter = buildMeterReadPlan(config, env);
  const pvInverters = buildPvInverterReadPlans(config, env);

  return {
    meter,
    pvInverters,
  };
}

// ------------------- internal helpers -------------------

function buildMeterReadPlan(
  config: SiteConfig,
  env: CompilerEnv
): MeterReadPlan | undefined {
  const m = config.metering;
  if (!m || !m.modbusProfile) {
    // No meter configured
    return undefined;
  }

  const profileName = m.modbusProfile;

  const instance = {
    equipmentId: "meter-main",                 // EMS-facing logical ID
    serverKey: `meter-${m.ip}`,                // used by reader/broker
    unitId: 1,                                 // can be added to config later if needed
  };

  const readPlan = buildReadPlanFromTemplateName(profileName, instance, env);

  return {
    config: m,
    readPlan,
  };
}

function buildPvInverterReadPlans(
  config: SiteConfig,
  env: CompilerEnv
): PvInverterReadPlan[] {
  const pvCfg = config.pv;
  if (!pvCfg || !Array.isArray(pvCfg.acInverters)) {
    return [];
  }

  const out: PvInverterReadPlan[] = [];

  pvCfg.acInverters.forEach((inv: PvAcInverterConfig, idx: number) => {
    const profileName = inv.modbusProfile;
    if (!profileName) {
      throw new Error(
        `PV inverter at index ${idx} is missing modbusProfile in SiteConfig`
      );
    }

    // Simple, deterministic IDs – EMS can use these to namespace tags.
    const id = `pv-${idx + 1}-${inv.model}`;

    const instance = {
      equipmentId: id,
      serverKey: `pv-${inv.ip}`,     // used by reader/broker to locate modbus client
      unitId: 1,                     // extend config when you need per-inverter unitId
    };

    const readPlan = buildReadPlanFromTemplateName(profileName, instance, env);

    out.push({
      id,
      config: inv,
      readPlan,
    });
  });

  return out;
}
