import { buildReadPlan } from "../compiler/compiler";
import * as reader from "../reader/reader";
import type { CompilerEnv, ReadPlan, ReaderEnv } from "../types";
import {
  adaptTelemetryTemplateToReadProfile,
  resolveTelemetryTemplate,
  type NormalizedTelemetryProfile,
  type TelemetryTemplateDocument,
} from "./templateAdapter";

export interface TelemetryRuntimeState {
  readPlans: Record<string, ReadPlan>;
}

export interface TelemetryInstance {
  equipmentId: string;
  serverKey: string;
  unitId: number;
}

export interface TelemetryRuntimeResult {
  out1?: any;
  out2?: any;
  out3?: any;
  state: TelemetryRuntimeState;
}

export interface TelemetryRuntimeMessage {
  cmd?: "compile" | "start" | "stop" | "reply";
  profileName?: string;
  profile?: NormalizedTelemetryProfile;
  template?: TelemetryTemplateDocument;
  instance?: TelemetryInstance;
  equipmentId?: string;
  [key: string]: any;
}

export function createTelemetryRuntimeState(): TelemetryRuntimeState {
  return { readPlans: {} };
}

export function handleTelemetryMessage(
  msg: TelemetryRuntimeMessage,
  env: CompilerEnv & ReaderEnv,
  state: TelemetryRuntimeState = createTelemetryRuntimeState(),
  send?: (o1?: any, o2?: any, o3?: any) => void
): TelemetryRuntimeResult {
  const nextState = normalizeState(state);
  const cmd = resolveCommand(msg);

  switch (cmd) {
    case "compile":
      return handleCompile(msg, env, nextState);
    case "start":
      return handleStart(msg, env, nextState, send);
    case "stop":
      return handleStop(msg, nextState);
    case "reply":
      return handleReply(msg, env, nextState);
    default:
      return {
        state: nextState,
        out3: diag({
          error: "unknown-command",
          cmd: msg?.cmd,
          ts: Date.now(),
        }),
      };
  }
}

function handleCompile(
  msg: TelemetryRuntimeMessage,
  env: CompilerEnv,
  state: TelemetryRuntimeState
): TelemetryRuntimeResult {
  const instance = msg.instance;
  if (!instance?.equipmentId || !instance?.serverKey || typeof instance.unitId !== "number") {
    throw new Error("Telemetry runtime error: compile requires instance");
  }

  const profile = resolveProfile(msg);
  const readPlan = buildReadPlan(profile, instance, normalizeCompilerEnv(env));
  state.readPlans[readPlan.equipmentId] = readPlan;

  return {
    state,
    out3: diag({
      state: "compiled",
      equipmentId: readPlan.equipmentId,
      blocks: Array.isArray(readPlan.blocks) ? readPlan.blocks.length : 0,
      ts: Date.now(),
    }),
  };
}

function handleStart(
  msg: TelemetryRuntimeMessage,
  env: ReaderEnv,
  state: TelemetryRuntimeState,
  send?: (o1?: any, o2?: any, o3?: any) => void
): TelemetryRuntimeResult {
  const equipmentId = requiredEquipmentId(msg);
  const plan = state.readPlans[equipmentId];
  if (!plan) {
    return {
      state,
      out3: diag({
        equipmentId,
        error: "missing-readplan",
        ts: Date.now(),
      }),
    };
  }

  if (!send) {
    throw new Error("Telemetry runtime error: start requires send callback");
  }

  reader.start(plan, env, send);
  return {
    state,
    out3: diag({
      equipmentId,
      state: "started",
      ts: Date.now(),
    }),
  };
}

function handleStop(
  msg: TelemetryRuntimeMessage,
  state: TelemetryRuntimeState
): TelemetryRuntimeResult {
  const equipmentId = requiredEquipmentId(msg);
  reader.stop(equipmentId);
  return {
    state,
    out3: diag({
      equipmentId,
      state: "stopped",
      ts: Date.now(),
    }),
  };
}

function handleReply(
  msg: TelemetryRuntimeMessage,
  env: ReaderEnv,
  state: TelemetryRuntimeState
): TelemetryRuntimeResult {
  const equipmentId = msg?._reader?.equipmentId;
  if (!equipmentId || !state.readPlans[equipmentId]) {
    return {
      state,
      out3: diag({
        equipmentId: equipmentId || "(unknown)",
        error: "missing-readplan",
        ts: Date.now(),
      }),
    };
  }

  const out = reader.onReply(msg, state.readPlans[equipmentId], env);
  return {
    state,
    out2: out.out2,
    out3: out.out3,
  };
}

function resolveCommand(msg: TelemetryRuntimeMessage): "compile" | "start" | "stop" | "reply" {
  if (msg?.cmd === "compile" || msg?.cmd === "start" || msg?.cmd === "stop" || msg?.cmd === "reply") {
    return msg.cmd;
  }
  if (msg?._reader?.equipmentId && typeof msg?._reader?.blockIdx === "number") {
    return "reply";
  }
  return "start";
}

function resolveProfile(msg: TelemetryRuntimeMessage): NormalizedTelemetryProfile {
  if (msg.profile) {
    return msg.profile;
  }

  if (msg.template) {
    return adaptTelemetryTemplateToReadProfile(
      msg.profileName || msg.template.device.model,
      msg.template
    );
  }

  if (msg.profileName) {
    const template = resolveTelemetryTemplate(msg.profileName);
    return adaptTelemetryTemplateToReadProfile(msg.profileName, template);
  }

  throw new Error("Telemetry runtime error: compile requires profileName, profile, or template");
}

function normalizeState(state?: TelemetryRuntimeState): TelemetryRuntimeState {
  return {
    readPlans: { ...(state?.readPlans || {}) },
  };
}

function normalizeCompilerEnv(env: CompilerEnv): CompilerEnv {
  return {
    ...env,
    maxQty: env.maxQty ?? env.CompilerMaxQty,
    maxSpan: env.maxSpan ?? env.CompilerMaxSpan,
    maxHole: env.maxHole ?? env.CompilerMaxHole,
    pollFast: env.pollFast ?? env.PollFastMs ?? env.pollDefaults?.fast,
    pollNormal: env.pollNormal ?? env.PollNormalMs ?? env.pollDefaults?.normal,
    pollSlow: env.pollSlow ?? env.PollSlowMs ?? env.pollDefaults?.slow,
  };
}

function requiredEquipmentId(msg: TelemetryRuntimeMessage): string {
  const equipmentId = msg.equipmentId || msg.instance?.equipmentId;
  if (!equipmentId) {
    throw new Error("Telemetry runtime error: equipmentId is required");
  }
  return equipmentId;
}

function diag(payload: any) {
  return { payload };
}
