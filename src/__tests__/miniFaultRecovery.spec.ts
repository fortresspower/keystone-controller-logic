import {
  classifyMiniFaults,
  evaluateMiniFaultRecovery,
  miniFaultRecoveryCommandsToWriterEnvelopes,
  type MiniFaultRecoveryState,
} from "../coreControl";

describe("Mini fault recovery", () => {
  test("classifies PCS, BMS, and PVDC faults independently", () => {
    const result = classifyMiniFaults({
      pcsFault: 1,
      bmsFaultNotAllowHv: 1,
      pvdcFaults: { module1: 0, module2: 4 },
    });

    expect(result).toEqual(
      expect.objectContaining({
        faulted: true,
        recoverable: false,
        pcsFault: true,
        bmsFault: true,
        pvdcFault: true,
      })
    );
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        "mini-pcs-fault",
        "mini-bms-fault",
        "mini-pvdc-fault",
      ])
    );
  });

  test("runs recoverable PCS/PVDC faults through safe-zero and clear commands", () => {
    let state: MiniFaultRecoveryState = { mode: "normal", attempts: 0 };

    let result = evaluateMiniFaultRecovery(
      { pcsFault: 1, pvdcFaults: [1] },
      state,
      { retryMs: 0 }
    );
    state = result.state;
    expect(state).toEqual(expect.objectContaining({ mode: "safe-zero", attempts: 1 }));
    expect(result.commands).toEqual([{ kind: "safe-zero" }]);

    result = evaluateMiniFaultRecovery(
      { pcsFault: 1, pvdcFaults: [1] },
      state,
      { retryMs: 0 }
    );
    state = result.state;
    expect(state.mode).toBe("clear-pcs-fault");

    result = evaluateMiniFaultRecovery(
      { pcsFault: 1, pvdcFaults: [1] },
      state,
      { retryMs: 0 }
    );
    state = result.state;
    expect(result.commands).toEqual([{ kind: "pcs-clear-fault" }]);
    expect(state.mode).toBe("clear-pvdc-faults");

    result = evaluateMiniFaultRecovery(
      { pcsFault: 1, pvdcFaults: [1] },
      state,
      { retryMs: 0 }
    );
    expect(result.commands).toEqual([{ kind: "pvdc-clear-faults" }]);
  });

  test("locks out nonrecoverable BMS faults", () => {
    const result = evaluateMiniFaultRecovery({
      bmsFault: 1,
    });

    expect(result.state.mode).toBe("lockout");
    expect(result.commands).toEqual([{ kind: "safe-zero" }]);
    expect(result.reasons).toEqual(
      expect.arrayContaining(["mini-fault-not-auto-recoverable"])
    );
  });

  test("maps recovery commands to Mini template command IDs", () => {
    const envelopes = miniFaultRecoveryCommandsToWriterEnvelopes(
      [
        { kind: "safe-zero" },
        { kind: "pcs-clear-fault" },
        { kind: "pcs-start" },
        { kind: "pvdc-clear-faults" },
        { kind: "pvdc-start" },
      ],
      { pvdcTopics: ["PVDC_Module1"] }
    );

    expect(envelopes).toEqual([
      {
        topic: "PCS",
        payload: [
          { tagID: "ActivePowerSetpoint", value: 0 },
          { tagID: "MaxChgCurrent", value: 0 },
          { tagID: "MaxDsgCurrent", value: 0 },
          { tagID: "ClearFault", value: 1 },
          { tagID: "TotalStart", value: 1 },
        ],
      },
      {
        topic: "PVDC_Module1",
        payload: [
          { tagID: "PVDCClearFault", value: 1 },
          { tagID: "PVDCStart", value: 1 },
        ],
      },
    ]);
  });
});
