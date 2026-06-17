import { parseMiniModel } from "../capabilities";

describe("MINI model parsing", () => {
  test("defaults omitted MINI voltage to 480 VLL", () => {
    expect(parseMiniModel("MINI-90-135-288")).toMatchObject({
      modelCode: "MINI-90-135-288-480",
      pcsKw: 90,
      dcPvKw: 135,
      batteryKwh: 288,
      voltageVll: 480,
      hasDcPvConverter: true,
    });
  });
});
