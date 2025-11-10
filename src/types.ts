export interface BrokerEnv { REQUEST_TIMEOUT_MS: number }

export interface ReaderEnv {
  MODBUS_ZERO_BASED: boolean;
  SCALE_CLAMP_DEFAULT: boolean;
  RESPECT_TAG_CLAMP: boolean;
  SKIP_EMPTY_SAMPLES: boolean;
  MAX_IN_FLIGHT: number;
  REQUEST_TIMEOUT_MS: number;
  JITTER_MS: number;
}

export interface CompilerEnv {
  CompilerMaxQty: number;
  CompilerMaxSpan: number;
  CompilerMaxHole: number;
  PollFastMs: number;
  PollNormalMs: number;
  PollSlowMs: number;
}

export type Endian = "BE" | "LE";
export type WordOrder32 = "ABCD" | "CDAB" | "BADC" | "DCBA";

export interface LinearScale {
  mode: "Linear";
  rawLow: number;
  rawHigh: number;
  engLow: number;
  engHigh: number;
  clamp?: boolean;
}

export interface TagMapItem {
  name?: string;
  tagID?: string;
  offset: number;
  length: number;
  parser?: "U16" | "S16" | "U32" | "F32" | "F64";
  endian?: Endian;
  wordOrder32?: WordOrder32;
  scale?: LinearScale;
  alarm?: "Yes" | "No";
  supportingTag?: "Yes" | "No";
  status?: string;
  pollMs?: number;
}

export interface ReadBlock {
  function: string;
  fc: number;
  start: number;
  quantity: number;
  map: TagMapItem[];
  pollMs: number;
}

export interface ReadPlan {
  equipmentId: string;
  serverKey: string;
  unitId: number;
  blocks: ReadBlock[];
  pollPlan: { fastMs: number; normalMs: number; slowMs: number };
}