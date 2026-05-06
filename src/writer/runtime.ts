import { buildModbusWrites, type ControlEnvelope, type WriterOptions } from "./writer";
import {
  adaptTelemetryTemplateToWriteProfile,
  buildTemplateWriteProfile,
  compileWriteProfile,
  type CompiledWriterProfile,
  type NormalizedWriteProfile,
  type WriterInstance,
} from "./templateAdapter";
import type { TelemetryTemplateDocument } from "../telemetry/templateAdapter";

export interface WriterRuntimeState {
  profiles: Record<string, CompiledWriterProfile>;
}

export interface WriterRuntimeEnv extends WriterOptions {
  MODBUS_ZERO_BASED?: boolean;
}

export interface WriterRuntimeMessage {
  cmd?: "compile" | "write";
  profileName?: string;
  profile?: NormalizedWriteProfile;
  template?: TelemetryTemplateDocument;
  instance?: WriterInstance;
  equipmentId?: string;
  topic?: string;
  payload?: any;
  [key: string]: any;
}

export interface WriterRuntimeResult {
  out1?: any[];
  out3?: any;
  state: WriterRuntimeState;
}

export function createWriterRuntimeState(): WriterRuntimeState {
  return { profiles: {} };
}

export function handleWriterMessage(
  msg: WriterRuntimeMessage,
  env: WriterRuntimeEnv = {},
  state: WriterRuntimeState = createWriterRuntimeState(),
  send?: (o1?: any, o2?: any, o3?: any) => void
): WriterRuntimeResult {
  const nextState = normalizeState(state);
  const cmd = resolveCommand(msg);

  switch (cmd) {
    case "compile":
      return handleCompile(msg, nextState);
    case "write":
      return handleWrite(msg, env, nextState, send);
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
  msg: WriterRuntimeMessage,
  state: WriterRuntimeState
): WriterRuntimeResult {
  const instance = msg.instance;
  if (!instance?.equipmentId || !instance?.serverKey || typeof instance.unitId !== "number") {
    throw new Error("Writer runtime error: compile requires instance");
  }

  const compiled = resolveCompiledProfile(msg, instance);
  state.profiles[compiled.equipmentId] = compiled;

  return {
    state,
    out3: diag({
      state: "compiled",
      equipmentId: compiled.equipmentId,
      profileId: compiled.profileId,
      commandCount: compiled.profile.tagsById.size,
      ts: Date.now(),
    }),
  };
}

function handleWrite(
  msg: WriterRuntimeMessage,
  env: WriterRuntimeEnv,
  state: WriterRuntimeState,
  send?: (o1?: any, o2?: any, o3?: any) => void
): WriterRuntimeResult {
  const envelope = normalizeEnvelope(msg);
  const equipmentId = envelope.topic || msg.equipmentId || msg.instance?.equipmentId;
  if (!equipmentId) {
    throw new Error("Writer runtime error: write requires equipmentId/topic");
  }

  const compiled = state.profiles[equipmentId];
  if (!compiled) {
    return {
      state,
      out3: diag({
        equipmentId,
        error: "missing-write-profile",
        ts: Date.now(),
      }),
    };
  }

  const frames = buildModbusWrites(envelope, compiled.profile, env);
  const requests = frames.map((frame, index) =>
    frameToRequest(compiled, frame, env, index)
  );

  if (send) {
    for (const request of requests) {
      send(request, null, null);
    }
  }

  return {
    state,
    out1: requests,
    out3: diag({
      equipmentId,
      state: "write",
      frameCount: requests.length,
      commandCount: Array.isArray(envelope.payload) ? envelope.payload.length : 0,
      ts: Date.now(),
    }),
  };
}

function resolveCommand(msg: WriterRuntimeMessage): "compile" | "write" {
  if (msg?.cmd === "compile" || msg?.cmd === "write") {
    return msg.cmd;
  }
  return "write";
}

function resolveCompiledProfile(
  msg: WriterRuntimeMessage,
  instance: WriterInstance
): CompiledWriterProfile {
  if (msg.profile) {
    return compileWriteProfile(msg.profile, instance);
  }

  if (msg.template) {
    const profileName = msg.profileName || msg.template.device.model;
    const normalized = adaptTelemetryTemplateToWriteProfile(profileName, msg.template);
    return compileWriteProfile(normalized, instance);
  }

  if (msg.profileName) {
    return buildTemplateWriteProfile(msg.profileName, instance);
  }

  throw new Error("Writer runtime error: compile requires profileName, profile, or template");
}

function normalizeEnvelope(msg: WriterRuntimeMessage): ControlEnvelope {
  if (!Array.isArray(msg?.payload)) {
    throw new Error("Writer runtime error: payload must be a ControlCommand[]");
  }

  return {
    topic: String(msg.topic || msg.equipmentId || msg.instance?.equipmentId || ""),
    payload: msg.payload,
  };
}

function frameToRequest(
  compiled: CompiledWriterProfile,
  frame: ReturnType<typeof buildModbusWrites>[number],
  env: WriterRuntimeEnv,
  frameIndex: number
) {
  const address = env.MODBUS_ZERO_BASED
    ? frame.startAddress - 1
    : frame.startAddress;
  const quantity = Array.isArray(frame.values) ? frame.values.length : 1;
  const payloadValue =
    frame.functionCode === 5 && Array.isArray(frame.values)
      ? frame.values[0]
      : frame.values;

  return {
    topic: compiled.equipmentId,
    serverKey: compiled.serverKey,
    unitId: frame.unitId,
    fc: frame.functionCode,
    address,
    quantity,
    payload: {
      value: payloadValue,
      fc: frame.functionCode,
      address,
      quantity,
      unitid: frame.unitId,
    },
    _writer: {
      equipmentId: compiled.equipmentId,
      profileId: compiled.profileId,
      frameIdx: frameIndex,
      sentAt: Date.now(),
    },
  };
}

function normalizeState(state?: WriterRuntimeState): WriterRuntimeState {
  return {
    profiles: { ...(state?.profiles || {}) },
  };
}

function diag(payload: any) {
  return { payload };
}
