import { buildReadPlan } from "../compiler/compiler";
import * as reader from "../reader/reader";
import type { CompilerEnv, ReaderEnv } from "../types";

const compilerEnv: CompilerEnv = {
  maxQty: 120,
  maxSpan: 80,
  maxHole: 4,
  pollFast: 250,
  pollNormal: 1000,
  pollSlow: 5000,
} as any;

const readerEnv: ReaderEnv = {
  MODBUS_ZERO_BASED: false,
  MAX_IN_FLIGHT: 4,
  REQUEST_TIMEOUT_MS: 1500,
  JITTER_MS: 0,
  RESPECT_TAG_CLAMP: false,
  SCALE_CLAMP_DEFAULT: false,
  SKIP_EMPTY_SAMPLES: false,
} as any;

const instance = {
  equipmentId: "Test.Dev",
  serverKey: "TEST",
  unitId: 1,
};

function makePlanForTag(tag: any) {
  const profile = {
    profileId: "test_profile",
    defaults: {
      byteOrder: "BE",
      wordOrder32: "ABCD",
    },
    tags: [tag],
  };
  return buildReadPlan(profile, instance, compilerEnv);
}

function simulateReply(
  plan: any,
  blockIdx: number,
  regs: number[]
) {
  const msg = {
    _reader: { equipmentId: plan.equipmentId, blockIdx },
    payload: regs,
  };
  return reader.onReply(msg, plan, readerEnv);
}

describe("Modbus function semantics", () => {
  test("HR (S16)", () => {
    const plan = makePlanForTag({
      name: "hr_s16",
      function: "HR",
      address: 100,
    });

    const blk = plan.blocks[0];
    expect(blk.fc).toBe(3);
    expect(blk.quantity).toBe(1);

    const res = simulateReply(plan, 0, [0xfffe]); // -2
    const sample = res.out2[0];
    expect(sample.tagID).toBe("hr_s16");
    expect(sample.value).toBe(-2);
  });

  test("HRUS (U16)", () => {
    const plan = makePlanForTag({
      name: "hr_us",
      function: "HRUS",
      address: 101,
    });

    const blk = plan.blocks[0];
    expect(blk.fc).toBe(3);
    expect(blk.quantity).toBe(1);

    const res = simulateReply(plan, 0, [65535]);
    const sample = res.out2[0];
    expect(sample.value).toBe(65535);
  });

  test("HRI (S32)", () => {
    const plan = makePlanForTag({
      name: "hri_s32",
      function: "HRI",
      address: 200,
    });

    const blk = plan.blocks[0];
    expect(blk.fc).toBe(3);
    expect(blk.quantity).toBe(2);

    // value just over 2^31 to force negative sign
    const hi = 0x8000;
    const lo = 0x0001;
    const res = simulateReply(plan, 0, [hi, lo]);
    const sample = res.out2[0];
    expect(sample.value).toBeLessThan(0); // signed
  });

  test("HRUI (U32)", () => {
    const plan = makePlanForTag({
      name: "hrui_u32",
      function: "HRUI",
      address: 210,
    });

    const blk = plan.blocks[0];
    expect(blk.fc).toBe(3);
    expect(blk.quantity).toBe(2);

    const hi = 0x0001;
    const lo = 0x0002;
    const res = simulateReply(plan, 0, [hi, lo]);
    const sample = res.out2[0];
    expect(sample.value).toBe(((hi << 16) | lo) >>> 0);
  });

  test("HRF (F32)", () => {
    const plan = makePlanForTag({
      name: "hrf_f32",
      function: "HRF",
      address: 220,
    });
    const blk = plan.blocks[0];
    expect(blk.fc).toBe(3);
    expect(blk.quantity).toBe(2);

    // encode 1.5 as F32 big-endian
    const buf = new ArrayBuffer(4);
    const dv = new DataView(buf);
    dv.setFloat32(0, 1.5, false);
    const hi = dv.getUint16(0, false);
    const lo = dv.getUint16(2, false);

    const res = simulateReply(plan, 0, [hi, lo]);
    const sample = res.out2[0];
    expect(Math.abs(sample.value - 1.5)).toBeLessThan(1e-6);
  });

  test("HRI_64 / HRUI_64 decode via F64", () => {
    const plan = makePlanForTag({
      name: "hrui_64",
      function: "HRUI_64",
      address: 300,
    });

    const blk = plan.blocks[0];
    expect(blk.fc).toBe(3);
    expect(blk.quantity).toBe(4);

    const buf = new ArrayBuffer(8);
    const dv = new DataView(buf);
    dv.setFloat64(0, 123456.75, false);
    const w0 = dv.getUint16(0, false);
    const w1 = dv.getUint16(2, false);
    const w2 = dv.getUint16(4, false);
    const w3 = dv.getUint16(6, false);

    const res = simulateReply(plan, 0, [w0, w1, w2, w3]);
    const sample = res.out2[0];
    expect(Math.abs(sample.value - 123456.75)).toBeLessThan(1e-6);
  });

  test("C (coil)", () => {
    const plan = makePlanForTag({
      name: "coil_flag",
      function: "C",
      address: 10,
    });

    const blk = plan.blocks[0];
    expect(blk.fc).toBe(1);
    expect(blk.quantity).toBe(1);

    const res0 = simulateReply(plan, 0, [0]);
    const res1 = simulateReply(plan, 0, [1]);

    expect(res0.out2[0].value).toBe(0);
    expect(res1.out2[0].value).toBe(1);
  });

  test("IRS10 (string)", () => {
    const plan = makePlanForTag({
      name: "device_name",
      function: "IRS10",
      address: 400,
    });

    const blk = plan.blocks[0];
    expect(blk.fc).toBe(4);
    expect(blk.quantity).toBe(10);

    // 10 registers, 10 chars, 1 char per word: "HELLOWORLD"
    const text = "HELLOWORLD";
    const regs = [];
    for (let i = 0; i < text.length; i++) {
      regs.push(text.charCodeAt(i));
    }

    const res = simulateReply(plan, 0, regs);
    const sample = res.out2[0];
    expect(sample.value).toBe("HELLOWORLD");
  });
  test("HRUS with linear scaling (no clamp)", () => {
    const plan = makePlanForTag({
      name: "scaled_hrus",
      function: "HRUS",      // 16-bit unsigned
      address: 500,
      // scale config: 0–1000 raw -> 0–100 eng
      scale: {
        mode: "Linear",
        rawLow: 0,
        rawHigh: 1000,
        engLow: 0,
        engHigh: 100,
        clamp: false,        // explicit: do not clamp
      },
    });

    const blk = plan.blocks[0];
    expect(blk.fc).toBe(3);
    expect(blk.quantity).toBe(1);

    // raw = 500 -> mid-point -> ~50 eng units
    const res = simulateReply(plan, 0, [500]);
    const sample = res.out2[0];

    expect(sample.tagID).toBe("scaled_hrus");
    expect(sample.value).toBeCloseTo(50, 6);
  });
  test("HRUS with scaling and clamp enabled", () => {
    const plan = makePlanForTag({
      name: "scaled_hrus_clamped",
      function: "HRUS",
      address: 510,
      scale: {
        mode: "Linear",
        rawLow: 0,
        rawHigh: 1000,
        engLow: 0,
        engHigh: 100,
        clamp: true,          // enable clamp
      },
    });

    const blk = plan.blocks[0];
    expect(blk.fc).toBe(3);
    expect(blk.quantity).toBe(1);

    // Use readerEnv with SCALE_CLAMP_DEFAULT false so "clamp" flag is respected
    const localReaderEnv: ReaderEnv = {
      ...readerEnv,
      SCALE_CLAMP_DEFAULT: false,
      RESPECT_TAG_CLAMP: true,
    } as any;

    // Bypass simulateReply just to inject custom env:
    const msg = {
      _reader: { equipmentId: plan.equipmentId, blockIdx: 0 },
      payload: [1500], // raw above rawHigh
    };

    const res = reader.onReply(msg, plan, localReaderEnv);
    const sample = res.out2[0];

    // value should be clamped to engHigh (100)
    expect(sample.value).toBeCloseTo(100, 6);
  });
});
