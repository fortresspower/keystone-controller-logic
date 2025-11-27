// src/config.ts

// ---- Basic string unions / enums ----

export type OperationMode = "grid-tied" | "backup" | "off-grid";

export type GridCode =
  | "IEEE1547-2018"
  | "Rule21"
  | "Rule14H"
  | "PREPA-MTR"
  | "Ontario-ESA"
  | "Custom";

export type CrdMode =
  | "no-restriction"
  | "no-import"
  | "no-export"
  | "no-exchange";

export type PvCurtailmentMethod =
  | "modbus"
  | "frequency-shifting"
  | null
  | undefined;

export type IslandingDeviceType =
  | "SEL351"
  | "SEL751"
  | "SEL851"
  | "ASCO-ATS"
  | "EATON-ATS";

export type GeneratorControlType = "RemoteIO" | "SEL";

// ---- Core interfaces ----

export interface SystemNominal {
  voltageVll: number;   // e.g. 480
  frequencyHz: number;  // e.g. 60
}

export interface SystemConfig {
  /**
   * "eSpire280" or Mini model code like "MINI-60-90-163-480"
   */
  systemProfile: string;

  controllerTimezone: string;           // IANA TZ string
  nominal: SystemNominal;
}

export interface ModbusServerConfig {
  ip: string;
  port: number; // usually 502
}

export interface ControllerNetworkConfig {
  ip: string;
  modbusServer: ModbusServerConfig;
}

export interface NetworkConfig {
  controller: ControllerNetworkConfig;
}

// ---- Operation / grid code ----

export interface VoltageRideThroughBand {
  name: string;
  vMinPu: number;
  vMaxPu: number;
  minRideThroughSec: number;
}

export interface FrequencyRideThroughBand {
  name: string;
  fMinHz: number;
  fMaxHz: number;
  minRideThroughSec: number;
}

export interface VoltVarPoint {
  vPu: number;
  qPu: number;
}

export interface VoltVarProfile {
  enabled: boolean;
  points: VoltVarPoint[];
}

export interface FreqWattProfile {
  enabled: boolean;
  droopPercent: number;
  deadbandHz: number;
  minHz: number;
  maxHz: number;
}

export interface VoltWattPoint {
  vPu: number;
  pPu: number;
}

export interface VoltWattProfile {
  enabled: boolean;
  points: VoltWattPoint[];
}

export interface RampRates {
  startupPctPerSec: number;
  normalPctPerSec: number;
}

export interface ReconnectionProfile {
  delaySec: number;
  vMinPu: number;
  vMaxPu: number;
  fMinHz: number;
  fMaxHz: number;
}

// Only present when gridCode === "Custom"
export interface CustomGridProfile {
  gridProfile: string;
  voltageRideThrough: VoltageRideThroughBand[];
  frequencyRideThrough: FrequencyRideThroughBand[];
  voltVar: VoltVarProfile;
  freqWatt: FreqWattProfile;
  voltWatt: VoltWattProfile;
  rampRates: RampRates;
  reconnection: ReconnectionProfile;
}

export interface OperationConfig {
  mode: OperationMode;
  gridCode: GridCode;
  customGridProfile?: CustomGridProfile;
  crdMode: CrdMode;
  scheduledControlEnabled: boolean;
}

// ---- PCS / MBMU (eSpire280 only) ----

export interface PcsConfig {
  /**
   * eSpire280 ONLY.
   * pcsDaisyChain = [1,2,1] means:
   *  Cabinet 1 → 1 PCS
   *  Cabinet 2 → 2 PCS
   *  Cabinet 3 → 1 PCS
   */
  pcsDaisyChain: number[];

  maxChargeKw: number;
  maxDischargeKw: number;
}

/**
 * eSpire280 ONLY.
 * sbmuStrings = [2,3,2] means:
 *  MBMU #1 → 2 SBMU strings
 *  MBMU #2 → 3 SBMU strings
 *  MBMU #3 → 2 SBMU strings
 */
export interface MbmuConfig {
  sbmuStrings: number[];
}

// ---- Battery ----

export interface BatteryConfig {
  minSoc: number; // 0..1
  maxSoc: number; // 0..1
}

// ---- PV / AC-coupled inverters ----

export interface PvAcInverterConfig {
  type: string;           // "Fronius", "SMA", etc.
  model: string;
  ratedKwAc: number;
  ip: string;
  port: number;
  modbusProfile: string;  // e.g. "fronius_ac_v1"
}

export interface PvConfig {
  acInverters: PvAcInverterConfig[];
  curtailmentMethod?: PvCurtailmentMethod;
}

// ---- Islanding ----

export interface IslandingConfig {
  device: IslandingDeviceType;
}

// ---- Metering ----

export interface MeterReadsConfig {
  pv: boolean;
  pvFromInverter: boolean;
  utility: boolean;
  load: boolean;
}

export interface MeteringConfig {
  meterType: string;      // "eGauge-4015", "Accuenergy-AcuRev", etc.
  modbusProfile: string;  // "udt_eGauge_V1", "acurev_v1", etc.
  ip: string;
  reads: MeterReadsConfig;
}

// ---- Generator ----

export interface GeneratorConfig {
  maxKw: number;
  chargeFromGenerator: boolean;
  chargeKwLimit: number;
  startSoc: number;
  stopSoc: number;
  controlType: GeneratorControlType;
}

// ---- Top-level site config ----

export interface SiteConfig {
  system: SystemConfig;
  network: NetworkConfig;
  operation: OperationConfig;
  pcs?: PcsConfig;          // present only for eSpire280
  mbmu?: MbmuConfig;        // present only for eSpire280
  battery: BatteryConfig;
  pv: PvConfig;
  islanding?: IslandingConfig;
  metering: MeteringConfig;
  generator?: GeneratorConfig;
}
