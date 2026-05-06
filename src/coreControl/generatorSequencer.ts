import type { GeneratorConfig } from "../config";
import type { ControlEnvelope } from "../writer/writer";

export type GeneratorSequencerMode =
  | "idle"
  | "start-requested"
  | "charging"
  | "stop-requested"
  | "unavailable";

export interface GeneratorSequencerState {
  mode: GeneratorSequencerMode;
  startedAtMs?: number;
}

export interface GeneratorSequencerTelemetry {
  nowMs?: number;
  batterySoc: number;
  generatorRunning?: boolean;
  generatorAvailable?: boolean;
  generatorContactorClosed?: boolean;
  generatorContactorOpen?: boolean;
  allowGeneratorStart?: boolean;
  allowGeneratorCharge?: boolean;
}

export type GeneratorSequencerCommand =
  | { kind: "generator-start" }
  | { kind: "generator-stop" }
  | { kind: "pcs-grid-tie-mode" }
  | { kind: "pcs-charge-from-generator"; kw: number };

export interface GeneratorSequencerOptions {
  minRunMs?: number;
}

export interface GeneratorSequencerResult {
  state: GeneratorSequencerState;
  commands: GeneratorSequencerCommand[];
  reasons: string[];
}

export interface GeneratorWriterOptions {
  selTopic?: string;
  selGeneratorTagID?: string;
  remoteIoTopic?: string;
  remoteIoGeneratorTagID?: string;
}

const DEFAULT_MIN_RUN_MS = 0;

export function evaluateGeneratorSequencer(
  config: GeneratorConfig | undefined,
  telemetry: GeneratorSequencerTelemetry,
  previousState: GeneratorSequencerState = { mode: "idle" },
  options: GeneratorSequencerOptions = {}
): GeneratorSequencerResult {
  if (!config) {
    return {
      state: { mode: "idle" },
      commands: [],
      reasons: ["generator-not-configured"],
    };
  }

  const nowMs = telemetry.nowMs ?? Date.now();
  const minRunMs = options.minRunMs ?? DEFAULT_MIN_RUN_MS;
  const generatorAvailable = telemetry.generatorAvailable !== false;
  const generatorRunning = telemetry.generatorRunning === true;
  const allowGeneratorStart = telemetry.allowGeneratorStart !== false;
  const commands: GeneratorSequencerCommand[] = [];
  const reasons: string[] = [];

  if (!generatorAvailable) {
    return {
      state: { ...previousState, mode: "unavailable" },
      commands,
      reasons: ["generator-unavailable"],
    };
  }

  const shouldStart =
    allowGeneratorStart &&
    !generatorRunning &&
    telemetry.batterySoc <= config.startSoc;
  const minimumRuntimeMet =
    !previousState.startedAtMs || nowMs - previousState.startedAtMs >= minRunMs;
  const shouldStop =
    generatorRunning && telemetry.batterySoc >= config.stopSoc && minimumRuntimeMet;

  if (shouldStart) {
    commands.push({ kind: "generator-start" });
    reasons.push("generator-start-soc");
    return {
      state: {
        mode: "start-requested",
        startedAtMs: previousState.startedAtMs,
      },
      commands,
      reasons,
    };
  }

  if (
    !allowGeneratorStart &&
    !generatorRunning &&
    telemetry.batterySoc <= config.startSoc
  ) {
    reasons.push("generator-start-not-allowed");
  }

  if (shouldStop) {
    commands.push({ kind: "generator-stop" });
    reasons.push("generator-stop-soc");
    return {
      state: { mode: "stop-requested" },
      commands,
      reasons,
    };
  }

  if (generatorRunning) {
    const startedAtMs = previousState.startedAtMs ?? nowMs;
    const chargeKw = resolveGeneratorChargeKw(config);

    commands.push({ kind: "pcs-grid-tie-mode" });
    reasons.push("generator-grid-tie-charge-mode");

    if (telemetry.allowGeneratorCharge === false) {
      reasons.push("generator-charge-disabled");
    } else if (chargeKw > 0) {
      commands.push({ kind: "pcs-charge-from-generator", kw: chargeKw });
      reasons.push("generator-charge-request");
    } else {
      reasons.push("generator-charge-kw-zero");
    }

    if (telemetry.batterySoc >= config.stopSoc && !minimumRuntimeMet) {
      reasons.push("generator-min-runtime-hold");
    }

    return {
      state: { mode: "charging", startedAtMs },
      commands,
      reasons,
    };
  }

  return {
    state: { mode: "idle" },
    commands,
    reasons: reasons.length > 0 ? reasons : ["generator-idle"],
  };
}

export function generatorCommandsToWriterEnvelopes(
  config: GeneratorConfig,
  commands: GeneratorSequencerCommand[],
  options: GeneratorWriterOptions = {}
): ControlEnvelope[] {
  const envelopes: ControlEnvelope[] = [];
  const generatorPayload: ControlEnvelope["payload"] = [];
  const pcsPayload: ControlEnvelope["payload"] = [];

  for (const command of commands) {
    switch (command.kind) {
      case "generator-start":
        generatorPayload.push({
          tagID: generatorControlTagID(config, options),
          value: true,
        });
        break;

      case "generator-stop":
        generatorPayload.push({
          tagID: generatorControlTagID(config, options),
          value: false,
        });
        break;

      case "pcs-grid-tie-mode":
        pcsPayload.push(
          { tagID: "SYSTEM_RUN_MODE", value: 0 },
          { tagID: "GRID_WIRE_CONNECTION", value: 0 }
        );
        break;

      case "pcs-charge-from-generator":
        pcsPayload.push({
          tagID: "SYSTEM_ACTIVE_POWER_DEMAND",
          value: -Math.abs(command.kw),
        });
        break;
    }
  }

  if (generatorPayload.length > 0) {
    envelopes.push({
      topic: generatorTopic(config, options),
      payload: generatorPayload,
    });
  }

  if (pcsPayload.length > 0) {
    envelopes.push({
      topic: "PCS",
      payload: pcsPayload,
    });
  }

  return envelopes;
}

function resolveGeneratorChargeKw(config: GeneratorConfig): number {
  return Math.max(0, Math.min(config.chargeKwLimit, config.maxKw));
}

function generatorTopic(
  config: GeneratorConfig,
  options: GeneratorWriterOptions
): string {
  if (config.controlType === "SEL") return options.selTopic ?? "SEL851";
  return options.remoteIoTopic ?? "Generator";
}

function generatorControlTagID(
  config: GeneratorConfig,
  options: GeneratorWriterOptions
): string {
  if (config.controlType === "SEL") {
    return options.selGeneratorTagID ?? "SEL851.RB_2";
  }
  return options.remoteIoGeneratorTagID ?? "Generator.Start";
}
