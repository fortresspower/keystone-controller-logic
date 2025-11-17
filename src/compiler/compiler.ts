import type { CompilerEnv, ReadPlan, TagMapItem } from "../types";

/**
 * Tag definition as it comes from profile/Node-RED.
 * NOTE: profile does NOT need to set parser; it is derived from `function`.
 */
interface TagDef {
  name: string;
  function: string;             // HR, HRUS, HRI, HRUI_64, IRF, IRUI, HRS10, C, etc.
  address: number;              // 1-based register/coil address
  length?: number;              // optional override; usually omitted
  pollMs?: number;
  pollClass?: "fast" | "normal" | "slow";
  endian?: "BE" | "LE";
  wordOrder32?: "ABCD" | "CDAB" | "BADC" | "DCBA";
  scale?: any;
  alarm?: "Yes" | "No";
  supportingTag?: "Yes" | "No";
  status?: string;
}

type FnKey = string;

type ParserKind =
  | "S16" | "U16"
  | "S32" | "U32"
  | "F32" | "F64"
  | "U64" | "S64"
  | "C"
  | "STR";

/**
 * Function metadata derived from the function string.
 */
interface FnMeta {
  fc: number;
  words: number;        // default register/coil count
  parser: ParserKind;
}

/**
 * Derive Modbus semantics from function name.
 *
 * Rules (based on your original Node-RED conventions):
 * - HR / IR      -> S16
 * - HRUS / IRUS  -> U16
 * - HRI / IRI    -> S32 (2 regs)
 * - HRUI / IRUI  -> U32 (2 regs)
 * - HRF / IRF    -> F32 (2 regs)
 * - HRI_64 / HRUI_64 / IRI_64 / IRUI_64 -> 64-bit numeric (4 regs, decoded as F64 for now)
 * - C           -> coil, first bit
 * - HRSnn / IRSnn -> string, nn chars, 1 char per 16-bit register
 */
function deriveFnMeta(fnRaw: string): FnMeta {
  const fn = fnRaw.toUpperCase().trim();

  // Coils
  if (fn === "C") {
    return { fc: 1, words: 1, parser: "C" };
  }

  // Strings: HRSnn / IRSnn
  if (fn.startsWith("HRS") || fn.startsWith("IRS")) {
    const isInput = fn.startsWith("IRS");
    const nStr = fn.slice(3); // after HRS / IRS
    const n = parseInt(nStr, 10);
    const chars = Number.isFinite(n) && n > 0 ? n : 1;
    return {
      fc: isInput ? 4 : 3,
      words: chars,      // 1 register per character
      parser: "STR",
    };
  }

  const isInput = fn.startsWith("IR");
  const fc = isInput ? 4 : 3;

  // 64-bit variants: HRI_64, HRUI_64, IRI_64, IRUI_64
  if (fn.endsWith("_64")) {
    const base = fn.replace("_64", "");
    const unsigned = base.includes("UI"); // HRUI_64, IRUI_64
    // Internally decode via F64; we still keep S64/U64 to distinguish if needed later
    return {
      fc,
      words: 4,
      parser: unsigned ? "U64" : "S64",
    };
  }

  // 16/32-bit family
  switch (fn) {
    case "HR":
    case "IR":
      return { fc, words: 1, parser: "S16" };

    case "HRUS":
    case "IRUS":
      return { fc, words: 1, parser: "U16" };

    case "HRI":
    case "IRI":
      return { fc, words: 2, parser: "S32" };

    case "HRUI":
    case "IRUI":
      return { fc, words: 2, parser: "U32" };

    case "HRF":
    case "IRF":
      return { fc, words: 2, parser: "F32" };

    default:
      // Fallback: treat as 16-bit unsigned input/holding
      return { fc, words: 1, parser: "U16" };
  }
}

/**
 * Groups tags by Modbus function name, merges contiguous or near-contiguous addresses
 * within CompilerMaxSpan/Hole, then splits large ranges by CompilerMaxQty.
 *
 * Function name drives:
 *  - Modbus FC
 *  - default register count
 *  - default parser kind
 *
 * Profile does NOT need to specify parser.
 */
export function buildReadPlan(profile: any, instance: any, env: CompilerEnv): ReadPlan {
  if (!profile?.tags?.length) throw new Error("Compiler: profile.tags empty");
  if (!instance?.equipmentId || !instance?.serverKey || typeof instance?.unitId !== "number")
    throw new Error("Compiler: invalid instance");

  const maxQty = Number((env as any).CompilerMaxQty ?? (env as any).maxQty ?? 120);
  const maxSpan = Number((env as any).CompilerMaxSpan ?? (env as any).maxSpan ?? 80);
  const maxHole = Number((env as any).CompilerMaxHole ?? (env as any).maxHole ?? 4);

  const pollFast = Number((env as any).PollFastMs ?? (env as any).pollFast ?? 250);
  const pollNormal = Number((env as any).PollNormalMs ?? (env as any).pollNormal ?? 1000);
  const pollSlow = Number((env as any).PollSlowMs ?? (env as any).pollSlow ?? 5000);

  const defaultEndian =
    typeof profile?.defaults?.byteOrder === "string"
      ? (profile.defaults.byteOrder.toUpperCase() === "LE" ? "LE" : "BE")
      : "BE";

  const defaultWordOrder32: "ABCD" | "CDAB" | "BADC" | "DCBA" =
    profile?.defaults?.wordOrder32 && typeof profile.defaults.wordOrder32 === "string"
      ? (profile.defaults.wordOrder32.toUpperCase() as any)
      : "ABCD";

  // Normalize tags: derive length/parser/fc from function, unless explicitly overridden
  const rawTags = profile.tags as TagDef[];

  const tags: (TagDef & {
    function: FnKey;
    length: number;
    parser: ParserKind;
    fc: number;
  })[] = rawTags.map((t) => {
    const fn = (t.function || "IR").toUpperCase();
    const meta = deriveFnMeta(fn);

    const length =
      typeof t.length === "number" && t.length > 0
        ? t.length
        : meta.words;

    // Allow explicit parser override only if present; otherwise derive from function
    const parser: ParserKind =
      ((t as any).parser as ParserKind | undefined) || meta.parser;

    const endian = t.endian || (defaultEndian as any);
    const wordOrder32 = t.wordOrder32 || defaultWordOrder32;

    return {
      ...t,
      function: fn,
      length,
      parser,
      fc: meta.fc,
      endian,
      wordOrder32,
    };
  });

  // poll period resolution hierarchy
  const pollOf = (t: TagDef & { parser: ParserKind }) =>
    typeof t.pollMs === "number"
      ? t.pollMs
      : t.pollClass === "fast"
      ? pollFast
      : t.pollClass === "slow"
      ? pollSlow
      : pollNormal;

  // group by function (FnKey)
  const byFn = new Map<FnKey, typeof tags>();
  for (const t of tags) {
    const fn = t.function;
    if (!byFn.has(fn)) byFn.set(fn, [] as any);
    byFn.get(fn)!.push(t);
  }

  const blocks: any[] = [];

  for (const [fn, list] of byFn) {
    const fnTags = list.slice().sort((a, b) => a.address - b.address);
    let win: { start: number; end: number; tags: typeof fnTags } | null = null;

    for (const t of fnTags) {
      const start = t.address;
      const end = t.address + Math.max(1, t.length) - 1;

      if (!win) {
        win = { start, end, tags: [t] as any };
        continue;
      }

      const newSpan = Math.max(win.end, end) - Math.min(win.start, start) + 1;
      const hole = start - win.end - 1;

      // merge if within limits; otherwise emit current window
      if (newSpan <= maxSpan && hole <= maxHole) {
        win.end = Math.max(win.end, end);
        win.tags.push(t);
      } else {
        emitWindow(fn, win, blocks, { maxQty });
        win = { start, end, tags: [t] as any };
      }
    }
    if (win) emitWindow(fn, win, blocks, { maxQty });
  }

  // determine each block's polling rate (minimum of member tag polls)
  for (const b of blocks) {
    const mins = b.map.map((m: TagMapItem & { pollMs?: number }) =>
      typeof m.pollMs === "number" ? m.pollMs : Infinity
    );
    b.pollMs = Math.min(...mins, pollNormal);
    if (!isFinite(b.pollMs)) b.pollMs = pollNormal;
  }

  return {
    equipmentId: instance.equipmentId,
    serverKey: instance.serverKey,
    unitId: instance.unitId,
    blocks,
    pollPlan: {
      fastMs: pollFast,
      normalMs: pollNormal,
      slowMs: pollSlow,
    },
  };
}

function emitWindow(
  fn: FnKey,
  win: { start: number; end: number; tags: any[] },
  out: any[],
  env: { maxQty: number }
) {
  const qty = win.end - win.start + 1;

  for (let base = 0; base < qty; base += env.maxQty) {
    const chunkStart = win.start + base;
    const chunkQty = Math.min(env.maxQty, qty - base);

    const map = win.tags
      .map<TagMapItem & { pollMs?: number }>((t) => ({
        name: t.name,
        tagID: t.name,
        offset: (t.address - win.start) - base,
        length: Math.max(1, t.length),
        parser: t.parser,              // INTERNAL: derived from function
        endian: t.endian,
        wordOrder32: t.wordOrder32,
        scale: t.scale,
        alarm: t.alarm,
        supportingTag: t.supportingTag,
        status: t.status,
        pollMs: t.pollMs,
      }))
      .filter((m) => m.offset >= 0 && m.offset + m.length <= chunkQty);

    const meta = deriveFnMeta(fn); // for fc

    out.push({
      function: fn,
      fc: meta.fc,
      start: chunkStart,
      quantity: chunkQty,
      map,
      pollMs: 0,
    });
  }
}
