import type {
  TelemetryTemplateCommandEntry,
  TelemetryTemplateDocument,
} from "../telemetry/templateAdapter";
import { resolveTelemetryTemplate } from "../telemetry/templateAdapter";
import type {
  CompiledDevice,
  CompiledProfile,
  CompiledTag,
  ModbusNumericType,
} from "../types";

export interface NormalizedWriteScale {
  mode: "Linear";
  rawLow: number;
  rawHigh: number;
  engLow: number;
  engHigh: number;
  clamp?: boolean;
}

export interface NormalizedWriteCommand {
  name: string;
  function: ModbusNumericType;
  address: number;
  scale?: NormalizedWriteScale;
  readback?: boolean;
}

export interface NormalizedWriteProfile {
  profileId: string;
  commands: NormalizedWriteCommand[];
}

export interface WriterInstance {
  equipmentId: string;
  serverKey: string;
  unitId: number;
}

export interface CompiledWriterProfile {
  equipmentId: string;
  serverKey: string;
  unitId: number;
  profileId: string;
  profile: CompiledProfile;
}

const WRITABLE_FUNCTIONS = new Set<ModbusNumericType>([
  "HR",
  "HRUS",
  "HRI",
  "HRUI",
  "HRI_64",
  "HRF",
  "C",
]);

function fail(message: string): never {
  throw new Error(`Writer template error: ${message}`);
}

export function resolveWriterTemplate(
  profileName: string
): TelemetryTemplateDocument {
  return resolveTelemetryTemplate(profileName);
}

export function adaptTelemetryTemplateToWriteProfile(
  profileName: string,
  template: TelemetryTemplateDocument
): NormalizedWriteProfile {
  return {
    profileId: profileName,
    commands: (template.commands || []).map((entry, index) =>
      adaptCommandEntry(profileName, entry, index)
    ),
  };
}

function adaptCommandEntry(
  profileName: string,
  entry: TelemetryTemplateCommandEntry,
  index: number
): NormalizedWriteCommand {
  if (typeof entry.function !== "string" || !entry.function.trim()) {
    fail(`profile "${profileName}" commands[${index}] is missing function`);
  }
  if (typeof entry.address !== "number" || !Number.isFinite(entry.address)) {
    fail(`profile "${profileName}" commands[${index}] is missing address`);
  }

  const fn = entry.function.trim().toUpperCase() as ModbusNumericType;
  if (!WRITABLE_FUNCTIONS.has(fn)) {
    fail(
      `profile "${profileName}" commands[${index}] uses unsupported write function "${entry.function}"`
    );
  }

  return {
    name: entry.id,
    function: fn,
    address: entry.address,
    scale: normalizeScale(profileName, entry, index),
    readback: entry.readback === true,
  };
}

function normalizeScale(
  profileName: string,
  entry: TelemetryTemplateCommandEntry,
  index: number
): NormalizedWriteScale | undefined {
  const scale = entry.scale;
  if (!scale || !scale.mode || scale.mode === "none") {
    return undefined;
  }
  if (scale.mode !== "Linear") {
    fail(
      `profile "${profileName}" commands[${index}] uses unsupported scale mode "${scale.mode}"`
    );
  }

  const rawLow = Number(scale.rawLow);
  const rawHigh = Number(scale.rawHigh);
  const engLow = Number(scale.engLow ?? scale.scaledLow);
  const engHigh = Number(scale.engHigh ?? scale.scaledHigh);

  if (
    !Number.isFinite(rawLow) ||
    !Number.isFinite(rawHigh) ||
    !Number.isFinite(engLow) ||
    !Number.isFinite(engHigh)
  ) {
    fail(
      `profile "${profileName}" commands[${index}] has malformed Linear scale`
    );
  }

  return {
    mode: "Linear",
    rawLow,
    rawHigh,
    engLow,
    engHigh,
    clamp: scale.clamp,
  };
}

export function compileWriteProfile(
  normalizedProfile: NormalizedWriteProfile,
  instance: WriterInstance
): CompiledWriterProfile {
  if (!instance?.equipmentId || !instance?.serverKey) {
    throw new Error("Writer compile error: equipmentId and serverKey are required");
  }
  if (typeof instance.unitId !== "number" || !Number.isFinite(instance.unitId)) {
    throw new Error("Writer compile error: unitId is required");
  }

  const tagsById = new Map<string, CompiledTag>();
  const devicesByUnitId = new Map<number, CompiledDevice>();

  devicesByUnitId.set(instance.unitId, {
    name: instance.equipmentId,
    unitId: instance.unitId,
    writeConfig: {
      holdingWriteMode: "FC16",
      coilWriteMode: "FC15",
    },
  });

  for (const command of normalizedProfile.commands) {
    tagsById.set(command.name, {
      tagID: command.name,
      unitId: instance.unitId,
      modbusType: command.function,
      address: command.address,
      rawLow: command.scale?.rawLow,
      rawHigh: command.scale?.rawHigh,
      scaledLow: command.scale?.engLow,
      scaledHigh: command.scale?.engHigh,
    });
  }

  return {
    equipmentId: instance.equipmentId,
    serverKey: instance.serverKey,
    unitId: instance.unitId,
    profileId: normalizedProfile.profileId,
    profile: {
      tagsById,
      devicesByUnitId,
    },
  };
}

export function buildTemplateWriteProfile(
  profileName: string,
  instance: WriterInstance
): CompiledWriterProfile {
  if (!profileName || !profileName.trim()) {
    throw new Error("Writer compile error: profileName is required");
  }

  const template = resolveWriterTemplate(profileName);
  const normalized = adaptTelemetryTemplateToWriteProfile(profileName, template);
  return compileWriteProfile(normalized, instance);
}
