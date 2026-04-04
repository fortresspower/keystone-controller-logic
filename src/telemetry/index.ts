// src/telemetry/index.ts
import { SiteConfig } from "../config";
import { SiteCapabilities, deriveCapabilities } from "../capabilities";
import { buildTelemetryMap as _buildTelemetryMap } from "./buildTelemetryMap";
import { buildReadPlan } from "../compiler/compiler";
import type { CompilerEnv, ReadPlan } from "../types";
import {
  adaptTelemetryTemplateToReadProfile,
  resolveTelemetryTemplate,
} from "./templateAdapter";
import {
  createTelemetryRuntimeState,
  handleTelemetryMessage,
} from "./runtime";

// Re-export the function directly on the telemetry namespace
export const buildTelemetryMap = _buildTelemetryMap;
export {
  adaptTelemetryTemplateToReadProfile,
  resolveTelemetryTemplate,
} from "./templateAdapter";
export {
  createTelemetryRuntimeState,
  handleTelemetryMessage,
} from "./runtime";

export function initTelemetry(config: SiteConfig): {
  caps: SiteCapabilities;
  map: ReturnType<typeof _buildTelemetryMap>;
} {
  const caps = deriveCapabilities(config);
  const map = _buildTelemetryMap(config, caps);
  return { caps, map };
}

export function buildTelemetryReadPlan(
  profileName: string,
  instance: { equipmentId: string; serverKey: string; unitId: number },
  env: CompilerEnv
): ReadPlan {
  if (!profileName || !profileName.trim()) {
    throw new Error("Telemetry plan error: profileName is required");
  }

  const template = resolveTelemetryTemplate(profileName);
  const normalizedProfile = adaptTelemetryTemplateToReadProfile(
    profileName,
    template
  );

  return buildReadPlan(normalizedProfile, instance, env);
}

