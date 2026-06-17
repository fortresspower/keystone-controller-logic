# Unified Node-RED Flow API Design

This flow is intended to be product-neutral. Node-RED owns transport, API
compatibility, Modbus routing, and persistence. Product behavior lives in
`/data-internal/dist`, telemetry templates, writer templates, and `siteConfig`.

## Runtime Tabs

### Boot And Runtime Plan

- Load `/data-internal/dist`.
- Load canonical `/data-internal/siteConfig.json`.
- Load `/data-internal/runtime/site-runtime.json`.
- Compile telemetry readers for every configured asset/template.
- Compile writer profiles for every writable asset/template.
- Publish:
  - `global.siteConfig`
  - `global.controlConfig`
  - `global.runtimePlan`
  - `global.telemetrySnapshot`
  - `global.controlState`

### Unified Telemetry

- Poll fixed Modbus server slots (`server_1` through `server_20`).
- Decode replies through the repo telemetry runtime.
- Store raw and normalized samples in one telemetry snapshot.
- Evaluate configured `signalMapping` to produce canonical signals.

### Unified Control

- Read `global.siteConfig`, `global.telemetrySnapshot`, `global.schedulePlans`,
  and realtime dispatch state.
- Run repo scheduler.
- Run `runUnifiedControlCycle`.
- Run product sequencers enabled by derived site capabilities.
- Merge commands through a command arbiter.
- Write final command envelopes through the repo writer runtime.

### Config And Restart

- Apply config changes.
- Build a runtime plan and topology hash.
- Patch fixed Node-RED Modbus client slots when topology changes.
- Write `/data-internal/runtime/apply-site-config-result.json`.
- Host-side supervisor restarts `NodeRedModule` when `restartRequired` is true.

## API Endpoints

### `POST /api/esr`

Compatibility endpoint for the ESR schedule/config UI.

Request envelope:

```json
{
  "version": "1.0",
  "requestId": "client-id",
  "endPoint": "ESR",
  "method": "GetList",
  "data": {}
}
```

Supported methods:

| Method | Purpose | Runtime action |
| --- | --- | --- |
| `GetList` | Return flattened schedule plans for ESR UI | Read persisted/global schedule groups |
| `Append` | Append schedule group(s) | Validate, merge, persist, publish `global.schedulePlans` |
| `Delete` | Delete one schedule plan by `planID` | Remove plan, persist, publish `global.schedulePlans` |
| `Reset` | Clear schedules | Clear schedule storage and publish an empty plan list |
| raw group payload | Replace schedule set | Validate, persist, publish `global.schedulePlans` |
| `GetControlConfig` | Return ESR-compatible site config | Load canonical `SiteConfig`, adapt for ESR UI if needed |
| `SaveControlConfig` | Save site config | Normalize ESR shape, validate canonical `SiteConfig`, build runtime plan, return restart decision |

Schedule writes must update all of these locations:

```js
flow.set("plans", plans);
global.set("schedulePlans", plans);
global.set("scheduleRaw", plans);
global.set("scheduleUpdatedAt", new Date().toISOString());
```

Schedule writes should also persist to disk:

```text
/data-internal/schedules/esr-schedule-groups.json
/data-internal/schedules/esr-schedule-history.jsonl
```

`SaveControlConfig` success response should include restart status:

```json
{
  "code": 0,
  "message": "Success",
  "version": "1.0",
  "requestId": "client-id",
  "data": {
    "code": 0,
    "message": "OK",
    "restartRequired": true,
    "validationIssues": [],
    "changedServerSlots": ["server_1"]
  }
}
```

### `GET /api/realtime-signals`

Power-flow endpoint consumed by ESR UI every second.

Response shape:

```json
{
  "data": {
    "signals": {
      "utilityPowerKw": 0,
      "pvKw": 0,
      "pcsActivePowerKw": 0,
      "siteLoadKw": 0,
      "generatorRunning": false,
      "batterySoc": 0.5
    },
    "raw": {},
    "source": "unified-telemetry",
    "updatedAt": "2026-06-10T00:00:00.000Z"
  }
}
```

This endpoint should not hard-code product tags. It should use canonical values
from the unified telemetry/signal-mapping layer. If canonical values are
missing during commissioning, return test waveform values with
`source: "node-red-test-waveform"` so the UI remains usable.

### `GET /api/control/status`

Commissioning/status endpoint for diagnostics.

Returns:

- current product line and site profile
- runtime plan topology hash
- active schedule summary
- telemetry freshness summary
- last unified control command
- pipeline active/skipped/blocked stages
- current restart requirement, if a config apply is pending

### `POST /api/control/realtime-dispatch`

Optional manual/realtime dispatch endpoint.

Request:

```json
{
  "activePowerKw": 25,
  "reactivePowerKvar": 0,
  "ttlSec": 300,
  "enabled": true
}
```

Runtime action:

- Store `global.realtimeDispatch`.
- Include `expiresAtMs`.
- Unified control uses realtime dispatch only when scheduled control does not
  provide a setpoint and safety gates are clear.

### `POST /api/control/config/apply`

Canonical config endpoint for non-ESR clients.

Request:

```json
{
  "config": {}
}
```

Runtime action:

- Validate canonical `SiteConfig`.
- Build runtime plan.
- Persist config/runtime plan.
- Return `restartRequired`.

## ESR Control Config Mismatch Audit

Live ESR config from `10.253.1.16` is not the same as repo `SiteConfig`.
The unified flow needs a compatibility adapter before validation.

| Live ESR path | Repo path | Status | Action |
| --- | --- | --- | --- |
| `batteryPolicy` | `battery` | Mismatch | Alias to `battery` on ingest. Return `batteryPolicy` only if ESR UI still expects it. |
| missing `network` | `network.controller` | Missing required field | Add ESR UI fields or default from existing controller/site runtime. Without this, repo validation fails. |
| `protection.islanding` | `islanding` | Mismatch | Move `protection.islanding.device` to `islanding.device`. |
| missing `generator` | `generator?` | Optional | OK if not installed. ESR UI should expose when generator is configured. |
| `metering.calculations.utilityPowerKw: "meter.utility.kw"` | `metering.calculations.utilityPowerKw: { source, tagID/inputs, expr }` | Mismatch | Convert strings to `{ source: "tag", tagID: value }` or require structured calculation objects. |
| `metering.calculations.siteLoadKw: "meter.load.kw"` | structured calculation object | Mismatch | Same conversion as above. |
| `metering.calculations.pvKw: "meter.pv.kw"` | structured calculation object | Mismatch | Same conversion as above. |
| `signalMapping.signals.*.notes` | not typed | Extra field | Harmless if adapter strips or TypeScript ignores at runtime; should not be relied on. |
| `operation.mode: "backup"` | `OperationMode` allows `backup` | OK | Supported. |
| `system.systemProfile: "eSpire280"` | same | OK | Supported. |
| `pcs`, `mbmu` | eSpire280 required | OK for 280 | Must be omitted or stripped for Mini except non-topology PCS limits. |
| `pv.dcCoupledToMiniPcs` absent | optional Mini PV flag | Missing optional | For Mini, infer from model `dcPvKw > 0` unless ESR UI provides override. |
| asset IPs only in meter/ac inverter fields | runtime asset/server slots | Incomplete topology | Need runtime plan builder to derive PCS/BMS/PVDC asset IPs from site config defaults or product defaults. |

## Required Adapter Behavior

Before passing ESR `SaveControlConfig` payload into repo validation:

```js
function normalizeEsrControlConfig(input) {
  const cfg = clone(input);

  if (!cfg.battery && cfg.batteryPolicy) {
    cfg.battery = cfg.batteryPolicy;
  }

  if (!cfg.islanding && cfg.protection?.islanding) {
    cfg.islanding = cfg.protection.islanding;
  }

  if (!cfg.network) {
    cfg.network = defaultNetworkFromRuntimeOrSite();
  }

  cfg.metering.calculations = normalizeMeteringCalculations(
    cfg.metering.calculations
  );

  return cfg;
}
```

String metering calculations should be normalized as direct tags:

```js
{
  "utilityPowerKw": "meter.utility.kw"
}
```

becomes:

```js
{
  "utilityPowerKw": {
    "source": "tag",
    "tagID": "meter.utility.kw"
  }
}
```

## Flow Design Rule

The ESR API is compatibility surface. The canonical runtime surface is always:

```text
SiteConfig
RuntimePlan
schedulePlans
telemetrySnapshot
canonicalSignals
writerEnvelopes
```

No product-specific logic should be placed in ESR UI handlers. Product-specific
behavior is selected by `SiteConfig` and repo-derived capabilities.
