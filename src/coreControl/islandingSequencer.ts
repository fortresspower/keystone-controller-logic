import type { ControlEnvelope } from "../writer/writer";

export type IslandingSequencerMode =
  | "idle"
  | "outage-wait"
  | "assert-interlock"
  | "pcs-off-to-island"
  | "set-island-mode"
  | "confirm-island-mode"
  | "island-mode-dwell"
  | "pcs-on-island"
  | "island-hold"
  | "grid-wait"
  | "pcs-off-to-grid"
  | "set-grid-mode"
  | "confirm-grid-mode"
  | "grid-mode-dwell"
  | "pcs-on-grid"
  | "clear-interlock";

export interface IslandingSequencerState {
  mode: IslandingSequencerMode;
  phase?: "grid" | "outage";
  waitUntilMs?: number;
  lastSendMs?: number;
  gridClearSinceMs?: number;
}

export interface IslandingSequencerTelemetry {
  nowMs?: number;
  outageDetected: boolean;
  interlockClosed?: boolean;
  pcsRunMode?: number;
  pcsOnOff?: number;
  pcsGlobalState?: number;
  gridWireConnection?: number;
}

export type IslandingSequencerCommand =
  | { kind: "interlock"; closed: boolean }
  | { kind: "pcs-on-off"; value: 1 | 2 }
  | { kind: "pcs-run-mode"; value: 0 | 1 }
  | { kind: "grid-wire-connection"; value: 0 | 1 };

export interface IslandingSequencerOptions {
  waitMs?: number;
  retryMs?: number;
  modeDwellMs?: number;
  gridClearHoldMs?: number;
}

export interface IslandingSequencerResult {
  state: IslandingSequencerState;
  commands: IslandingSequencerCommand[];
  reasons: string[];
}

export interface IslandingWriterOptions {
  selTopic?: string;
  interlockTagID?: string;
}

const PCS_ON = 1;
const PCS_OFF = 2;
const RUN_MODE_GRID_TIE = 0;
const RUN_MODE_ISLAND = 1;
const DEFAULT_WAIT_MS = 1000;
const DEFAULT_RETRY_MS = 2000;
const DEFAULT_MODE_DWELL_MS = 2000;
const DEFAULT_GRID_CLEAR_HOLD_MS = 2000;

export function evaluateESpire280IslandingSequencer(
  telemetry: IslandingSequencerTelemetry,
  previousState: IslandingSequencerState = { mode: "idle" },
  options: IslandingSequencerOptions = {}
): IslandingSequencerResult {
  const nowMs = telemetry.nowMs ?? Date.now();
  const waitMs = options.waitMs ?? DEFAULT_WAIT_MS;
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  const modeDwellMs = options.modeDwellMs ?? DEFAULT_MODE_DWELL_MS;
  const gridClearHoldMs = options.gridClearHoldMs ?? DEFAULT_GRID_CLEAR_HOLD_MS;
  const commands: IslandingSequencerCommand[] = [];
  const reasons: string[] = [];
  const state: IslandingSequencerState = {
    ...previousState,
    mode: previousState.mode || "idle",
  };

  updatePhaseAndGridDebounce(state, telemetry, nowMs);

  if (telemetry.outageDetected && isGridPath(state.mode)) {
    transition(state, "outage-wait", nowMs + waitMs);
    reasons.push("outage-preempt-grid-path");
  } else if (isGridClearStable(state, telemetry, nowMs, gridClearHoldMs) && isOutagePath(state.mode)) {
    transition(state, "grid-wait", nowMs + waitMs);
    reasons.push("grid-return-preempt-outage-path");
  }

  switch (state.mode) {
    case "idle":
      if (telemetry.outageDetected) {
        transition(state, "outage-wait", nowMs + waitMs);
        reasons.push("outage-detected");
      } else {
        reasons.push("grid-idle");
      }
      break;

    case "outage-wait":
      if (!telemetry.outageDetected) {
        transition(state, "grid-wait", nowMs + waitMs);
        reasons.push("outage-cleared-during-wait");
      } else if (timerExpired(state, nowMs)) {
        transition(state, "pcs-off-to-island");
        reasons.push("outage-wait-complete");
      }
      break;

    case "assert-interlock":
      if (telemetry.interlockClosed === true) {
        transition(
          state,
          telemetry.pcsOnOff === PCS_OFF &&
            telemetry.pcsRunMode === RUN_MODE_ISLAND &&
            telemetry.gridWireConnection === RUN_MODE_ISLAND &&
            isStandbyOrFault(telemetry.pcsGlobalState)
            ? "pcs-on-island"
            : "pcs-off-to-island"
        );
        reasons.push("interlock-confirmed");
      } else if (readyToRetry(state, nowMs, retryMs)) {
        commands.push({ kind: "interlock", closed: true });
        markSent(state, nowMs);
        reasons.push("interlock-close-request");
      }
      break;

    case "pcs-off-to-island":
      requestPcsOffUntilStandbyOrFault(
        telemetry,
        state,
        commands,
        reasons,
        nowMs,
        retryMs,
        "set-island-mode"
      );
      break;

    case "set-island-mode":
      requestMode(
        telemetry,
        state,
        commands,
        reasons,
        nowMs,
        retryMs,
        RUN_MODE_ISLAND,
        "confirm-island-mode"
      );
      break;

    case "confirm-island-mode":
      confirmMode(
        telemetry,
        state,
        commands,
        reasons,
        nowMs,
        retryMs,
        RUN_MODE_ISLAND,
        "island-mode-dwell",
        modeDwellMs
      );
      break;

    case "island-mode-dwell":
      if (timerExpired(state, nowMs)) {
        transition(state, "assert-interlock");
        reasons.push("island-dwell-complete");
      }
      break;

    case "pcs-on-island":
      if (
        telemetry.pcsOnOff === PCS_ON &&
        telemetry.pcsGlobalState === 6
      ) {
        transition(state, "island-hold");
        reasons.push("island-on-confirmed");
      } else if (!isStandbyOrFault(telemetry.pcsGlobalState)) {
        reasons.push("pcs-not-ready-for-island-on");
      } else if (readyToRetry(state, nowMs, retryMs)) {
        commands.push({ kind: "pcs-on-off", value: PCS_ON });
        markSent(state, nowMs);
        reasons.push("pcs-on-island-request");
      }
      break;

    case "island-hold":
      if (isGridClearStable(state, telemetry, nowMs, gridClearHoldMs)) {
        transition(state, "grid-wait", nowMs + waitMs);
        reasons.push("grid-return-detected");
      } else {
        reasons.push("island-hold");
      }
      break;

    case "grid-wait":
      if (telemetry.outageDetected) {
        transition(state, "outage-wait", nowMs + waitMs);
        reasons.push("outage-returned-during-grid-wait");
      } else if (!isGridClearStable(state, telemetry, nowMs, gridClearHoldMs)) {
        reasons.push("grid-clear-debounce");
      } else if (timerExpired(state, nowMs)) {
        transition(state, "pcs-off-to-grid");
        reasons.push("grid-wait-complete");
      }
      break;

    case "pcs-off-to-grid":
      requestPcsOffUntilStandbyOrFault(
        telemetry,
        state,
        commands,
        reasons,
        nowMs,
        retryMs,
        "set-grid-mode"
      );
      break;

    case "set-grid-mode":
      requestMode(
        telemetry,
        state,
        commands,
        reasons,
        nowMs,
        retryMs,
        RUN_MODE_GRID_TIE,
        "confirm-grid-mode"
      );
      break;

    case "confirm-grid-mode":
      confirmMode(
        telemetry,
        state,
        commands,
        reasons,
        nowMs,
        retryMs,
        RUN_MODE_GRID_TIE,
        "grid-mode-dwell",
        modeDwellMs
      );
      break;

    case "grid-mode-dwell":
      if (telemetry.outageDetected) {
        transition(state, "outage-wait", nowMs + waitMs);
        reasons.push("outage-returned-during-grid-dwell");
      } else if (timerExpired(state, nowMs)) {
        transition(state, "pcs-on-grid");
        reasons.push("grid-dwell-complete");
      }
      break;

    case "pcs-on-grid":
      if (
        telemetry.pcsOnOff === PCS_ON &&
        telemetry.pcsGlobalState === 3
      ) {
        transition(state, "clear-interlock");
        reasons.push("grid-on-confirmed");
      } else if (!isStandbyOrFault(telemetry.pcsGlobalState)) {
        reasons.push("pcs-not-ready-for-grid-on");
      } else if (readyToRetry(state, nowMs, retryMs)) {
        commands.push({ kind: "pcs-on-off", value: PCS_ON });
        markSent(state, nowMs);
        reasons.push("pcs-on-grid-request");
      }
      break;

    case "clear-interlock":
      if (telemetry.interlockClosed === false) {
        transition(state, "idle");
        reasons.push("grid-restored");
      } else if (readyToRetry(state, nowMs, retryMs)) {
        commands.push({ kind: "interlock", closed: false });
        markSent(state, nowMs);
        reasons.push("interlock-open-request");
      }
      break;
  }

  return { state, commands, reasons };
}

export function islandingCommandsToWriterEnvelopes(
  commands: IslandingSequencerCommand[],
  options: IslandingWriterOptions = {}
): ControlEnvelope[] {
  const selPayload: ControlEnvelope["payload"] = [];
  const pcsPayload: ControlEnvelope["payload"] = [];

  for (const command of commands) {
    switch (command.kind) {
      case "interlock":
        selPayload.push({
          tagID: options.interlockTagID ?? "SEL751.RB_1",
          value: command.closed,
        });
        break;
      case "pcs-on-off":
        pcsPayload.push({ tagID: "SYSTEM_ON_OFF", value: command.value });
        break;
      case "pcs-run-mode":
        pcsPayload.push({ tagID: "SYSTEM_RUN_MODE", value: command.value });
        break;
      case "grid-wire-connection":
        pcsPayload.push({
          tagID: "GRID_WIRE_CONNECTION",
          value: command.value,
        });
        break;
    }
  }

  const envelopes: ControlEnvelope[] = [];
  if (selPayload.length > 0) {
    envelopes.push({
      topic: options.selTopic ?? "SEL751",
      payload: selPayload,
    });
  }
  if (pcsPayload.length > 0) {
    envelopes.push({ topic: "PCS", payload: pcsPayload });
  }
  return envelopes;
}

function requestPcsOffUntilStandbyOrFault(
  telemetry: IslandingSequencerTelemetry,
  state: IslandingSequencerState,
  commands: IslandingSequencerCommand[],
  reasons: string[],
  nowMs: number,
  retryMs: number,
  nextMode: IslandingSequencerMode
) {
  const offConfirmed = telemetry.pcsOnOff === PCS_OFF;
  if (!offConfirmed && readyToRetry(state, nowMs, retryMs)) {
    commands.push({ kind: "pcs-on-off", value: PCS_OFF });
    markSent(state, nowMs);
    reasons.push("pcs-off-request");
  }
  if (offConfirmed && isStandbyOrFault(telemetry.pcsGlobalState)) {
    transition(state, nextMode);
    reasons.push("pcs-off-standby-confirmed");
  } else {
    reasons.push("pcs-off-standby-wait");
  }
}

function requestMode(
  telemetry: IslandingSequencerTelemetry,
  state: IslandingSequencerState,
  commands: IslandingSequencerCommand[],
  reasons: string[],
  nowMs: number,
  retryMs: number,
  mode: 0 | 1,
  nextMode: IslandingSequencerMode
) {
  if (telemetry.pcsOnOff !== PCS_OFF) {
    if (readyToRetry(state, nowMs, retryMs)) {
      commands.push({ kind: "pcs-on-off", value: PCS_OFF });
      markSent(state, nowMs);
      reasons.push("pcs-off-before-mode-request");
    }
    return;
  }

  if (readyToRetry(state, nowMs, retryMs)) {
    if (telemetry.pcsRunMode !== mode) {
      commands.push({ kind: "pcs-run-mode", value: mode });
    }
    if (telemetry.gridWireConnection !== mode) {
      commands.push({ kind: "grid-wire-connection", value: mode });
    }
    if (commands.length > 0) {
      markSent(state, nowMs);
      reasons.push(mode === RUN_MODE_ISLAND ? "island-mode-request" : "grid-mode-request");
    }
  }
  transition(state, nextMode);
}

function confirmMode(
  telemetry: IslandingSequencerTelemetry,
  state: IslandingSequencerState,
  commands: IslandingSequencerCommand[],
  reasons: string[],
  nowMs: number,
  retryMs: number,
  mode: 0 | 1,
  nextMode: IslandingSequencerMode,
  dwellMs: number
) {
  if (telemetry.pcsOnOff !== PCS_OFF) {
    if (readyToRetry(state, nowMs, retryMs)) {
      commands.push({ kind: "pcs-on-off", value: PCS_OFF });
      markSent(state, nowMs);
      reasons.push("pcs-off-during-confirm-request");
    }
    return;
  }

  const modeOk =
    telemetry.pcsRunMode === mode &&
    telemetry.gridWireConnection === mode &&
    isStandbyOrFault(telemetry.pcsGlobalState);

  if (!modeOk && readyToRetry(state, nowMs, retryMs)) {
    if (telemetry.pcsRunMode !== mode) {
      commands.push({ kind: "pcs-run-mode", value: mode });
    }
    if (telemetry.gridWireConnection !== mode) {
      commands.push({ kind: "grid-wire-connection", value: mode });
    }
    if (commands.length > 0) {
      markSent(state, nowMs);
      reasons.push(mode === RUN_MODE_ISLAND ? "island-mode-reassert" : "grid-mode-reassert");
    }
  }

  if (modeOk) {
    transition(state, nextMode, nowMs + dwellMs);
    reasons.push(mode === RUN_MODE_ISLAND ? "island-mode-confirmed" : "grid-mode-confirmed");
  } else {
    reasons.push(mode === RUN_MODE_ISLAND ? "island-mode-confirm-wait" : "grid-mode-confirm-wait");
  }
}

function updatePhaseAndGridDebounce(
  state: IslandingSequencerState,
  telemetry: IslandingSequencerTelemetry,
  nowMs: number
) {
  if (telemetry.outageDetected) {
    state.phase = "outage";
    state.gridClearSinceMs = undefined;
    return;
  }

  if (state.phase === "outage" || state.gridClearSinceMs == null) {
    state.gridClearSinceMs = nowMs;
  }
  state.phase = "grid";
}

function isGridClearStable(
  state: IslandingSequencerState,
  telemetry: IslandingSequencerTelemetry,
  nowMs: number,
  holdMs: number
): boolean {
  return (
    !telemetry.outageDetected &&
    state.gridClearSinceMs != null &&
    nowMs - state.gridClearSinceMs >= holdMs
  );
}

function isOutagePath(mode: IslandingSequencerMode): boolean {
  return [
    "outage-wait",
    "assert-interlock",
    "pcs-off-to-island",
    "set-island-mode",
    "confirm-island-mode",
    "island-mode-dwell",
    "pcs-on-island",
    "island-hold",
  ].includes(mode);
}

function isGridPath(mode: IslandingSequencerMode): boolean {
  return [
    "grid-wait",
    "pcs-off-to-grid",
    "set-grid-mode",
    "confirm-grid-mode",
    "grid-mode-dwell",
    "pcs-on-grid",
    "clear-interlock",
  ].includes(mode);
}

function isStandbyOrFault(state: number | undefined): boolean {
  return state === 1 || state === 7;
}

function readyToRetry(
  state: IslandingSequencerState,
  nowMs: number,
  retryMs: number
): boolean {
  return state.lastSendMs == null || nowMs - state.lastSendMs >= retryMs;
}

function markSent(state: IslandingSequencerState, nowMs: number) {
  state.lastSendMs = nowMs;
}

function timerExpired(state: IslandingSequencerState, nowMs: number): boolean {
  return state.waitUntilMs == null || nowMs >= state.waitUntilMs;
}

function transition(
  state: IslandingSequencerState,
  mode: IslandingSequencerMode,
  waitUntilMs?: number
) {
  state.mode = mode;
  state.waitUntilMs = waitUntilMs;
  state.lastSendMs = undefined;
}
