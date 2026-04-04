import { buildReadPlan } from "../compiler/compiler";
import * as reader from "../reader/reader";
import type { CompilerEnv, ReaderEnv } from "../types";
import {
  adaptTelemetryTemplateToReadProfile,
  resolveTelemetryTemplate,
} from "../telemetry/templateAdapter";

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
  test("pollClass fast drives block pollMs", () => {
    const plan = makePlanForTag({
      name: "fast_tag",
      function: "HRUS",
      address: 50,
      pollClass: "fast",
    });

    expect(plan.blocks[0].pollMs).toBe(250);
  });

  test("pollClass slow drives block pollMs", () => {
    const plan = makePlanForTag({
      name: "slow_tag",
      function: "HRUS",
      address: 51,
      pollClass: "slow",
    });

    expect(plan.blocks[0].pollMs).toBe(5000);
  });

  test("explicit pollMs overrides pollClass", () => {
    const plan = makePlanForTag({
      name: "override_tag",
      function: "HRUS",
      address: 52,
      pollClass: "slow",
      pollMs: 750,
    });

    expect(plan.blocks[0].pollMs).toBe(750);
  });

  test("mixed block uses fastest member poll interval", () => {
    const profile = {
      profileId: "mixed_poll_profile",
      defaults: {
        byteOrder: "BE",
        wordOrder32: "ABCD",
      },
      tags: [
        {
          name: "normal_tag",
          function: "HRUS",
          address: 100,
          pollClass: "normal",
        },
        {
          name: "fast_tag",
          function: "HRUS",
          address: 101,
          pollClass: "fast",
        },
      ],
    };

    const plan = buildReadPlan(profile, instance, compilerEnv);
    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0].pollMs).toBe(250);
  });

  test("startup tags compile into startup-only blocks", () => {
    const plan = makePlanForTag({
      name: "startup_tag",
      function: "HRUS",
      address: 60,
      pollClass: "startup",
    });

    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0].startupOnly).toBe(true);
    expect(plan.blocks[0].pollMs).toBe(0);
  });

  test("startup tags do not merge with recurring blocks", () => {
    const profile = {
      profileId: "startup_split_profile",
      defaults: {
        byteOrder: "BE",
        wordOrder32: "ABCD",
      },
      tags: [
        {
          name: "startup_tag",
          function: "HRUS",
          address: 100,
          pollClass: "startup",
        },
        {
          name: "normal_tag",
          function: "HRUS",
          address: 101,
          pollClass: "normal",
        },
      ],
    };

    const plan = buildReadPlan(profile, instance, compilerEnv);
    expect(plan.blocks).toHaveLength(2);

    const startupBlock = plan.blocks.find((b: any) => b.startupOnly);
    const recurringBlock = plan.blocks.find((b: any) => !b.startupOnly);

    expect(startupBlock).toBeDefined();
    expect(startupBlock.pollMs).toBe(0);
    expect(recurringBlock).toBeDefined();
    expect(recurringBlock.pollMs).toBe(1000);
  });

  test("reader polls startup blocks once only", () => {
    jest.useFakeTimers();

    const plan = makePlanForTag({
      name: "startup_tag",
      function: "HRUS",
      address: 70,
      pollClass: "startup",
    });
    const send = jest.fn();

    reader.start(plan, readerEnv, send);
    jest.runOnlyPendingTimers();
    jest.advanceTimersByTime(5000);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]._reader.blockIdx).toBe(0);
    expect(plan.blocks[0].startupOnly).toBe(true);

    reader.stop(plan.equipmentId);
    jest.useRealTimers();
  });

  test("constant tags compile outside Modbus blocks", () => {
    const plan = makePlanForTag({
      name: "const_tag",
      pollClass: "startup",
      constant: 280,
    });

    expect(plan.blocks).toHaveLength(0);
    expect(plan.constants).toEqual([
      {
        tagID: "const_tag",
        value: 280,
        alarm: "No",
        supportingTag: "No",
      },
    ]);
  });

  test("reader emits constant tags once on start", () => {
    const plan = makePlanForTag({
      name: "const_tag",
      pollClass: "startup",
      constant: 280,
    });
    const send = jest.fn();

    reader.start(plan, readerEnv, send);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBeNull();
    expect(send.mock.calls[0][1]).toEqual([
      expect.objectContaining({
        tagID: "const_tag",
        value: 280,
        alarm: "No",
        supportingTag: "No",
      }),
    ]);
    expect(send.mock.calls[0][2]).toEqual({
      payload: expect.objectContaining({
        equipmentId: plan.equipmentId,
        state: "constants",
        count: 1,
      }),
    });

    reader.stop(plan.equipmentId);
  });

  test("legacy calc.from normalizes to inputs.x", () => {
    const profile = adaptTelemetryTemplateToReadProfile("mbmu_test", {
      version: "2",
      device: {
        vendor: "EnerOne",
        model: "BMS",
        protocol: "modbus-tcp",
      },
      telemetry: [
        {
          id: "BMS_P_BAT_CHG",
          pollClass: "fast",
          calc: {
            from: "BMS_P_SYS",
            expr: "max(0, -x)",
          },
        },
      ],
    } as any);

    expect(profile.tags[0].calc).toEqual({
      inputs: { x: "BMS_P_SYS" },
      expr: "max(0, -x)",
    });
  });

  test("reader evaluates multi-input calc from cached values", () => {
    const profile = {
      profileId: "calc_profile",
      defaults: {
        byteOrder: "BE",
        wordOrder32: "ABCD",
      },
      tags: [
        {
          name: "SE_POWER_RAW",
          function: "HRUS",
          address: 100,
          pollClass: "fast",
        },
        {
          name: "SE_POWER_SF",
          function: "HR",
          address: 220,
          pollClass: "fast",
        },
        {
          name: "SE_POWER",
          pollClass: "fast",
          calc: {
            inputs: {
              raw: "SE_POWER_RAW",
              sf: "SE_POWER_SF",
            },
            expr: "raw * pow(10, sf)",
          },
        },
      ],
    };

    const plan = buildReadPlan(profile, instance, compilerEnv);
    const send = jest.fn();
    reader.start(plan, readerEnv, send);

    const rawBlockIdx = plan.blocks.findIndex((b: any) =>
      b.map.some((m: any) => m.tagID === "SE_POWER_RAW")
    );
    const sfBlockIdx = plan.blocks.findIndex((b: any) =>
      b.map.some((m: any) => m.tagID === "SE_POWER_SF")
    );

    const rawRes = reader.onReply(
      {
        _reader: { equipmentId: plan.equipmentId, blockIdx: rawBlockIdx },
        payload: [1234],
      },
      plan,
      readerEnv
    );
    expect(rawRes.out2).toEqual([
      expect.objectContaining({
        tagID: "SE_POWER_RAW",
        value: 1234,
      }),
    ]);

    const sfRes = reader.onReply(
      {
        _reader: { equipmentId: plan.equipmentId, blockIdx: sfBlockIdx },
        payload: [0xffff],
      },
      plan,
      readerEnv
    );
    expect(sfRes.out2).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tagID: "SE_POWER_SF",
          value: -1,
        }),
        expect.objectContaining({
          tagID: "SE_POWER",
          value: 123.4,
        }),
      ])
    );

    reader.stop(plan.equipmentId);
  });

  test("virtual placeholder tags compile outside Modbus blocks", () => {
    const profile = adaptTelemetryTemplateToReadProfile("mbmu_virtual_test", {
      version: "2",
      device: {
        vendor: "EnerOne",
        model: "BMS",
        protocol: "modbus-tcp",
      },
      telemetry: [
        {
          id: "BMS_TEMP_CELL_AVG",
          function: null,
          address: null,
          pollClass: "normal",
        },
      ],
    } as any);

    expect(profile.tags[0].virtual).toBe(true);
    expect(profile.tags[0].function).toBeUndefined();
    expect(profile.tags[0].address).toBeUndefined();

    const plan = buildReadPlan(profile, instance, compilerEnv);
    expect(plan.blocks).toHaveLength(0);
    expect(plan.virtuals).toEqual([
      {
        tagID: "BMS_TEMP_CELL_AVG",
        pollClass: "normal",
        alarm: "No",
        supportingTag: "No",
      },
    ]);
  });

  test("reader emits diagnostic for skipped virtual tags on start", () => {
    const profile = adaptTelemetryTemplateToReadProfile("mbmu_virtual_test", {
      version: "2",
      device: {
        vendor: "EnerOne",
        model: "BMS",
        protocol: "modbus-tcp",
      },
      telemetry: [
        {
          id: "BMS_TEMP_CELL_AVG",
          function: null,
          address: null,
          pollClass: "normal",
        },
      ],
    } as any);

    const plan = buildReadPlan(profile, instance, compilerEnv);
    const send = jest.fn();

    reader.start(plan, readerEnv, send);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBeNull();
    expect(send.mock.calls[0][1]).toBeNull();
    expect(send.mock.calls[0][2]).toEqual({
      payload: expect.objectContaining({
        equipmentId: plan.equipmentId,
        state: "virtual-tags-skipped",
        count: 1,
        tagIDs: ["BMS_TEMP_CELL_AVG"],
      }),
    });

    reader.stop(plan.equipmentId);
  });

  test("flat enumStatus is normalized and surfaced in reader output", () => {
    const profile = adaptTelemetryTemplateToReadProfile("enum_status_test", {
      version: "2",
      device: {
        vendor: "EnerOne",
        model: "BMS",
        protocol: "modbus-tcp",
      },
      telemetry: [
        {
          id: "BMS_AUX_POWER_STATE",
          function: "HRUS",
          address: 898,
          pollClass: "fast",
          enumStatus: {
            "0": "Normal",
            "1": "AuxPowerLose",
          },
        },
      ],
    } as any);

    expect(profile.tags[0].enumStatus).toEqual({
      "0": "Normal",
      "1": "AuxPowerLose",
    });

    const plan = buildReadPlan(profile, instance, compilerEnv);
    const res = reader.onReply(
      {
        _reader: { equipmentId: plan.equipmentId, blockIdx: 0 },
        payload: [1],
      },
      plan,
      readerEnv
    );

    expect(res.out2[0]).toEqual(
      expect.objectContaining({
        tagID: "BMS_AUX_POWER_STATE",
        value: 1,
        enumLabel: "AuxPowerLose",
      })
    );
  });

  test("bitfieldStatus mapping decodes active bits and labels", () => {
    const profile = adaptTelemetryTemplateToReadProfile("bitfield_status_test", {
      version: "2",
      device: {
        vendor: "EnerOne",
        model: "BMS",
        protocol: "modbus-tcp",
      },
      telemetry: [
        {
          id: "BMS_ALARM_WORD_0",
          function: "HRUS",
          address: 500,
          pollClass: "fast",
          bitfieldStatus: {
            "0": "OverVoltage",
            "2": "OverTemp",
            "3": "CommFault",
          },
        },
      ],
    } as any);

    const plan = buildReadPlan(profile, instance, compilerEnv);
    const res = reader.onReply(
      {
        _reader: { equipmentId: plan.equipmentId, blockIdx: 0 },
        payload: [5],
      },
      plan,
      readerEnv
    );

    expect(res.out2[0]).toEqual(
      expect.objectContaining({
        tagID: "BMS_ALARM_WORD_0",
        value: 5,
        activeBits: [0, 2],
        activeLabels: ["OverVoltage", "OverTemp"],
      })
    );
  });

  test("bitfieldStatus true decodes active bits without labels", () => {
    const profile = adaptTelemetryTemplateToReadProfile("bitfield_status_bool_test", {
      version: "2",
      device: {
        vendor: "EnerOne",
        model: "BMS",
        protocol: "modbus-tcp",
      },
      telemetry: [
        {
          id: "BMS_ALARM_WORD_0",
          function: "HRUS",
          address: 500,
          pollClass: "fast",
          bitfieldStatus: true,
        },
      ],
    } as any);

    const plan = buildReadPlan(profile, instance, compilerEnv);
    const res = reader.onReply(
      {
        _reader: { equipmentId: plan.equipmentId, blockIdx: 0 },
        payload: [5],
      },
      plan,
      readerEnv
    );

    expect(res.out2[0]).toEqual(
      expect.objectContaining({
        tagID: "BMS_ALARM_WORD_0",
        value: 5,
        activeBits: [0, 2],
      })
    );
    expect(res.out2[0].activeLabels).toBeUndefined();
  });

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

describe("Telemetry baseline lock", () => {
  test("MBMU template keeps calc/status normalization contracts", () => {
    const template = resolveTelemetryTemplate("MBMU_280_ss40k");
    const profile = adaptTelemetryTemplateToReadProfile(
      "MBMU_280_ss40k",
      template
    );

    const chargeCalc = profile.tags.find((tag) => tag.name === "BMS_P_BAT_CHG");
    expect(chargeCalc?.calc).toEqual({
      inputs: { x: "BMS_P_SYS" },
      expr: "max(0, -x)",
    });

    const auxState = profile.tags.find(
      (tag) => tag.name === "BMS_AUX_POWER_STATE"
    );
    expect(auxState?.enumStatus).toEqual({
      "0": "Normal",
      "1": "AuxPowerLose",
    });

    const alarmWord = profile.tags.find((tag) => tag.name === "BMS_ALARM_WORD_0");
    expect(alarmWord?.bitfieldStatus).toBe(true);
  });
});
