import {
  evaluateMiniStandaloneSequencer,
  miniStandaloneCommandsToWriterEnvelopes,
  type MiniStandaloneState,
} from "../coreControl";

const opts = {
  outageDebounceMs: 100,
  gridReturnDebounceMs: 100,
  retryMs: 0,
};

describe("Mini standalone sequencer", () => {
  test("requests off-grid switch after outage debounce", () => {
    let state: MiniStandaloneState = { mode: "grid-tied" };

    let result = evaluateMiniStandaloneSequencer(
      { nowMs: 0, gridAvailable: false, onOffGridSwitch: 0 },
      state,
      opts
    );
    state = result.state;
    expect(state.mode).toBe("outage-wait");

    result = evaluateMiniStandaloneSequencer(
      { nowMs: 100, gridAvailable: false, onOffGridSwitch: 0 },
      state,
      opts
    );
    state = result.state;
    expect(state.mode).toBe("switch-off-grid");
    expect(result.commands).toEqual([{ kind: "suppress-active-setpoint" }]);

    result = evaluateMiniStandaloneSequencer(
      { nowMs: 100, gridAvailable: false, onOffGridSwitch: 0 },
      state,
      opts
    );
    expect(result.commands).toEqual([
      { kind: "suppress-active-setpoint" },
      { kind: "on-off-grid-switch", value: 1 },
    ]);
  });

  test("returns to grid-tied mode after stable grid return", () => {
    let state: MiniStandaloneState = {
      mode: "off-grid-hold",
    };

    let result = evaluateMiniStandaloneSequencer(
      { nowMs: 1_000, gridAvailable: true, onOffGridSwitch: 1 },
      state,
      opts
    );
    state = result.state;
    expect(state.mode).toBe("off-grid-hold");

    result = evaluateMiniStandaloneSequencer(
      { nowMs: 1_100, gridAvailable: true, onOffGridSwitch: 1 },
      state,
      opts
    );
    state = result.state;
    expect(state.mode).toBe("grid-return-wait");

    result = evaluateMiniStandaloneSequencer(
      { nowMs: 1_100, gridAvailable: true, onOffGridSwitch: 1 },
      state,
      opts
    );
    state = result.state;
    expect(state.mode).toBe("switch-grid-tied");

    result = evaluateMiniStandaloneSequencer(
      { nowMs: 1_100, gridAvailable: true, onOffGridSwitch: 1 },
      state,
      opts
    );
    expect(result.commands).toEqual([
      { kind: "suppress-active-setpoint" },
      { kind: "on-off-grid-switch", value: 0 },
    ]);
  });

  test("maps standalone commands to Mini template command IDs", () => {
    const envelopes = miniStandaloneCommandsToWriterEnvelopes([
      { kind: "suppress-active-setpoint" },
      { kind: "on-off-grid-switch", value: 1 },
    ]);

    expect(envelopes).toEqual([
      {
        topic: "PCS",
        payload: [
          { tagID: "ActivePowerSetpoint", value: 0 },
          { tagID: "OnOffGridSwitch", value: 1 },
        ],
      },
    ]);
  });
});
