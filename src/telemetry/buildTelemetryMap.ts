// src/telemetry/buildTelemetryMap.ts

import { SiteConfig } from "../config";
import { SiteCapabilities } from "../capabilities";

export interface PcsTelemetryTarget {
  type: "pcs280" | "mini";
  // later we can add more fields: cabinet index, bus index, etc.
}

export interface MeterTelemetryTarget {
  type: "egauge" | "acurev" | "other";
  ip: string;
  profile: string; // UDT/profile name, e.g. "udt_eGauge_V1"
}

export interface PvTelemetryTarget {
  type: "acPvInverter";
  ip: string;
  port: number;
  profile: string; // inverter UDT/profile name
  ratedKwAc: number;
  oem: string;
}

export interface TelemetryMap {
  pcs?: PcsTelemetryTarget[];   // not used in your eGauge-only test
  mbmuStrings?: number[];       // not used in your eGauge-only test
  meter?: MeterTelemetryTarget; // this is what we care about right now
  acPvInverters: PvTelemetryTarget[];
}

export function buildTelemetryMap(
  config: SiteConfig,
  caps: SiteCapabilities
): TelemetryMap {
  const result: TelemetryMap = {
    pcs: [],
    mbmuStrings: [],
    meter: undefined,
    acPvInverters: [],
  };

  // ---------------- METER ----------------
  // For your test environment: only eGauge is present.
  // We assume config.metering is populated like:
  // {
  //   meterType: "eGauge-4015",
  //   modbusProfile: "udt_eGauge_V1",
  //   ip: "192.168.1.88",
  //   ...
  // }

  if (config.metering) {
    const m = config.metering;
    const lower = (m.meterType || "").toLowerCase();

    let meterType: MeterTelemetryTarget["type"] = "other";
    if (lower.includes("egauge")) meterType = "egauge";
    else if (lower.includes("acurev")) meterType = "acurev";

    result.meter = {
      type: meterType,
      ip: m.ip,
      profile: m.modbusProfile || "udt_eGauge_V1",
    };
  }

  // ---------------- PCS / MBMU (eSpire280) ----------------
  // We leave these prepared, but you won't use them in the eGauge-only lab.
  if (caps.is280) {
    // later: fill result.pcs and result.mbmuStrings for full 280 telemetry
    result.mbmuStrings = config.mbmu?.sbmuStrings || [];
  }

  // ---------------- AC PV INVERTERS ----------------
  if (config.pv && Array.isArray(config.pv.acInverters)) {
    for (const inv of config.pv.acInverters) {
      result.acPvInverters.push({
        type: "acPvInverter",
        ip: inv.ip,
        port: inv.port ?? 502,
        profile: inv.modbusProfile,
        ratedKwAc: inv.ratedKwAc,
        oem: inv.type,
      });
    }
  }

  return result;
}
