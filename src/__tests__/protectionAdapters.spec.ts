import {
  normalizeSel751Protection,
  normalizeSelHoldingRegisterProtection,
} from "../coreControl";

describe("protection adapters from Node-RED flow behavior", () => {
  test("normalizes SEL holding-register bits from the legacy flow parser", () => {
    const normalized = normalizeSelHoldingRegisterProtection({
      row46: 0b10000000,
      row48: 0b11000000,
      row33: 0b00000011,
    });

    expect(normalized).toEqual({
      protectionState: "islanded",
      pcsRunAllowed: true,
      remoteInterlockClosed: true,
      outageDetected: true,
      raw: {
        sel_outage: 1,
        sel_remote_interlock: 1,
        sel_ktran_command: 1,
        sel_kgrid_status: 1,
        sel_ktran_status: 1,
      },
    });
  });

  test("normalizes SEL751 outage bit from ROW_21 bit 7", () => {
    expect(normalizeSel751Protection({ row21: 0b10000000 })).toEqual({
      protectionState: "islanded",
      pcsRunAllowed: true,
      outageDetected: true,
      raw: {
        sel_outage: 1,
      },
    });

    expect(normalizeSel751Protection({ row21: 0 })).toEqual({
      protectionState: "normal",
      pcsRunAllowed: true,
      outageDetected: false,
      raw: {
        sel_outage: 0,
      },
    });
  });
});
