// src/capabilities.ts

import { SiteConfig } from "./config";

export interface MiniModelInfo {
  pcsKw: number;
  pvDcKw: number;
  batteryKWh: number;
  voltage: number;
}

/**
 * Parse MINI-60-90-163-480 → { pcsKw:60, pvDcKw:90, batteryKWh:163, voltage:480 }
 */
export function parseMiniModel(systemProfile: string): MiniModelInfo | null {
  if (!systemProfile.startsWith("MINI-")) return null;
  const parts = systemProfile.split("-");
  if (parts.length !== 5) return null;

  const [, pcsStr, pvStr, battStr, voltStr] = parts;
  const pcsKw = Number(pcsStr);
  const pvDcKw = Number(pvStr);
  const batteryKWh = Number(battStr);
  const voltage = Number(voltStr);

  if (
    [pcsKw, pvDcKw, batteryKWh, voltage].some(
      (v) => !Number.isFinite(v) || v <= 0
    )
  ) {
    return null;
  }

  return { pcsKw, pvDcKw, batteryKWh, voltage };
}

export interface SiteCapabilities {
  isMini: boolean;
  is280: boolean;
  hasPcs: boolean;
  hasMbmu: boolean;
  hasGenerator: boolean;
  hasACPV: boolean;
  usesCustomGrid: boolean;
  hasIslanding: boolean;
  hasControllerNetwork: boolean;
  hasMeterIntegration: boolean;
  hasPcsTopology: boolean;
  hasMbmuTopology: boolean;
  hasAcInverterInventory: boolean;
  scheduledControlEnabled: boolean;
  crdRestricted: boolean;
  pvCurtailmentViaModbus: boolean;
  pvCurtailmentViaFrequencyShift: boolean;
  miniModelInfo: MiniModelInfo | null;
}

export function deriveCapabilities(config: SiteConfig): SiteCapabilities {
  const profile = config.system.systemProfile.trim();

  const is280 = profile === "eSpire280";
  const miniModelInfo = parseMiniModel(profile);
  const isMini = !!miniModelInfo;

  const hasPcs = is280 && !!config.pcs;
  const hasMbmu = is280 && !!config.mbmu;
  const hasGenerator = !!config.generator;
  const hasACPV = config.pv.acInverters?.length > 0;
  const usesCustomGrid = config.operation.gridCode === "Custom";
  const hasIslanding = !!config.islanding;
  const hasControllerNetwork =
    !!config.network?.controller?.ip &&
    !!config.network?.controller?.modbusServer?.ip;
  const hasMeterIntegration =
    !!config.metering?.meterType &&
    !!config.metering?.modbusProfile &&
    !!config.metering?.ip;
  const hasPcsTopology = Array.isArray(config.pcs?.pcsDaisyChain) && config.pcs!.pcsDaisyChain.length > 0;
  const hasMbmuTopology = Array.isArray(config.mbmu?.sbmuStrings) && config.mbmu!.sbmuStrings.length > 0;
  const hasAcInverterInventory = Array.isArray(config.pv?.acInverters) && config.pv.acInverters.length > 0;
  const scheduledControlEnabled = !!config.operation.scheduledControlEnabled;
  const crdRestricted = config.operation.crdMode !== "no-restriction";
  const pvCurtailmentViaModbus = config.pv.curtailmentMethod === "modbus";
  const pvCurtailmentViaFrequencyShift =
    config.pv.curtailmentMethod === "frequency-shifting";

  return {
    isMini,
    is280,
    hasPcs,
    hasMbmu,
    hasGenerator,
    hasACPV,
    usesCustomGrid,
    hasIslanding,
    hasControllerNetwork,
    hasMeterIntegration,
    hasPcsTopology,
    hasMbmuTopology,
    hasAcInverterInventory,
    scheduledControlEnabled,
    crdRestricted,
    pvCurtailmentViaModbus,
    pvCurtailmentViaFrequencyShift,
    miniModelInfo,
  };
}
