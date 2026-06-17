import type { ControlEnvelope } from "../writer/writer";

export type MiniStandaloneMode =
  | "grid-tied"
  | "outage-wait"
  | "switch-off-grid"
  | "off-grid-hold"
  | "grid-return-wait"
  | "switch-grid-tied";

export interface MiniStandaloneState {
  mode: MiniStandaloneMode;
  waitUntilMs?: number;
  lastSendMs?: number;
  gridStableSinceMs?: number;
}

export interface MiniStandaloneTelemetry {
  nowMs?: number;
  gridAvailable: boolean;
  onOffGridSwitch?: number;
  pcsFaulted?: boolean;
}

export type MiniStandaloneCommand =
  | { kind: "on-off-grid-switch"; value: 0 | 1 }
  | { kind: "suppress-active-setpoint" };

export interface MiniStandaloneOptions {
  outageDebounceMs?: number;
  gridReturnDebounceMs?: number;
  retryMs?: number;
}

export interface MiniStandaloneResult {
  state: MiniStandaloneState;
  commands: MiniStandaloneCommand[];
  reasons: string[];
}

export interface MiniStandaloneWriterOptions {
  pcsTopic?: string;
}

const DEFAULT_OUTAGE_DEBOUNCE_MS = 1_000;
const DEFAULT_GRID_RETURN_DEBOUNCE_MS = 5_000;
const DEFAULT_RETRY_MS = 2_000;

export function evaluateMiniStandaloneSequencer(
  telemetry: MiniStandaloneTelemetry,
  previousState: MiniStandaloneState = { mode: "grid-tied" },
  options: MiniStandaloneOptions = {}
): MiniStandaloneResult {
  const nowMs = telemetry.nowMs ?? Date.now();
  const outageDebounceMs =
    options.outageDebounceMs ?? DEFAULT_OUTAGE_DEBOUNCE_MS;
  const gridReturnDebounceMs =
    options.gridReturnDebounceMs ?? DEFAULT_GRID_RETURN_DEBOUNCE_MS;
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  const commands: MiniStandaloneCommand[] = [];
  const reasons: string[] = [];
  const state: MiniStandaloneState = {
    ...previousState,
    mode: previousState.mode || "grid-tied",
  };

  if (telemetry.gridAvailable) {
    state.gridStableSinceMs = state.gridStableSinceMs ?? nowMs;
  } else {
    state.gridStableSinceMs = undefined;
  }

  if (telemetry.pcsFaulted) {
    commands.push({ kind: "suppress-active-setpoint" });
    reasons.push("mini-standalone-pcs-faulted");
    return { state, commands, reasons };
  }

  switch (state.mode) {
    case "grid-tied":
      if (!telemetry.gridAvailable) {
        transition(state, "outage-wait", nowMs + outageDebounceMs);
        reasons.push("mini-grid-outage-detected");
      } else {
        reasons.push("mini-grid-tied");
      }
      break;

    case "outage-wait":
      commands.push({ kind: "suppress-active-setpoint" });
      if (telemetry.gridAvailable) {
        transition(state, "grid-tied");
        reasons.push("mini-outage-cleared-during-wait");
      } else if (timerExpired(state, nowMs)) {
        transition(state, "switch-off-grid");
        reasons.push("mini-outage-confirmed");
      }
      break;

    case "switch-off-grid":
      commands.push({ kind: "suppress-active-setpoint" });
      if (telemetry.onOffGridSwitch === 1) {
        transition(state, "off-grid-hold");
        reasons.push("mini-off-grid-confirmed");
      } else if (readyToRetry(state, nowMs, retryMs)) {
        commands.push({ kind: "on-off-grid-switch", value: 1 });
        state.lastSendMs = nowMs;
        reasons.push("mini-off-grid-switch-request");
      }
      break;

    case "off-grid-hold":
      commands.push({ kind: "suppress-active-setpoint" });
      if (isGridStable(state, nowMs, gridReturnDebounceMs)) {
        transition(state, "grid-return-wait");
        reasons.push("mini-grid-return-detected");
      } else {
        reasons.push("mini-off-grid-hold");
      }
      break;

    case "grid-return-wait":
      commands.push({ kind: "suppress-active-setpoint" });
      if (!telemetry.gridAvailable) {
        transition(state, "off-grid-hold");
        reasons.push("mini-grid-return-lost");
      } else if (isGridStable(state, nowMs, gridReturnDebounceMs)) {
        transition(state, "switch-grid-tied");
        reasons.push("mini-grid-return-confirmed");
      }
      break;

    case "switch-grid-tied":
      commands.push({ kind: "suppress-active-setpoint" });
      if (!telemetry.gridAvailable) {
        transition(state, "outage-wait", nowMs + outageDebounceMs);
        reasons.push("mini-outage-returned");
      } else if (telemetry.onOffGridSwitch === 0) {
        transition(state, "grid-tied");
        reasons.push("mini-grid-tied-confirmed");
      } else if (readyToRetry(state, nowMs, retryMs)) {
        commands.push({ kind: "on-off-grid-switch", value: 0 });
        state.lastSendMs = nowMs;
        reasons.push("mini-grid-tied-switch-request");
      }
      break;
  }

  return { state, commands, reasons };
}

export function miniStandaloneCommandsToWriterEnvelopes(
  commands: MiniStandaloneCommand[],
  options: MiniStandaloneWriterOptions = {}
): ControlEnvelope[] {
  const pcsPayload: ControlEnvelope["payload"] = [];

  for (const command of commands) {
    switch (command.kind) {
      case "on-off-grid-switch":
        pcsPayload.push({ tagID: "OnOffGridSwitch", value: command.value });
        break;
      case "suppress-active-setpoint":
        pcsPayload.push({ tagID: "ActivePowerSetpoint", value: 0 });
        break;
    }
  }

  return pcsPayload.length > 0
    ? [{ topic: options.pcsTopic ?? "PCS", payload: pcsPayload }]
    : [];
}

function transition(
  state: MiniStandaloneState,
  mode: MiniStandaloneMode,
  waitUntilMs?: number
) {
  state.mode = mode;
  state.waitUntilMs = waitUntilMs;
  state.lastSendMs = undefined;
}

function timerExpired(state: MiniStandaloneState, nowMs: number): boolean {
  return state.waitUntilMs == null || nowMs >= state.waitUntilMs;
}

function readyToRetry(
  state: MiniStandaloneState,
  nowMs: number,
  retryMs: number
): boolean {
  return state.lastSendMs == null || nowMs - state.lastSendMs >= retryMs;
}

function isGridStable(
  state: MiniStandaloneState,
  nowMs: number,
  holdMs: number
): boolean {
  return state.gridStableSinceMs != null && nowMs - state.gridStableSinceMs >= holdMs;
}
