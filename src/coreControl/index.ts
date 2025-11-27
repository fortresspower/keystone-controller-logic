// src/coreControl/index.ts

import { SiteConfig } from "../config";
import { SiteCapabilities, deriveCapabilities } from "../capabilities";
import { ScheduleOutput } from "../scheduler";

export interface TelemetrySnapshot {
  // whatever you already have:
  soc: number;
  siteLoadKw: number;
  pvKw: number;
  gridStatus: "normal" | "island" | "fault";
  // etc.
}

export interface CoreControlCommand {
  pcsActivePowerKw?: number;
  pcsReactivePowerKvar?: number;
  generatorStart?: boolean;
  generatorStop?: boolean;
  pvCurtailmentKw?: number;
  // etc.
}

export interface CoreControlContext {
  config: SiteConfig;
  caps: SiteCapabilities;
}

export function initCoreControl(config: SiteConfig) {
  const caps = deriveCapabilities(config);
  const ctx: CoreControlContext = { config, caps };

  // you can keep local state here if needed

  return {
    evaluate(
      telemetry: TelemetrySnapshot,
      schedule: ScheduleOutput
    ): CoreControlCommand {
      return evaluateCoreControl(ctx, telemetry, schedule);
    },
  };
}

function evaluateCoreControl(
  ctx: CoreControlContext,
  telemetry: TelemetrySnapshot,
  schedule: ScheduleOutput
): CoreControlCommand {
  const { config, caps } = ctx;
  const { operation, battery, generator } = config;

  const cmd: CoreControlCommand = {};

  // Example: SOC clamping + schedule following
  const minSoc = battery.minSoc;
  const maxSoc = battery.maxSoc;

  const soc = telemetry.soc;

  // If schedule wants charging but SOC already high, clamp:
  if (schedule.activePowerKwSetpoint !== undefined) {
    let target = schedule.activePowerKwSetpoint;

    if (target > 0 && soc >= maxSoc) {
      // discharge requested but we're at high SOC: okay-ish
    } else if (target < 0 && soc <= minSoc) {
      // charge requested but we're at min SOC: block charging
      target = 0;
    }

    cmd.pcsActivePowerKw = target;
  }

  // Example: simple generator logic (if present)
  if (generator) {
    if (soc <= generator.startSoc) {
      cmd.generatorStart = true;
    } else if (soc >= generator.stopSoc) {
      cmd.generatorStop = true;
    }
  }

  // Example: PV curtailment in off-grid mode
  if (operation.mode === "off-grid" && caps.hasACPV) {
    // if frequency-shifting, you might target a PCS power level instead
    // if modbus, you might directly set curtailment power
    // leaving implementation to your existing logic
  }

  return cmd;
}
