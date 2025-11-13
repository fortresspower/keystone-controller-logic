import type { ReadPlan, ReaderEnv, TagMapItem, Endian, WordOrder32 } from "../types";

type EquipId = string;
interface Runtime {
  timers: NodeJS.Timeout[];
  inflight: number;
}
const RUNTIMES = new Map<EquipId, Runtime>();

// ---------------------- scheduler ----------------------
export function start(plan: ReadPlan, env: ReaderEnv, send: (o1?: any, o2?: any, o3?: any) => void) {
  stop(plan.equipmentId);
  const rt: Runtime = { timers: [], inflight: 0 };
  const mkAddr = (s: number) => (env.MODBUS_ZERO_BASED ? s - 1 : s);

  const poll = (i: number, blk: ReadPlan["blocks"][number]) => {
    if (rt.inflight >= (env.MAX_IN_FLIGHT ?? 1)) return;
    rt.inflight++;
    const req = {
      _reader: { equipmentId: plan.equipmentId, blockIdx: i, sentAt: Date.now() },
      serverKey: plan.serverKey,
      unitId: plan.unitId,
      fc: blk.fc,
      address: mkAddr(blk.start),
      quantity: blk.quantity,
      payload: { unitid: plan.unitId, fc: blk.fc, address: mkAddr(blk.start), quantity: blk.quantity },
    };
    send(req, null, {
      payload: { equipmentId: plan.equipmentId, blockIdx: i, state: "poll", periodMs: blk.pollMs, ts: Date.now() },
    });
    setTimeout(() => {
      rt.inflight = Math.max(0, rt.inflight - 1);
    }, (env.REQUEST_TIMEOUT_MS ?? 1500) + 10);
  };

  for (let i = 0; i < plan.blocks.length; i++) {
    const blk = plan.blocks[i];
    const period = Math.max(1, Number(blk.pollMs || 1000));
    const jitter = Math.max(0, Number(env.JITTER_MS || 0));
    const delay = jitter ? Math.floor(Math.random() * jitter) : 0;
    const t0 = setTimeout(() => {
      const t = setInterval(() => poll(i, blk), period);
      rt.timers.push(t);
    }, delay);
    rt.timers.push(t0);
  }
  RUNTIMES.set(plan.equipmentId, rt);
}

export function stop(equipmentId: string) {
  const rt = RUNTIMES.get(equipmentId);
  if (!rt) return;
  rt.timers.forEach(clearInterval);
  RUNTIMES.delete(equipmentId);
}

// ---------------------- parsing ----------------------
function regsFrom(msg: any): number[] {
  if (Array.isArray(msg?.payload)) return msg.payload;
  if (Array.isArray(msg?.payload?.data)) return msg.payload.data;
  if (Array.isArray(msg?.payload?.register)) return msg.payload.register;
  if (Array.isArray(msg?.responseBuffer?.data)) return msg.responseBuffer.data;
  return [];
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
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

function parseValue(regs: number[], base: number, item: TagMapItem) {
  const endian: Endian = item.endian || "BE";
  const be = endian === "BE";
  const off = base + item.offset;
  const len = item.length || 1;

  // 👇 widen to string so "C" comparison is allowed
  const parser: string = (item.parser || (len === 1 ? "U16" : len === 2 ? "U32" : "F64")) as string;

  const rd = (i: number) => regs[i] ?? 0;

  // Coil handling: Node-RED modbus-flex returns an array of bits; we use the first bit.
  if (parser === "C") {
    // Same behavior as old subflow: registerData[0]
    return regs[0] ?? 0;
  }

  switch (parser) {
    case "U16":
      return rd(off) >>> 0;
    case "S16": {
      let v = rd(off) & 0xffff;
      if (v & 0x8000) v -= 0x10000;
      return v;
    }
    case "U32": {
      const a = rd(off),
        b = rd(off + 1);
      const hi = item.wordOrder32 === "CDAB" || item.wordOrder32 === "BADC" ? b : a;
      const lo = item.wordOrder32 === "CDAB" || item.wordOrder32 === "BADC" ? a : b;
      return be ? ((hi << 16) >>> 0) | (lo >>> 0) : ((lo << 16) >>> 0) | (hi >>> 0);
    }
    case "F32": {
      const a = rd(off),
        b = rd(off + 1);
      const hi = item.wordOrder32 === "CDAB" || item.wordOrder32 === "BADC" ? b : a;
      const lo = item.wordOrder32 === "CDAB" || item.wordOrder32 === "BADC" ? a : b;
      return f32(hi, lo);
    }
    case "F64":
      return f64([rd(off), rd(off + 1), rd(off + 2), rd(off + 3)]);
    default:
      return rd(off) >>> 0;
  }
}

function applyScale(val: number, item: TagMapItem, env: ReaderEnv) {
  const s = item.scale;
  if (!s || s.mode !== "Linear") return val;
  if (s.rawHigh === s.rawLow) return s.engLow;
  let out = s.engLow + ((val - s.rawLow) / (s.rawHigh - s.rawLow)) * (s.engHigh - s.engLow);
  const doClamp = env.RESPECT_TAG_CLAMP ? !!s.clamp : !!env.SCALE_CLAMP_DEFAULT;
  return doClamp ? clamp(out, Math.min(s.engLow, s.engHigh), Math.max(s.engLow, s.engHigh)) : out;
}

// ---------------------- main reply handler ----------------------
export function onReply(msg: any, plan: ReadPlan, env: ReaderEnv): { out2?: any; out3?: any } {
  const eq = msg?._reader?.equipmentId,
    idx = msg?._reader?.blockIdx;
  const diag = (p: any) => ({ payload: p });
  if (!plan || eq !== plan.equipmentId || typeof idx !== "number")
    return { out3: diag({ equipmentId: eq || "(unknown)", error: "no-plan-or-index", ts: Date.now() }) };

  const blk = plan.blocks[idx];
  if (!blk) return { out3: diag({ equipmentId: eq, blockIdx: idx, error: "no-block", ts: Date.now() }) };

  const regs = regsFrom(msg),
    need = blk.quantity,
    have = regs.length;
  const warnings: string[] = [];
  if (have < need) warnings.push("qty-mismatch");

  const samples: any[] = [];
  for (const item of blk.map) {
    const last = item.offset + Math.max(1, item.length || 1) - 1;
    if (last >= have) {
      warnings.push("short-slice");
      continue;
    }
    let value = parseValue(regs, 0, item);
    value = applyScale(value, item, env);
    const tagID = item.tagID || item.name || "";
    if (!env.SKIP_EMPTY_SAMPLES || value !== null) {
      samples.push({
        tagID,
        value,
        timestamp: Date.now(),
        alarm: item.alarm || "No",
        supportingTag: item.supportingTag || "No",
      });
    }
  }

  if (!samples.length)
    return { out3: diag({ equipmentId: eq, blockIdx: idx, warnings, state: "empty", ts: Date.now() }) };
  return { out2: samples, out3: diag({ equipmentId: eq, blockIdx: idx, have, need, warnings, ts: Date.now() }) };
}
