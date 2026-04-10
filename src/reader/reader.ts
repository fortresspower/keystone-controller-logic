import type { ReadPlan, ReaderEnv, TagMapItem, Endian } from "../types";

type EquipId = string;

interface Runtime {
  timers: NodeJS.Timeout[];
  inflight: number;
  values: Record<string, any>;
  pending: Set<string>;
  nextReqId: number;
}

const RUNTIMES = new Map<EquipId, Runtime>();

// ---------------------- scheduler ----------------------
export function start(
  plan: ReadPlan,
  env: ReaderEnv,
  send: (o1?: any, o2?: any, o3?: any) => void
) {
  stop(plan.equipmentId);
  const rt: Runtime = {
    timers: [],
    inflight: 0,
    values: {},
    pending: new Set<string>(),
    nextReqId: 1,
  };
  const mkAddr = (s: number) => (env.MODBUS_ZERO_BASED ? s - 1 : s);
  const constants = Array.isArray((plan as any).constants)
    ? (plan as any).constants
    : [];
  const virtuals = Array.isArray((plan as any).virtuals)
    ? (plan as any).virtuals
    : [];

  if (constants.length) {
    for (const item of constants) {
      rt.values[item.tagID] = item.value;
    }
    send(
      null,
      constants.map((item: any) => ({
        tagID: item.tagID,
        value: item.value,
        timestamp: Date.now(),
        alarm: item.alarm || "No",
        supportingTag: item.supportingTag || "No",
      })),
      {
        payload: {
          equipmentId: plan.equipmentId,
          state: "constants",
          count: constants.length,
          ts: Date.now(),
        },
      }
    );
  }

  if (virtuals.length) {
    send(
      null,
      null,
      {
        payload: {
          equipmentId: plan.equipmentId,
          state: "virtual-tags-skipped",
          count: virtuals.length,
          tagIDs: virtuals.map((item: any) => item.tagID),
          ts: Date.now(),
        },
      }
    );
  }

  RUNTIMES.set(plan.equipmentId, rt);

  const poll = (i: number, blk: ReadPlan["blocks"][number]) => {
    if (rt.inflight >= (env.MAX_IN_FLIGHT ?? 1)) return;
    const reqKey = `${i}:${rt.nextReqId++}`;
    rt.inflight++;
    rt.pending.add(reqKey);
    const req = {
      _reader: {
        equipmentId: plan.equipmentId,
        blockIdx: i,
        sentAt: Date.now(),
        reqKey,
      },
      serverKey: plan.serverKey,
      unitId: plan.unitId,
      fc: blk.fc,
      address: mkAddr(blk.start),
      quantity: blk.quantity,
      payload: {
        unitid: plan.unitId,
        fc: blk.fc,
        address: mkAddr(blk.start),
        quantity: blk.quantity,
      },
    };
    send(req, null, {
      payload: {
        equipmentId: plan.equipmentId,
        blockIdx: i,
        state: "poll",
        periodMs: blk.pollMs,
        ts: Date.now(),
      },
    });
    setTimeout(() => {
      if (rt.pending.delete(reqKey)) {
        rt.inflight = Math.max(0, rt.inflight - 1);
      }
    }, (env.REQUEST_TIMEOUT_MS ?? 1500) + 10);
  };

  const recurringCounts = new Map<number, number>();
  for (const blk of plan.blocks) {
    if ((blk as any).startupOnly) continue;
    const period = Math.max(1, Number(blk.pollMs || 1000));
    recurringCounts.set(period, (recurringCounts.get(period) || 0) + 1);
  }
  const recurringSlots = new Map<number, number>();

  for (let i = 0; i < plan.blocks.length; i++) {
    const blk = plan.blocks[i];
    const period = Math.max(1, Number(blk.pollMs || 1000));
    const jitter = Math.max(0, Number(env.JITTER_MS || 0));
    const slotCount = recurringCounts.get(period) || 1;
    const slotIndex = recurringSlots.get(period) || 0;
    if (!(blk as any).startupOnly) {
      recurringSlots.set(period, slotIndex + 1);
    }
    const baseDelay = (blk as any).startupOnly
      ? 0
      : Math.floor((period * slotIndex) / slotCount);
    const jitterDelay = jitter ? Math.floor(Math.random() * jitter) : 0;
    const delay = baseDelay + jitterDelay;
    const t0 = setTimeout(() => {
      poll(i, blk);
      if ((blk as any).startupOnly) {
        return;
      }
      const t = setInterval(() => poll(i, blk), period);
      rt.timers.push(t);
    }, delay);
    rt.timers.push(t0);
  }
}

export function stop(equipmentId: string) {
  const rt = RUNTIMES.get(equipmentId);
  if (!rt) return;
  rt.timers.forEach(clearInterval);
  RUNTIMES.delete(equipmentId);
}

// ---------------------- parsing helpers ----------------------
function regsFrom(msg: any): number[] {
  if (Array.isArray(msg?.payload)) return msg.payload;
  if (Array.isArray(msg?.payload?.data)) return msg.payload.data;
  if (Array.isArray(msg?.payload?.register)) return msg.payload.register;
  if (Array.isArray(msg?.responseBuffer?.data)) return msg.responseBuffer.data;
  return [];
}

function clamp(v: number, lo: number | string, hi: number | string) {
  const low = Number(lo);
  const high = Number(hi);

  if (!Number.isFinite(low) || !Number.isFinite(high)) {
    // if the scale values are garbage, just return v unchanged
    return v;
  }

  return Math.max(low, Math.min(high, v));
}


function f32(hi: number, lo: number) {
  const buf = new ArrayBuffer(4);
  const dv = new DataView(buf);
  dv.setUint16(0, hi, false);
  dv.setUint16(2, lo, false);
  return dv.getFloat32(0, false);
}

function f64(words: number[]) {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setUint32(0, (words[0] << 16) | words[1], false);
  dv.setUint32(4, (words[2] << 16) | words[3], false);
  return dv.getFloat64(0, false);
}

type ParserKind =
  | "S16" | "U16"
  | "S32" | "U32"
  | "F32" | "F64"
  | "U64" | "S64"
  | "C"
  | "STR";

function parseValue(regs: number[], base: number, item: TagMapItem) {
  const endian: Endian = (item as any).endian || "BE";
  const be = endian === "BE";
  const off = base + (item.offset ?? 0);
  const len = item.length || 1;
  const parser = ((item as any).parser as ParserKind) || "U16";
  const rd = (i: number) => regs[i] ?? 0;

  // Coil handling: Node-RED modbus-flex returns an array of bits; we use the first value.
  if (parser === "C") {
    return regs[0] ?? 0;
  }

  switch (parser) {
    case "U16": {
      return rd(off) >>> 0;
    }
    case "S16": {
      let v = rd(off) & 0xffff;
      if (v & 0x8000) v -= 0x10000;
      return v;
    }
    case "U32":
    case "S32": {
      const a = rd(off);
      const b = rd(off + 1);
      const hi =
        (item as any).wordOrder32 === "CDAB" || (item as any).wordOrder32 === "BADC" ? b : a;
      const lo =
        (item as any).wordOrder32 === "CDAB" || (item as any).wordOrder32 === "BADC" ? a : b;

      let u = be
        ? ((hi << 16) >>> 0) | (lo >>> 0)
        : ((lo << 16) >>> 0) | (hi >>> 0);

      if (parser === "S32" && u > 0x7fffffff) {
        u = u - 0x100000000;
      }
      return u;
    }
    case "F32": {
      const a = rd(off);
      const b = rd(off + 1);
      const hi =
        (item as any).wordOrder32 === "CDAB" || (item as any).wordOrder32 === "BADC" ? b : a;
      const lo =
        (item as any).wordOrder32 === "CDAB" || (item as any).wordOrder32 === "BADC" ? a : b;
      return f32(hi, lo);
    }
    case "F64":
    case "U64":
    case "S64": {
      return f64([
        rd(off),
        rd(off + 1),
        rd(off + 2),
        rd(off + 3),
      ]);
    }
    case "STR": {
      const chars: number[] = [];
      for (let i = 0; i < len; i++) {
        const word = rd(off + i);
        const ch = word & 0xff;  // 1 char per 16-bit word (your latest rule)
        if (ch) chars.push(ch);
      }
      return String.fromCharCode(...chars).replace(/\u0000+$/, "");
    }
    default:
      return rd(off) >>> 0;
  }
}

function applyScale(rawVal: any, item: TagMapItem, env: ReaderEnv): any {
  // If the parsed value is not a number (e.g., STR, C), do NOT attempt scaling.
  if (typeof rawVal !== "number" || !Number.isFinite(rawVal)) {
    return rawVal;
  }

  const s = (item as any).scale;
  if (!s || s.mode !== "Linear") return rawVal;

  const rawLow = Number(s.rawLow);
  const rawHigh = Number(s.rawHigh);
  const engLow = Number(s.engLow ?? s.scaledLow);
  const engHigh = Number(s.engHigh ?? s.scaledHigh);

  if (
    !Number.isFinite(rawLow) ||
    !Number.isFinite(rawHigh) ||
    !Number.isFinite(engLow) ||
    !Number.isFinite(engHigh)
  ) {
    return rawVal;
  }

  if (rawHigh === rawLow) return engLow;

  let out =
    engLow +
    ((rawVal - rawLow) / (rawHigh - rawLow)) * (engHigh - engLow);

  // Trim binary floating-point noise so scaled values like 1 do not surface as
  // 1.000000000003638 in telemetry payloads.
  out = Number(out.toFixed(9));

  const doClamp = env.RESPECT_TAG_CLAMP ? !!s.clamp : !!env.SCALE_CLAMP_DEFAULT;
  if (!doClamp) return out;

  const lo = Math.min(engLow, engHigh);
  const hi = Math.max(engLow, engHigh);
  return clamp(out, lo, hi);
}

function decodeStatusMeta(value: any, item: TagMapItem) {
  const out: Record<string, any> = {};
  const enumStatus = (item as any).enumStatus;
  if (enumStatus && typeof enumStatus === "object") {
    const enumKey = String(value);
    if (typeof enumStatus[enumKey] === "string") {
      out.enumLabel = enumStatus[enumKey];
    }
  }

  const bitfieldStatus = (item as any).bitfieldStatus;
  if (typeof value === "number" && Number.isInteger(value) && bitfieldStatus) {
    const unsignedValue = value >>> 0;
    const activeBits: number[] = [];
    const activeLabels: string[] = [];

    if (bitfieldStatus === true) {
      for (let bit = 0; bit < 32; bit++) {
        if (((unsignedValue >>> bit) & 0x1) === 1) {
          activeBits.push(bit);
        }
      }
      out.activeBits = activeBits;
    } else if (typeof bitfieldStatus === "object") {
      for (const [bitKey, label] of Object.entries(bitfieldStatus)) {
        const bit = Number(bitKey);
        if (!Number.isInteger(bit) || bit < 0 || bit > 31) continue;
        if (((unsignedValue >>> bit) & 0x1) === 1) {
          activeBits.push(bit);
          if (typeof label === "string") {
            activeLabels.push(label);
          }
        }
      }
      out.activeBits = activeBits;
      out.activeLabels = activeLabels;
    }
  }

  return out;
}

function buildStatusTextSample(tagID: string, value: any, statusMeta: Record<string, any>) {
  let textValue: string | undefined;

  if (typeof statusMeta.enumLabel === "string" && statusMeta.enumLabel.trim()) {
    textValue = statusMeta.enumLabel;
  } else if (Array.isArray(statusMeta.activeLabels) && statusMeta.activeLabels.length) {
    textValue = statusMeta.activeLabels.join(", ");
  } else if (Array.isArray(statusMeta.activeBits)) {
    textValue = statusMeta.activeBits.length ? statusMeta.activeBits.join(",") : "";
  }

  if (textValue === undefined) {
    return undefined;
  }

  return {
    tagID: `${tagID}_str`,
    value: textValue,
    rawValue: value,
    supportingTag: "No",
  };
}




// ---------------------- main reply handler ----------------------
export function onReply(
  msg: any,
  plan: ReadPlan,
  env: ReaderEnv
): { out2?: any; out3?: any } {
  const eq = msg?._reader?.equipmentId;
  const idx = msg?._reader?.blockIdx;
  const diag = (p: any) => ({ payload: p });

  if (!plan || eq !== plan.equipmentId || typeof idx !== "number") {
    return {
      out3: diag({
        equipmentId: eq || "(unknown)",
        error: "no-plan-or-index",
        ts: Date.now(),
      }),
    };
  }

  const blk = plan.blocks[idx];
  const rt = RUNTIMES.get(plan.equipmentId);
  const reqKey = msg?._reader?.reqKey;
  if (rt && typeof reqKey === "string" && rt.pending.delete(reqKey)) {
    rt.inflight = Math.max(0, rt.inflight - 1);
  }
  if (!blk) {
    return {
      out3: diag({
        equipmentId: eq,
        blockIdx: idx,
        error: "no-block",
        ts: Date.now(),
      }),
    };
  }

  const regs = regsFrom(msg);
  const need = blk.quantity;
  const have = regs.length;

  const warnings: string[] = [];
  if (have < need) warnings.push("qty-mismatch");

  const samples: any[] = [];
  for (const item of blk.map as TagMapItem[]) {
    const last = (item.offset ?? 0) + Math.max(1, item.length || 1) - 1;
    if (last >= have) {
      warnings.push("short-slice");
      continue;
    }
    let value = parseValue(regs, 0, item);
    value = applyScale(value, item, env);
    const tagID = (item as any).tagID || item.name || "";
    if (!env.SKIP_EMPTY_SAMPLES || value !== null) {
      const statusMeta = decodeStatusMeta(value, item);
      const timestamp = Date.now();
      samples.push({
        tagID,
        value,
        timestamp,
        alarm: (item as any).alarm || "No",
        supportingTag: (item as any).supportingTag || "No",
        ...statusMeta,
      });
      const statusTextSample = buildStatusTextSample(tagID, value, statusMeta);
      if (statusTextSample) {
        samples.push({
          ...statusTextSample,
          timestamp,
        });
      }
    }
  }

  if (rt) {
    for (const sample of samples) {
      rt.values[sample.tagID] = sample.value;
    }
  }

  const derived = evaluateCalculatedTags(plan, rt?.values || {});
  if (derived.length) {
    samples.push(...derived);
  }

  if (!samples.length) {
    return {
      out3: diag({
        equipmentId: eq,
        blockIdx: idx,
        warnings,
        state: "empty",
        ts: Date.now(),
      }),
    };
  }

  return {
    out2: samples,
    out3: diag({
      equipmentId: eq,
      blockIdx: idx,
      have,
      need,
      warnings,
      ts: Date.now(),
    }),
  };
}

function evaluateCalculatedTags(plan: ReadPlan, values: Record<string, any>) {
  const calcs = Array.isArray((plan as any).calcs) ? (plan as any).calcs : [];
  const out: any[] = [];

  for (const calc of calcs) {
    const scope: Record<string, number> = {};
    let missing = false;

    for (const [name, tagID] of Object.entries(calc.inputs || {})) {
      const value = values[tagID as string];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        missing = true;
        break;
      }
      scope[name] = value;
    }

    if (missing) continue;

    const value = evalCalcExpr(calc.expr, scope);
    if (!Number.isFinite(value)) continue;

    out.push({
      tagID: calc.tagID,
      value,
      timestamp: Date.now(),
      alarm: calc.alarm || "No",
      supportingTag: calc.supportingTag || "No",
    });
  }

  return out;
}

function evalCalcExpr(expr: string, scope: Record<string, number>) {
  const names = Object.keys(scope);
  const vals = names.map((name) => scope[name]);
  const fn = new Function(
    ...names,
    "abs",
    "min",
    "max",
    "pow",
    `return (${expr});`
  ) as (...args: any[]) => number;

  return fn(...vals, Math.abs, Math.min, Math.max, Math.pow);
}
