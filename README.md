# keystone-controller-logic
Typed helper library for Keystone EMS / Node-RED controllers (Welotec Azure IoT Edge).

## Dev
npm install
npm test
npm run build

If `npm` is broken in WSL due to Windows Node wrappers, use the direct scripts:

```
./scripts/build-local.sh
./scripts/test-local.sh
./scripts/check-local.sh
```

These use `scripts/with-local-node.sh`, which downloads a Linux Node runtime to `/tmp` and runs with safe temp paths.

If your `npm` command is healthy, these aliases are also available:

```
npm run build:local
npm run test:local
npm run check:local
```

## Deploy
./scripts/deploy.sh NodeRedModule /data-internal/dist

## Node-RED Smoke Flows
- `flows/egauge_template_smoke_test.json`
  - live eGauge compile/start/stop flow with Modbus polling
- `flows/telemetry_calc_constant_smoke_test.json`
  - self-contained smoke flow for `constant` and `calc` tags
  - stores merged results in `flow` context under:
    - `calcConstantTelemetryState`
    - `calcConstantSnapshot`
    - `calcConstantLastReport`
  - recommended sequence:
    1. `Compile Smoke Profile`
    2. `Start Smoke Profile`
    3. `Simulate RAW_POWER = 1234`
    4. `Simulate SCALE_EXP = -1`
  - expected merged result:
    - `CONST_SITE_ID = 280`
    - `RAW_POWER = 1234`
    - `SCALE_EXP = -1`
    - `SITE_POWER = 123.4`

## Device Runtime Layout (Confirmed on 10.253.1.16)
- Container: `NodeRedModule`
- Active compiled library path: `/data-internal/dist`
- Secondary source workspace path (lightweight copy): `/data-internal/logic`
- Node-RED settings file: `/data-internal/settings.js`

### Node-RED Global Context Settings
The function nodes are configured to load this repo bundle from global context:

```js
module.exports.functionExternalModules = true;
module.exports.functionGlobalContext = Object.assign(
  {},
  module.exports.functionGlobalContext || {},
  { lib: require("/data-internal/dist") }
);
```

This enables function-node usage like:

```js
const lib = global.get("lib");
// lib.telemetry.handleTelemetryMessage(...)
```
