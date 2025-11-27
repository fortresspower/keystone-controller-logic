// src/writer/writer.ts

import {
  CompiledProfile,
  CompiledTag,
  HoldingWriteMode,
  CoilWriteMode
} from '../types';

// ---------------- Public API ----------------

export interface ControlCommand {
  tagID: string;
  value: number | boolean;
}

export interface ControlEnvelope {
  topic: string;     // metadata only: 'PCS', 'BMS', 'PV', 'GEN', etc.
  payload: ControlCommand[];
}

export interface WriterOptions {
  maxRegistersPerFrame?: number;   // only applies to FC16 devices
  maxCoilsPerFrame?: number;       // only applies to FC15 devices
}

export interface ModbusWriteFrame {
  unitId: number;
  functionCode: 5 | 6 | 15 | 16;
  startAddress: number;
  values: number[] | boolean[];
}

// -------------- Internal structs --------------

interface RegWrite {
  unitId: number;
  address: number;
  values: number[];
}

interface CoilWrite {
  unitId: number;
  address: number;
  value: boolean;
}

// ---------------- Entry point ----------------

export function buildModbusWrites(
  envelopeOrArray: ControlEnvelope | ControlEnvelope[],
  profile: CompiledProfile,
  options: WriterOptions = {}
): ModbusWriteFrame[] {

  const envelopes = Array.isArray(envelopeOrArray)
    ? envelopeOrArray
    : [envelopeOrArray];

  const maxRegs  = options.maxRegistersPerFrame ?? 120;
  const maxCoils = options.maxCoilsPerFrame ?? 120;

  const regWrites: RegWrite[] = [];
  const coilWrites: CoilWrite[] = [];

  for (const env of envelopes) {
    if (!env?.payload) continue;

    for (const cmd of env.payload) {
      const tag = profile.tagsById.get(cmd.tagID);
      if (!tag) continue;

      // ----- COIL -----
      if (tag.modbusType === 'C') {
        const b = toBoolean(cmd.value);
        if (b === null) continue;

        coilWrites.push({
          unitId: tag.unitId,
          address: tag.address,
          value: b
        });
        continue;
      }

      // ----- HOLDING REGISTER ONLY -----
      const regs = encodeHRRegisters(tag, cmd.value);
      if (!regs) continue;

      regWrites.push({
        unitId: tag.unitId,
        address: tag.address,
        values: regs
      });
    }
  }

  const regFrames  = groupHoldingWrites(regWrites, profile, maxRegs);
  const coilFrames = groupCoilWrites(coilWrites, profile, maxCoils);

  return [...regFrames, ...coilFrames];
}

//
// ---------------- Encoding: value → HR registers ----------------
//

function encodeHRRegisters(
  tag: CompiledTag,
  value: number | boolean
): number[] | null {

  // IR* types = read-only → ignore
  if (tag.modbusType.startsWith('IR')) return null;

  const engVal = Number(value);
  if (!Number.isFinite(engVal)) return null;

  const raw = applyInverseScaling(tag, engVal);

  switch (tag.modbusType) {

    case 'HR':    // signed 16
      return [toInt16(raw)];

    case 'HRUS':  // unsigned 16
      return [toUint16(raw)];

    case 'HRI':   // signed 32
      return int32ToRegisters(raw);

    case 'HRUI':  // unsigned 32
      return uint32ToRegisters(raw);

    case 'HRI_64': // signed 64
      return int64ToRegisters(raw);

    case 'HRF':    // float32, 2 registers
      return float32ToRegisters(engVal);

    default:
      return null;
  }
}

//
// ---------------- Scaling (inverse of reader) ----------------
//

function applyInverseScaling(tag: CompiledTag, engVal: number): number {
  const { rawLow, rawHigh, scaledLow, scaledHigh } = tag;

  if (
    rawLow == null || rawHigh == null ||
    scaledLow == null || scaledHigh == null ||
    rawHigh === rawLow || scaledHigh === scaledLow
  ) {
    return engVal;
  }

  return (
    rawLow +
    ((engVal - scaledLow) * (rawHigh - rawLow)) /
    (scaledHigh - scaledLow)
  );
}

//
// ---------------- Primitive encoders ----------------
//

function toInt16(x: number): number {
  let v = Math.round(x);
  if (v < -32768) v = -32768;
  if (v > 32767)  v = 32767;
  return v & 0xffff;
}

function toUint16(x: number): number {
  let v = Math.round(x);
  if (v < 0) v = 0;
  if (v > 0xffff) v = 0xffff;
  return v;
}

function int32ToRegisters(x: number): number[] {
  let v = Math.round(x) | 0;
  return [
    (v >> 16) & 0xffff,
    v & 0xffff
  ];
}

function uint32ToRegisters(x: number): number[] {
  let v = Math.round(x);
  if (v < 0) v = 0;
  if (v > 0xffffffff) v = 0xffffffff;

  return [
    (v >>> 16) & 0xffff,
    v & 0xffff
  ];
}

function int64ToRegisters(x: number): number[] {
  let v = BigInt(Math.trunc(x));
  const regs = new Array<number>(4);
  const mask = BigInt(0xffff);

  for (let i = 3; i >= 0; i--) {
    regs[i] = Number(v & mask);
    v >>= BigInt(16);
  }
  return regs;
}

function float32ToRegisters(val: number): number[] {
  const buf = new ArrayBuffer(4);
  const view = new DataView(buf);
  view.setFloat32(0, val, false); // big-endian
  return [
    view.getUint16(0, false),
    view.getUint16(2, false)
  ];
}

//
// ---------------- Grouping logic (FC6/FC16, FC5/FC15) ----------------
//

function groupHoldingWrites(
  writes: RegWrite[],
  profile: CompiledProfile,
  maxRegs: number
): ModbusWriteFrame[] {

  const frames: ModbusWriteFrame[] = [];

  writes.sort((a, b) =>
    a.unitId === b.unitId ? a.address - b.address : a.unitId - b.unitId
  );

  let i = 0;
  while (i < writes.length) {
    const unitId = writes[i].unitId;
    const device = profile.devicesByUnitId.get(unitId);
    const mode: HoldingWriteMode = device?.writeConfig?.holdingWriteMode ?? 'FC16';

    if (mode === 'FC6') {
      // SINGLE register FC6 per value
      const w = writes[i++];
      for (let k = 0; k < w.values.length; k++) {
        frames.push({
          unitId,
          functionCode: 6,
          startAddress: w.address + k,
          values: [w.values[k]]
        });
      }
      continue;
    }

    // FC16 batching
    let startAddr = writes[i].address;
    const buffer = [...writes[i].values];
    let lastEnd = startAddr + writes[i].values.length;
    i++;

    while (
      i < writes.length &&
      writes[i].unitId === unitId &&
      writes[i].address === lastEnd &&
      buffer.length + writes[i].values.length <= maxRegs
    ) {
      buffer.push(...writes[i].values);
      lastEnd += writes[i].values.length;
      i++;
    }

    frames.push({
      unitId,
      functionCode: 16,
      startAddress: startAddr,
      values: buffer
    });
  }

  return frames;
}

function groupCoilWrites(
  writes: CoilWrite[],
  profile: CompiledProfile,
  maxCoils: number
): ModbusWriteFrame[] {

  const frames: ModbusWriteFrame[] = [];

  writes.sort((a, b) =>
    a.unitId === b.unitId ? a.address - b.address : a.unitId - b.unitId
  );

  let i = 0;
  while (i < writes.length) {
    const unitId = writes[i].unitId;
    const device = profile.devicesByUnitId.get(unitId);
    const mode: CoilWriteMode = device?.writeConfig?.coilWriteMode ?? 'FC15';

    if (mode === 'FC5') {
      const w = writes[i++];
      frames.push({
        unitId,
        functionCode: 5,
        startAddress: w.address,
        values: [w.value]
      });
      continue;
    }

    // FC15 batching
    let startAddr = writes[i].address;
    const values: boolean[] = [writes[i].value];
    let lastAddr = startAddr;
    i++;

    while (
      i < writes.length &&
      writes[i].unitId === unitId &&
      writes[i].address === lastAddr + 1 &&
      values.length < maxCoils
    ) {
      values.push(writes[i].value);
      lastAddr = writes[i].address;
      i++;
    }

    if (values.length === 1) {
      frames.push({
        unitId,
        functionCode: 5,
        startAddress: startAddr,
        values
      });
    } else {
      frames.push({
        unitId,
        functionCode: 15,
        startAddress: startAddr,
        values
      });
    }
  }

  return frames;
}

//
// ---------------- Helpers ----------------
//

function toBoolean(value: number | boolean): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return null;
}
