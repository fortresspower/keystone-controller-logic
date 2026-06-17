import type { GeneratorConfig } from "../config";
import {
  evaluateGeneratorSequencer,
  generatorCommandsToWriterEnvelopes,
  type GeneratorSequencerState,
} from "../coreControl";

function makeGenerator(controlType: GeneratorConfig["controlType"] = "SEL"): GeneratorConfig {
  return {
    maxKw: 50,
    chargeFromGenerator: true,
    chargeKwLimit: 30,
    startSoc: 0.2,
    stopSoc: 0.9,
    controlType,
  };
}

describe("generator sequencer", () => {
  test("starts generator from configured SOC threshold", () => {
    const result = evaluateGeneratorSequencer(makeGenerator(), {
      batterySoc: 0.19,
      generatorRunning: false,
    });

    expect(result.state.mode).toBe("start-requested");
    expect(result.commands).toEqual([{ kind: "generator-start" }]);
    expect(result.reasons).toEqual(["generator-start-soc"]);
  });

  test("does not auto-start generator when start is not allowed", () => {
    const result = evaluateGeneratorSequencer(makeGenerator(), {
      batterySoc: 0.19,
      generatorRunning: false,
      allowGeneratorStart: false,
    });

    expect(result.state.mode).toBe("idle");
    expect(result.commands).toEqual([]);
    expect(result.reasons).toEqual(["generator-start-not-allowed"]);
  });

  test("keeps generator in grid-tie battery-charge mode while running", () => {
    const result = evaluateGeneratorSequencer(
      makeGenerator(),
      {
        nowMs: 1_000,
        batterySoc: 0.5,
        generatorRunning: true,
      },
      { mode: "start-requested" }
    );

    expect(result.state).toEqual({ mode: "charging", startedAtMs: 1_000 });
    expect(result.commands).toEqual([
      { kind: "pcs-grid-tie-mode" },
      { kind: "pcs-charge-from-generator", kw: 30 },
    ]);
    expect(result.reasons).toEqual([
      "generator-grid-tie-charge-mode",
      "generator-charge-request",
    ]);
  });

  test("allows users to disable generator charging by setting charge kW to zero", () => {
    const generator = makeGenerator();
    generator.chargeKwLimit = 0;

    const result = evaluateGeneratorSequencer(generator, {
      batterySoc: 0.5,
      generatorRunning: true,
    });

    expect(result.commands).toEqual([{ kind: "pcs-grid-tie-mode" }]);
    expect(result.reasons).toEqual([
      "generator-grid-tie-charge-mode",
      "generator-charge-kw-zero",
    ]);
  });

  test("stops generator from configured stop SOC without controller cooldown", () => {
    const previousState: GeneratorSequencerState = {
      mode: "charging",
      startedAtMs: 1_000,
    };
    const result = evaluateGeneratorSequencer(
      makeGenerator(),
      {
        nowMs: 2_000,
        batterySoc: 0.91,
        generatorRunning: true,
      },
      previousState
    );

    expect(result.state.mode).toBe("stop-requested");
    expect(result.commands).toEqual([{ kind: "generator-stop" }]);
    expect(result.reasons).toEqual(["generator-stop-soc"]);
  });

  test("can optionally hold minimum runtime without making cooldown mandatory", () => {
    const result = evaluateGeneratorSequencer(
      makeGenerator(),
      {
        nowMs: 2_000,
        batterySoc: 0.91,
        generatorRunning: true,
      },
      { mode: "charging", startedAtMs: 1_000 },
      { minRunMs: 5_000 }
    );

    expect(result.state.mode).toBe("charging");
    expect(result.commands).toEqual([
      { kind: "pcs-grid-tie-mode" },
      { kind: "pcs-charge-from-generator", kw: 30 },
    ]);
    expect(result.reasons).toEqual(
      expect.arrayContaining(["generator-min-runtime-hold"])
    );
  });

  test("maps SEL control to RB_2 and PCS charge envelopes", () => {
    const envelopes = generatorCommandsToWriterEnvelopes(makeGenerator("SEL"), [
      { kind: "generator-start" },
      { kind: "pcs-grid-tie-mode" },
      { kind: "pcs-charge-from-generator", kw: 30 },
    ]);

    expect(envelopes).toEqual([
      {
        topic: "SEL851",
        payload: [{ tagID: "SEL851.RB_2", value: true }],
      },
      {
        topic: "PCS",
        payload: [
          { tagID: "SYSTEM_RUN_MODE", value: 0 },
          { tagID: "GRID_WIRE_CONNECTION", value: 0 },
          { tagID: "SYSTEM_ACTIVE_POWER_DEMAND", value: -30 },
        ],
      },
    ]);
  });

  test("maps RemoteIO control through configurable remote IO tag", () => {
    const envelopes = generatorCommandsToWriterEnvelopes(
      makeGenerator("RemoteIO"),
      [{ kind: "generator-start" }],
      {
        remoteIoTopic: "RemoteIO",
        remoteIoGeneratorTagID: "RemoteIO.Generator_Start",
      }
    );

    expect(envelopes).toEqual([
      {
        topic: "RemoteIO",
        payload: [{ tagID: "RemoteIO.Generator_Start", value: true }],
      },
    ]);
  });
});
