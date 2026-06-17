import type { ControlEnvelope } from "../writer/writer";

export interface MiniFaultTelemetry {
  pcsFault?: unknown;
  gridFault?: unknown;
  backupFault?: unknown;
  rsdEpoFault?: unknown;
  bmsFault?: unknown;
  bmsFaultNotAllowHv?: unknown;
  bmsFaultNotAllowLv?: unknown;
  pvdcFaults?: Array<unknown> | Record<string, unknown>;
  fireAlarm?: unknown;
  criticalTelemetryMissing?: boolean;
}

export interface MiniFaultClassification {
  faulted: boolean;
  recoverable: boolean;
  pcsFault: boolean;
  bmsFault: boolean;
  pvdcFault: boolean;
  gridFault: boolean;
  backupFault: boolean;
  rsdEpoFault: boolean;
  fireAlarm: boolean;
  criticalTelemetryMissing: boolean;
  reasons: string[];
}

export type MiniFaultRecoveryMode =
  | "normal"
  | "fault-detected"
  | "safe-zero"
  | "clear-pcs-fault"
  | "clear-pvdc-faults"
  | "start-pcs"
  | "start-pvdc"
  | "verify-recovered"
  | "lockout";

export interface MiniFaultRecoveryState {
  mode: MiniFaultRecoveryMode;
  attempts: number;
  waitUntilMs?: number;
  lastSendMs?: number;
}

export type MiniFaultRecoveryCommand =
  | { kind: "safe-zero" }
  | { kind: "pcs-clear-fault" }
  | { kind: "pvdc-clear-faults" }
  | { kind: "pcs-start" }
  | { kind: "pvdc-start" };

export interface MiniFaultRecoveryOptions {
  maxAttempts?: number;
  retryMs?: number;
  settleMs?: number;
}

export interface MiniFaultRecoveryResult {
  state: MiniFaultRecoveryState;
  commands: MiniFaultRecoveryCommand[];
  classification: MiniFaultClassification;
  reasons: string[];
}

export interface MiniFaultRecoveryWriterOptions {
  pcsTopic?: string;
  pvdcTopics?: string[];
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_MS = 2_000;
const DEFAULT_SETTLE_MS = 5_000;

export function classifyMiniFaults(
  telemetry: MiniFaultTelemetry
): MiniFaultClassification {
  const pcsFault = isActive(telemetry.pcsFault);
  const gridFault = isActive(telemetry.gridFault);
  const backupFault = isActive(telemetry.backupFault);
  const rsdEpoFault = isActive(telemetry.rsdEpoFault);
  const bmsFault =
    isActive(telemetry.bmsFault) ||
    isActive(telemetry.bmsFaultNotAllowHv) ||
    isActive(telemetry.bmsFaultNotAllowLv);
  const pvdcFault = hasAnyActive(telemetry.pvdcFaults);
  const fireAlarm = isActive(telemetry.fireAlarm);
  const criticalTelemetryMissing = telemetry.criticalTelemetryMissing === true;
  const reasons: string[] = [];

  if (pcsFault) reasons.push("mini-pcs-fault");
  if (gridFault) reasons.push("mini-grid-fault");
  if (backupFault) reasons.push("mini-backup-fault");
  if (rsdEpoFault) reasons.push("mini-rsd-epo-fault");
  if (bmsFault) reasons.push("mini-bms-fault");
  if (pvdcFault) reasons.push("mini-pvdc-fault");
  if (fireAlarm) reasons.push("mini-fire-alarm");
  if (criticalTelemetryMissing) reasons.push("mini-critical-telemetry-missing");

  const faulted = reasons.length > 0;
  const recoverable =
    faulted && !fireAlarm && !criticalTelemetryMissing && !bmsFault;

  return {
    faulted,
    recoverable,
    pcsFault,
    bmsFault,
    pvdcFault,
    gridFault,
    backupFault,
    rsdEpoFault,
    fireAlarm,
    criticalTelemetryMissing,
    reasons,
  };
}

export function evaluateMiniFaultRecovery(
  telemetry: MiniFaultTelemetry,
  previousState: MiniFaultRecoveryState = { mode: "normal", attempts: 0 },
  options: MiniFaultRecoveryOptions = {}
): MiniFaultRecoveryResult {
  const nowMs = Date.now();
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const classification = classifyMiniFaults(telemetry);
  const commands: MiniFaultRecoveryCommand[] = [];
  const reasons: string[] = [...classification.reasons];
  const state: MiniFaultRecoveryState = {
    ...previousState,
    mode: previousState.mode || "normal",
    attempts: previousState.attempts || 0,
  };

  if (!classification.faulted) {
    if (state.mode !== "normal") reasons.push("mini-fault-recovered");
    return {
      state: { mode: "normal", attempts: 0 },
      commands,
      classification,
      reasons: reasons.length ? reasons : ["mini-fault-normal"],
    };
  }

  if (!classification.recoverable || state.attempts >= maxAttempts) {
    commands.push({ kind: "safe-zero" });
    return {
      state: { ...state, mode: "lockout" },
      commands,
      classification,
      reasons: [
        ...reasons,
        classification.recoverable
          ? "mini-recovery-attempts-exhausted"
          : "mini-fault-not-auto-recoverable",
      ],
    };
  }

  switch (state.mode) {
    case "normal":
    case "fault-detected":
      state.mode = "safe-zero";
      state.attempts += 1;
      commands.push({ kind: "safe-zero" });
      reasons.push("mini-recovery-safe-zero");
      break;

    case "safe-zero":
      state.mode = classification.pcsFault || classification.gridFault || classification.backupFault || classification.rsdEpoFault
        ? "clear-pcs-fault"
        : "clear-pvdc-faults";
      state.lastSendMs = undefined;
      reasons.push("mini-recovery-clear-next");
      break;

    case "clear-pcs-fault":
      if (readyToRetry(state, nowMs, retryMs)) {
        commands.push({ kind: "pcs-clear-fault" });
        state.lastSendMs = nowMs;
        state.mode = classification.pvdcFault ? "clear-pvdc-faults" : "start-pcs";
        reasons.push("mini-recovery-pcs-clear");
      }
      break;

    case "clear-pvdc-faults":
      if (readyToRetry(state, nowMs, retryMs)) {
        commands.push({ kind: "pvdc-clear-faults" });
        state.lastSendMs = nowMs;
        state.mode = "start-pcs";
        reasons.push("mini-recovery-pvdc-clear");
      }
      break;

    case "start-pcs":
      if (readyToRetry(state, nowMs, retryMs)) {
        commands.push({ kind: "pcs-start" });
        state.lastSendMs = nowMs;
        state.mode = "start-pvdc";
        reasons.push("mini-recovery-pcs-start");
      }
      break;

    case "start-pvdc":
      if (readyToRetry(state, nowMs, retryMs)) {
        commands.push({ kind: "pvdc-start" });
        state.lastSendMs = nowMs;
        state.mode = "verify-recovered";
        state.waitUntilMs = nowMs + settleMs;
        reasons.push("mini-recovery-pvdc-start");
      }
      break;

    case "verify-recovered":
      if (state.waitUntilMs == null || nowMs >= state.waitUntilMs) {
        state.mode = "fault-detected";
        reasons.push("mini-recovery-verify-still-faulted");
      } else {
        reasons.push("mini-recovery-verify-wait");
      }
      break;

    case "lockout":
      commands.push({ kind: "safe-zero" });
      reasons.push("mini-recovery-lockout");
      break;
  }

  return { state, commands, classification, reasons };
}

export function miniFaultRecoveryCommandsToWriterEnvelopes(
  commands: MiniFaultRecoveryCommand[],
  options: MiniFaultRecoveryWriterOptions = {}
): ControlEnvelope[] {
  const pcsPayload: ControlEnvelope["payload"] = [];
  const pvdcPayloadByTopic = new Map<string, ControlEnvelope["payload"]>();
  const pvdcTopics = options.pvdcTopics ?? ["PVDC1", "PVDC2", "PVDC3"];

  for (const command of commands) {
    switch (command.kind) {
      case "safe-zero":
        pcsPayload.push(
          { tagID: "ActivePowerSetpoint", value: 0 },
          { tagID: "MaxChgCurrent", value: 0 },
          { tagID: "MaxDsgCurrent", value: 0 }
        );
        break;
      case "pcs-clear-fault":
        pcsPayload.push({ tagID: "ClearFault", value: 1 });
        break;
      case "pcs-start":
        pcsPayload.push({ tagID: "TotalStart", value: 1 });
        break;
      case "pvdc-clear-faults":
        for (const topic of pvdcTopics) {
          appendPvdcCommand(pvdcPayloadByTopic, topic, "PVDCClearFault");
        }
        break;
      case "pvdc-start":
        for (const topic of pvdcTopics) {
          appendPvdcCommand(pvdcPayloadByTopic, topic, "PVDCStart");
        }
        break;
    }
  }

  const envelopes: ControlEnvelope[] = [];
  if (pcsPayload.length > 0) {
    envelopes.push({ topic: options.pcsTopic ?? "PCS", payload: pcsPayload });
  }
  for (const [topic, payload] of pvdcPayloadByTopic) {
    envelopes.push({ topic, payload });
  }
  return envelopes;
}

function appendPvdcCommand(
  target: Map<string, ControlEnvelope["payload"]>,
  topic: string,
  tagID: string
) {
  const payload = target.get(topic) || [];
  payload.push({ tagID, value: 1 });
  target.set(topic, payload);
}

function readyToRetry(
  state: MiniFaultRecoveryState,
  nowMs: number,
  retryMs: number
): boolean {
  return state.lastSendMs == null || nowMs - state.lastSendMs >= retryMs;
}

function hasAnyActive(value: MiniFaultTelemetry["pvdcFaults"]): boolean {
  if (Array.isArray(value)) return value.some(isActive);
  if (value && typeof value === "object") {
    return Object.values(value).some(isActive);
  }
  return false;
}

function isActive(value: unknown): boolean {
  if (value == null || value === false) return false;
  if (value === true) return true;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric !== 0 : Boolean(value);
}
