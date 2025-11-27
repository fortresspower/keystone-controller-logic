// src/telemetry/index.ts
import { SiteConfig } from "../config";
import { SiteCapabilities, deriveCapabilities } from "../capabilities";
import { buildTelemetryMap as _buildTelemetryMap } from "./buildTelemetryMap";

// Re-export the function directly on the telemetry namespace
export const buildTelemetryMap = _buildTelemetryMap;

export function initTelemetry(config: SiteConfig): {
  caps: SiteCapabilities;
  map: ReturnType<typeof _buildTelemetryMap>;
} {
  const caps = deriveCapabilities(config);
  const map = _buildTelemetryMap(config, caps);
  return { caps, map };
}

