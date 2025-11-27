// src/scheduler/index.ts

import { SiteConfig } from "../config";

export interface ScheduleOutput {
  // generic setpoints the scheduler produces
  activePowerKwSetpoint?: number;
  reactivePowerKvarSetpoint?: number;
  // etc.
}

export function initScheduler(config: SiteConfig) {
  const tz = config.system.controllerTimezone;
  const crdMode = config.operation.crdMode;
  const mode = config.operation.mode;

  // Use tz, crdMode, mode in your existing scheduling logic.
  // Wire scheduler to produce a ScheduleOutput stream/message.

  return {
    // e.g. a function to compute setpoint for a given timestamp + telemetry
    getSetpointForNow(): ScheduleOutput {
      // TODO: plug in your existing implementation
      return {};
    },
  };
}
