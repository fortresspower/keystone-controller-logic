// src/types.ts

//
// ------------------------------------------------------------
//  Core Modbus Types shared by Compiler, Reader, Writer
// ------------------------------------------------------------
//

// ---------------------------
//  Numeric register types
// ---------------------------
export type ModbusNumericType =
  | 'HR'        // 16-bit signed
  | 'HRUS'      // 16-bit unsigned
  | 'HRI'       // 32-bit signed (2 regs)
  | 'HRUI'      // 32-bit unsigned (2 regs)
  | 'HRI_64'    // 64-bit signed (4 regs)
  | 'HRF'       // Float32 (2 regs)
  | 'IR'        // 16-bit signed (READ ONLY)
  | 'IRUS'      // 16-bit unsigned (READ ONLY)
  | 'IRI'       // 32-bit signed (READ ONLY)
  | 'IRUI'      // 32-bit unsigned (READ ONLY)
  | 'IRUI_64'   // 64-bit signed (READ ONLY)
  | 'IRF'       // Float32 (READ ONLY)
  | 'C';        // Coil (boolean read/write)


// ---------------------------
//  Tag model (reader + writer)
// ---------------------------
export interface CompiledTag {
  tagID: string;                 // e.g. "PCS.SYSTEM_ACTIVE_POWER_DEMAND"
  unitId: number;                // Modbus unit ID
  modbusType: ModbusNumericType; // HR*/IR*/C
  address: number;               // zero-based register/coil address

  // Optional scaling fields (writer uses inverse scaling)
  rawLow?: number;
  rawHigh?: number;
  scaledLow?: number;
  scaledHigh?: number;
}


// ---------------------------
//  Per-device write configuration
// ---------------------------
// HR writes:
export type HoldingWriteMode = 'FC6' | 'FC16';

// Coil writes:
export type CoilWriteMode    = 'FC5' | 'FC15';

export interface DeviceWriteConfig {
  holdingWriteMode: HoldingWriteMode;   // FC6 = single-reg, FC16 = multi-reg
  coilWriteMode:    CoilWriteMode;      // FC5 = single-coil, FC15 = multi-coil
}


// ---------------------------
//  Per physical Modbus device
// ---------------------------
export interface CompiledDevice {
  name: string;                  // e.g. "PCS", "BMS", "Fronius1"
  unitId: number;                // Modbus address
  writeConfig: DeviceWriteConfig;
}


// ---------------------------
//  Final compiled profile
// ---------------------------
// This object is created once at boot
// and inserted into Node-RED global context.
export interface CompiledProfile {
  tagsById: Map<string, CompiledTag>;          // Quick lookup by tagID
  devicesByUnitId: Map<number, CompiledDevice>; // Device-level config
}

// ---------------------------------------------------------------------------
// Minimal env + plan types for compiler/reader/broker
// (Placeholder versions so the rest of the code compiles cleanly.)
// You can tighten these later once everything is stable.
// ---------------------------------------------------------------------------

export type CompilerEnv = {
  // Env for the compiler: logger, timeFn, etc.
  // Using loose typing for now.
  [key: string]: any;
};

export type ReaderEnv = {
  // Env for the reader: modbus client(s), logger, scheduler, etc.
  [key: string]: any;
};

export type BrokerEnv = {
  // Env for the broker: mqtt client, logger, etc.
  [key: string]: any;
};

// One entry in the tag map produced by the compiler.
export interface TagMapItem {
  // You can refine this later based on what compiler.ts uses.
  [key: string]: any;
}

// Abstract "read plan" produced by compiler, consumed by reader.
export interface ReadPlan {
  // Again, keep it flexible for now.
  [key: string]: any;
}

// Endianness flag for register decoding.
export type Endian = "BE" | "LE";