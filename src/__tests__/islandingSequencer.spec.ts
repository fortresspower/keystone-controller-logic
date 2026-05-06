import {
  evaluateESpire280IslandingSequencer,
  islandingCommandsToWriterEnvelopes,
  type IslandingSequencerState,
} from "../coreControl";

const opts = {
  waitMs: 100,
  retryMs: 200,
  modeDwellMs: 100,
  gridClearHoldMs: 100,
};

describe("eSpire280 islanding sequencer", () => {
  test("transitions outage path with PCS off, island mode confirmation, dwell, and PCS on", () => {
    let state: IslandingSequencerState = { mode: "idle" };

    let result = evaluateESpire280IslandingSequencer(
      { nowMs: 0, outageDetected: true },
      state,
      opts
    );
    state = result.state;
    expect(state.mode).toBe("outage-wait");
    expect(state.waitUntilMs).toBe(100);

    result = evaluateESpire280IslandingSequencer(
      { nowMs: 100, outageDetected: true },
      state,
      opts
    );
    state = result.state;
    expect(state.mode).toBe("pcs-off-to-island");

    result = evaluateESpire280IslandingSequencer(
      {
        nowMs: 300,
        outageDetected: true,
        interlockClosed: true,
        pcsOnOff: 1,
        pcsGlobalState: 3,
      },
      state,
      opts
    );
    state = result.state;
    expect(result.commands).toEqual([{ kind: "pcs-on-off", value: 2 }]);

    result = evaluateESpire280IslandingSequencer(
      {
        nowMs: 500,
        outageDetected: true,
        interlockClosed: true,
        pcsOnOff: 2,
        pcsGlobalState: 1,
      },
      state,
      opts
    );
    state = result.state;
    expect(state.mode).toBe("set-island-mode");

    result = evaluateESpire280IslandingSequencer(
      {
        nowMs: 500,
        outageDetected: true,
        interlockClosed: true,
        pcsOnOff: 2,
        pcsGlobalState: 1,
        pcsRunMode: 0,
        gridWireConnection: 0,
      },
      state,
      opts
    );
    state = result.state;
    expect(result.commands).toEqual([
      { kind: "pcs-run-mode", value: 1 },
      { kind: "grid-wire-connection", value: 1 },
    ]);
    expect(state.mode).toBe("confirm-island-mode");

    result = evaluateESpire280IslandingSequencer(
      {
        nowMs: 700,
        outageDetected: true,
        interlockClosed: true,
        pcsOnOff: 2,
        pcsGlobalState: 1,
        pcsRunMode: 1,
        gridWireConnection: 1,
      },
      state,
      opts
    );
    state = result.state;
    expect(state.mode).toBe("island-mode-dwell");
    expect(state.waitUntilMs).toBe(800);

    result = evaluateESpire280IslandingSequencer(
      {
        nowMs: 800,
        outageDetected: true,
        interlockClosed: true,
        pcsOnOff: 2,
        pcsGlobalState: 1,
        pcsRunMode: 1,
        gridWireConnection: 1,
      },
      state,
      opts
    );
    state = result.state;
    expect(state.mode).toBe("assert-interlock");

    result = evaluateESpire280IslandingSequencer(
      {
        nowMs: 800,
        outageDetected: true,
        interlockClosed: false,
        pcsOnOff: 2,
        pcsGlobalState: 1,
        pcsRunMode: 1,
        gridWireConnection: 1,
      },
      state,
      opts
    );
    state = result.state;
    expect(result.commands).toEqual([{ kind: "interlock", closed: true }]);

    result = evaluateESpire280IslandingSequencer(
      {
        nowMs: 1_000,
        outageDetected: true,
        interlockClosed: true,
        pcsOnOff: 2,
        pcsGlobalState: 1,
        pcsRunMode: 1,
        gridWireConnection: 1,
      },
      state,
      opts
    );
    state = result.state;
    expect(state.mode).toBe("pcs-on-island");

    result = evaluateESpire280IslandingSequencer(
      {
        nowMs: 1_000,
        outageDetected: true,
        interlockClosed: true,
        pcsOnOff: 2,
        pcsGlobalState: 1,
        pcsRunMode: 1,
        gridWireConnection: 1,
      },
      state,
      opts
    );
    state = result.state;
    expect(result.commands).toEqual([{ kind: "pcs-on-off", value: 1 }]);

    result = evaluateESpire280IslandingSequencer(
      {
        nowMs: 1_200,
        outageDetected: true,
        interlockClosed: true,
        pcsOnOff: 1,
        pcsGlobalState: 6,
        pcsRunMode: 1,
        gridWireConnection: 1,
      },
      state,
      opts
    );
    expect(result.state.mode).toBe("island-hold");
  });

  test("restores grid path after stable grid clear and clears interlock", () => {
    let state: IslandingSequencerState = {
      mode: "island-hold",
      phase: "outage",
    };

    let result = evaluateESpire280IslandingSequencer(
      {
        nowMs: 1_000,
        outageDetected: false,
        interlockClosed: true,
        pcsOnOff: 1,
        pcsGlobalState: 6,
        pcsRunMode: 1,
        gridWireConnection: 1,
      },
      state,
      opts
    );
    state = result.state;
    expect(state.mode).toBe("island-hold");

    result = evaluateESpire280IslandingSequencer(
      {
        nowMs: 1_100,
        outageDetected: false,
        interlockClosed: true,
        pcsOnOff: 1,
        pcsGlobalState: 6,
        pcsRunMode: 1,
        gridWireConnection: 1,
      },
      state,
      opts
    );
    state = result.state;
    expect(state.mode).toBe("grid-wait");

    result = evaluateESpire280IslandingSequencer(
      {
        nowMs: 1_200,
        outageDetected: false,
        interlockClosed: true,
        pcsOnOff: 1,
        pcsGlobalState: 6,
        pcsRunMode: 1,
        gridWireConnection: 1,
      },
      state,
      opts
    );
    state = result.state;
    expect(state.mode).toBe("pcs-off-to-grid");

    result = evaluateESpire280IslandingSequencer(
      {
        nowMs: 1_200,
        outageDetected: false,
        interlockClosed: true,
        pcsOnOff: 1,
        pcsGlobalState: 6,
        pcsRunMode: 1,
        gridWireConnection: 1,
      },
      state,
      opts
    );
    state = result.state;
    expect(result.commands).toEqual([{ kind: "pcs-on-off", value: 2 }]);

    result = evaluateESpire280IslandingSequencer(
      {
        nowMs: 1_400,
        outageDetected: false,
        interlockClosed: true,
        pcsOnOff: 2,
        pcsGlobalState: 1,
        pcsRunMode: 1,
        gridWireConnection: 1,
      },
      state,
      opts
    );
    state = result.state;
    expect(state.mode).toBe("set-grid-mode");

    result = evaluateESpire280IslandingSequencer(
      {
        nowMs: 1_400,
        outageDetected: false,
        interlockClosed: true,
        pcsOnOff: 2,
        pcsGlobalState: 1,
        pcsRunMode: 1,
        gridWireConnection: 1,
      },
      state,
      opts
    );
    state = result.state;
    expect(result.commands).toEqual([
      { kind: "pcs-run-mode", value: 0 },
      { kind: "grid-wire-connection", value: 0 },
    ]);

    result = evaluateESpire280IslandingSequencer(
      {
        nowMs: 1_600,
        outageDetected: false,
        interlockClosed: true,
        pcsOnOff: 2,
        pcsGlobalState: 1,
        pcsRunMode: 0,
        gridWireConnection: 0,
      },
      state,
      opts
    );
    state = result.state;
    expect(state.mode).toBe("grid-mode-dwell");

    result = evaluateESpire280IslandingSequencer(
      {
        nowMs: 1_700,
        outageDetected: false,
        interlockClosed: true,
        pcsOnOff: 2,
        pcsGlobalState: 1,
        pcsRunMode: 0,
        gridWireConnection: 0,
      },
      state,
      opts
    );
    state = result.state;
    expect(state.mode).toBe("pcs-on-grid");

    result = evaluateESpire280IslandingSequencer(
      {
        nowMs: 1_700,
        outageDetected: false,
        interlockClosed: true,
        pcsOnOff: 2,
        pcsGlobalState: 1,
        pcsRunMode: 0,
        gridWireConnection: 0,
      },
      state,
      opts
    );
    state = result.state;
    expect(result.commands).toEqual([{ kind: "pcs-on-off", value: 1 }]);

    result = evaluateESpire280IslandingSequencer(
      {
        nowMs: 1_900,
        outageDetected: false,
        interlockClosed: true,
        pcsOnOff: 1,
        pcsGlobalState: 3,
        pcsRunMode: 0,
        gridWireConnection: 0,
      },
      state,
      opts
    );
    state = result.state;
    expect(state.mode).toBe("clear-interlock");

    result = evaluateESpire280IslandingSequencer(
      {
        nowMs: 1_900,
        outageDetected: false,
        interlockClosed: true,
        pcsOnOff: 1,
        pcsGlobalState: 3,
        pcsRunMode: 0,
        gridWireConnection: 0,
      },
      state,
      opts
    );
    state = result.state;
    expect(result.commands).toEqual([{ kind: "interlock", closed: false }]);

    result = evaluateESpire280IslandingSequencer(
      {
        nowMs: 2_100,
        outageDetected: false,
        interlockClosed: false,
        pcsOnOff: 1,
        pcsGlobalState: 3,
        pcsRunMode: 0,
        gridWireConnection: 0,
      },
      state,
      opts
    );
    expect(result.state.mode).toBe("idle");
  });

  test("maps sequencer commands to SEL751 and PCS writer envelopes", () => {
    const envelopes = islandingCommandsToWriterEnvelopes([
      { kind: "interlock", closed: true },
      { kind: "pcs-on-off", value: 2 },
      { kind: "pcs-run-mode", value: 1 },
      { kind: "grid-wire-connection", value: 1 },
    ]);

    expect(envelopes).toEqual([
      {
        topic: "SEL751",
        payload: [{ tagID: "SEL751.RB_1", value: true }],
      },
      {
        topic: "PCS",
        payload: [
          { tagID: "SYSTEM_ON_OFF", value: 2 },
          { tagID: "SYSTEM_RUN_MODE", value: 1 },
          { tagID: "GRID_WIRE_CONNECTION", value: 1 },
        ],
      },
    ]);
  });

  test("can map interlock output to SEL851 RB_1", () => {
    const envelopes = islandingCommandsToWriterEnvelopes(
      [{ kind: "interlock", closed: false }],
      { selTopic: "SEL851", interlockTagID: "SEL851.RB_1" }
    );

    expect(envelopes).toEqual([
      {
        topic: "SEL851",
        payload: [{ tagID: "SEL851.RB_1", value: false }],
      },
    ]);
  });
});
