import type { CompilerEnv, ReadPlan, TagMapItem } from "../types";

type FnKey =
  | "HR"
  | "HRUS"
  | "HRF"
  | "HRI"
  | "HRUI"
  | "HRUI_64"
  | "HRI_64"
  | "HRS"
  | "IR"
  | "IRUS"
  | "IRF"
  | "IRI"
  | "IRUI"
  | "IRUI_64"
  | "IRI_64"
  | "IRS"
  | "C"
  | string;

const FC: Record<string, number> = {
  HR: 3,
  HRUS: 3,
  HRF: 3,
  HRI: 3,
  HRUI: 3,
  HRLL: 3,
  HRUI_64: 3,
  HRS: 3,
  IR: 4,
  IRUS: 4,
  IRF: 4,
  IRI: 4,
  IRUI: 4,
  IRUI_64: 4,
  IRI_64: 4,
  IRS: 4,
  C: 1,
};

const REGISTER_QTY: Record<string, number> = {
  HR: 1,
  HRUS: 1,
  HRF: 2,
  HRI: 2,
  HRUI: 2,
  HRUI_64: 4,
  HRI_64: 4,
  IR: 1,
  IRUS: 1,
  IRF: 2,
  IRI: 2,
  IRUI: 2,
  IRUI_64: 4,
  IRI_64: 4,
  C: 1,
};

interface TagDef {
  name: string;
  function: FnKey;
  address: number; // 1-based register/coil address
  length?: number; // register count; defaults from REGISTER_QTY
  pollMs?: number;
  pollClass?: "fast" | "normal" | "slow";
  endian?: "BE" | "LE";
  wordOrder32?: "ABCD" | "CDAB" | "BADC" | "DCBA";
  parser?: "U16" | "S16" | "U32" | "F32" | "F64" | "C" | string;
  scale?: any;
  alarm?: "Yes" | "No";
  supportingTag?: "Yes" | "No";
  status?: string;
}

/**
 * Groups tags by Modbus function code, merges contiguous or near-contiguous addresses
 * within CompilerMaxSpan/Hole, then splits large ranges by CompilerMaxQty.
 */
export function buildReadPlan(profile: any, instance: any, env: CompilerEnv): ReadPlan {
  if (!profile?.tags?.length) throw new Error("Compiler: profile.tags empty");
  if (!instance?.equipmentId || !instance?.serverKey || typeof instance?.unitId !== "number")
    throw new Error("Compiler: invalid instance");

  // poll period resolution hierarchy
  const pollOf = (t: TagDef) =>
    typeof t.pollMs === "number"
      ? t.pollMs
      : t.pollClass === "fast"
      ? env.PollFastMs
      : t.pollClass === "slow"
      ? env.PollSlowMs
      : env.PollNormalMs;

  // group by function
  const byFn = new Map<FnKey, TagDef[]>();
  for (const raw of profile.tags as TagDef[]) {
    const fn = (raw.function || "IRF") as FnKey;
    const len = Math.max(1, raw.length ?? REGISTER_QTY[fn] ?? 1);
    const tag: TagDef = {
      ...raw,
      function: fn,
      length: len,
      // default parser: coils => "C"; others unchanged
      parser: raw.parser || (fn === "C" ? "C" : raw.parser),
    };

    if (!byFn.has(fn)) byFn.set(fn, []);
    byFn.get(fn)!.push(tag);
  }

  const blocks: any[] = [];

  for (const [fn, list] of byFn) {
    const tags = list.slice().sort((a, b) => a.address - b.address);
    let win: { start: number; end: number; tags: TagDef[] } | null = null;

    for (const t of tags) {
      const start = t.address;
      const len = Math.max(1, t.length ?? REGISTER_QTY[t.function] ?? 1);
      const end = t.address + len - 1;

      if (!win) {
        win = { start, end, tags: [t] };
        continue;
      }

      const newSpan = Math.max(win.end, end) - Math.min(win.start, start) + 1;
      const hole = start - win.end - 1;

      // merge if within limits; otherwise emit current window
      if (newSpan <= env.CompilerMaxSpan && hole <= env.CompilerMaxHole) {
        win.end = Math.max(win.end, end);
        win.tags.push(t);
      } else {
        emitWindow(fn, win, blocks, env);
        win = { start, end, tags: [t] };
      }
    }
    if (win) emitWindow(fn, win, blocks, env);
  }

  // determine each block's polling rate (minimum of member tag polls)
  for (const b of blocks) {
    const mins = b.map.map((m: TagMapItem) => m.pollMs ?? Infinity);
    b.pollMs = Math.min(...mins, env.PollNormalMs);
    if (!isFinite(b.pollMs)) b.pollMs = env.PollNormalMs;
  }

  return {
    equipmentId: instance.equipmentId,
    serverKey: instance.serverKey,
    unitId: instance.unitId,
    blocks,
    pollPlan: {
      fastMs: env.PollFastMs,
      normalMs: env.PollNormalMs,
      slowMs: env.PollSlowMs,
    },
  };
}

function emitWindow(
  fn: FnKey,
  win: { start: number; end: number; tags: TagDef[] },
  out: any[],
  env: CompilerEnv
) {
  const qty = win.end - win.start + 1;

  for (let base = 0; base < qty; base += env.CompilerMaxQty) {
    const chunkStart = win.start + base;
    const chunkQty = Math.min(env.CompilerMaxQty, qty - base);

    const map = win.tags
      .map<TagMapItem>((t) => {
        const effLen = Math.max(1, t.length ?? REGISTER_QTY[t.function] ?? 1);
        return {
          name: t.name,
          tagID: t.name,
          offset: t.address - win.start - base,
          length: effLen,
          parser: t.parser,
          endian: t.endian,
          wordOrder32: t.wordOrder32,
          scale: t.scale,
          alarm: t.alarm,
          supportingTag: t.supportingTag,
          status: t.status,
          pollMs: t.pollMs,
        } as TagMapItem;
      })
      .filter((m) => m.offset >= 0 && m.offset + m.length <= chunkQty);

    out.push({
      function: fn,
      fc: FC[fn] ?? 4,
      start: chunkStart,
      quantity: chunkQty,
      map,
      pollMs: 0,
    });
  }
}
