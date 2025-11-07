import { mbmu } from "../src";
test("bit 7 outage", () => {
  expect(mbmu.parseOutage(128)).toBe(true);
  expect(mbmu.parseOutage(0)).toBe(false);
});
