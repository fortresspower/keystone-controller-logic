import { readFileSync } from "fs";
import path from "path";

type FlowNode = {
  id?: string;
  type?: string;
  func?: string;
};

describe("unified platform runtime flow", () => {
  const flow = JSON.parse(
    readFileSync(
      path.resolve(__dirname, "../flows/unified_platform_runtime_flow.json"),
      "utf8"
    )
  ) as FlowNode[];

  function functionBody(id: string): string {
    const node = flow.find((item) => item.id === id);
    expect(node).toBeDefined();
    expect(node?.type).toBe("function");
    return node?.func || "";
  }

  test("uses unified telemetry store for runtime APIs", () => {
    expect(functionBody("platform_read_telemetry")).toContain(
      "global.get('unifiedTelemetry')"
    );
    expect(functionBody("platform_status_handler")).toContain(
      "global.get('unifiedTelemetry')"
    );
    expect(functionBody("platform_sched_api_rt_handler")).toContain(
      "lastUnifiedControlCycle"
    );
  });

  test("does not use hardcoded eGauge/default waveform signal sources", () => {
    const runtimeBodies = [
      "platform_run",
      "platform_sched_api_rt_handler",
      "platform_read_telemetry",
      "platform_status_handler",
    ].map(functionBody);

    for (const body of runtimeBodies) {
      expect(body).not.toContain("Meter.Utility_Total_Power");
      expect(body).not.toContain("Meter2.Solar");
      expect(body).not.toContain("PCS.SYSTEM_POWER_ACTIVE_ALL");
      expect(body).not.toContain("node-red-test-waveform");
      expect(body).not.toContain("global.get('telemetry')");
    }
  });
});
