// src/templates/types.ts
import type { ModbusNumericType, Endian } from "../types";

// If/when we want ASCII like HRS4/IRS4, we'll extend this.
// For now, keep it aligned strictly with ModbusNumericType + optional extras.
export type TemplateModbusType = ModbusNumericType | "DIS" | string;
// "DIS" if you later want discrete inputs,
// string for future expansion like "HRS4", "IRS8" (ASCII).

export interface StatusListItem {
  code: number;                         // raw integer or bit position
  label: string;                        // human-readable label
  severity?: "info" | "warn" | "alarm"; // optional for UI/alarm weighting
}

export interface UdtTag {
  name: string;
  modbusType: TemplateModbusType;
  modbusAddress: number;

  // Optional scaling (same as CompiledTag but at template level)
  scaleMode?: "off" | "linear";
  rawLow?: number;
  rawHigh?: number;
  scaledLow?: number;
  scaledHigh?: number;

  unit?: string;          // purely UI

  alarm?: boolean;        // if true, considered alarm-relevant
  supportingTag?: boolean; // true = internal/aux only

  // Status semantics (only meaningful if statusList exists)
  statusList?: StatusListItem[];
  bitfieldStatus?: boolean; // if true → interpret status as bitfield
  mask?: number;            // integer bitmask (e.g. 3 = 0b11: keep bits 0 and 1)

  // Optional per-tag endian override (defaults to template-level defaultEndian)
  endian?: Endian | "CDAB" | "DCBA";

  description?: string;
}

export interface UdtTemplate {
  name: string;
  // Device / template-level endian default
  defaultEndian?: Endian | "CDAB" | "DCBA";
  tags: UdtTag[];
}
