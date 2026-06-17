# Site Configuration API Expectation

This document defines the expected API contract for the controller site
configuration used by Node-RED and the TypeScript control logic.

The site configuration is the installed-site contract. Templates describe what a
device can expose. Site configuration describes what this site actually uses,
how raw tags become normalized control signals, and which outputs are allowed.

## Transport

Use the existing Schedule UI ESR route:

```http
POST /api/esr
```

Requests follow the same method-style envelope as schedule methods:

```json
{
  "version": "1.0",
  "requestId": "uuid-or-client-id",
  "endPoint": "ESR",
  "method": "GetControlConfig",
  "data": {}
}
```

Responses should always be JSON and should preserve `requestId` when present.

## Methods

### GetControlConfig

Request:

```json
{
  "version": "1.0",
  "requestId": "6ef8e5fd-5967-47be-bdaa-51f8d2c79d2c",
  "endPoint": "ESR",
  "method": "GetControlConfig"
}
```

Success response:

```json
{
  "version": "1.0",
  "requestId": "6ef8e5fd-5967-47be-bdaa-51f8d2c79d2c",
  "data": {
    "config": {}
  }
}
```

Behavior:

- Return the saved config if one exists.
- If no config exists, return a sensible default config.
- The default config must be complete enough for the UI to render and for
  validation to explain what still needs site-specific setup.

### SaveControlConfig

Request:

```json
{
  "version": "1.0",
  "requestId": "c5cce737-b2fd-4f1b-99a4-fbc75e850825",
  "endPoint": "ESR",
  "method": "SaveControlConfig",
  "data": {
    "config": {}
  }
}
```

Success response:

```json
{
  "version": "1.0",
  "requestId": "c5cce737-b2fd-4f1b-99a4-fbc75e850825",
  "data": {
    "code": 0,
    "message": "OK"
  }
}
```

Failure response:

```json
{
  "version": "1.0",
  "requestId": "c5cce737-b2fd-4f1b-99a4-fbc75e850825",
  "data": {
    "code": 1,
    "message": "Validation or storage error message",
    "errors": []
  }
}
```

Frontend success rule:

```text
response.data.code === 0
```

Node-RED should not return `code: 0` if validation or persistence failed.

## Persistence

Persist the full config object, not just UI fields.

Recommended active file:

```text
/data/node-red/control-config.json
```

Recommended audit/history file:

```text
/data/node-red/control-config-history.jsonl
```

After a successful save, Node-RED should update runtime context:

```js
global.set("controlConfig", config);
global.set("unifiedControlConfig", config);
flow.set("controlConfig", config);
```

The runtime should be able to restart and restore the last saved config from
disk before the first control cycle.

## Top-Level Config Shape

The TypeScript repo currently models this as `SiteConfig` in `src/config.ts`.
The API payload should use the same shape.

```json
{
  "system": {},
  "network": {},
  "operation": {},
  "pcs": {},
  "mbmu": {},
  "battery": {},
  "pv": {},
  "islanding": {},
  "metering": {},
  "signalMapping": {},
  "generator": {}
}
```

`pcs` and `mbmu` are eSpire280-only and may be omitted for eSpire Mini.

`generator` and `islanding` are optional and may be omitted if not installed.

## Required Sections

### system

```json
{
  "systemProfile": "eSpire280",
  "controllerTimezone": "America/Los_Angeles",
  "nominal": {
    "voltageVll": 480,
    "frequencyHz": 60
  }
}
```

For Mini, `systemProfile` may be the parsed Mini model string, for example:

```json
{
  "systemProfile": "MINI-60-90-163-480"
}
```

Mini DC PV converter count is derived from the third model segment:

```text
MINI-XX-00-ZZZ-VVV = no DC PV converter
MINI-XX-45-ZZZ-VVV = one 45 kW DC/DC module
MINI-XX-90-ZZZ-VVV = two 45 kW DC/DC modules
MINI-XX-135-ZZZ-VVV = three 45 kW DC/DC modules
```

### network

```json
{
  "controller": {
    "ip": "192.168.1.10",
    "modbusServer": {
      "ip": "192.168.1.20",
      "port": 502
    }
  }
}
```

`network.controller.modbusServer` is the default Modbus target for PCS/BMS
devices when a source-specific IP is not provided.

### operation

```json
{
  "mode": "grid-tied",
  "gridCode": "IEEE1547-2018",
  "crdMode": "no-restriction",
  "siteExportMode": "no-restriction",
  "siteExportTargetImportKw": 0,
  "siteExportDeadbandKw": 0,
  "scheduledControlEnabled": true
}
```

Expected enum values:

```text
mode: grid-tied | backup | off-grid
gridCode: IEEE1547-2018 | Rule21 | Rule14H | PREPA-MTR | ISO | Ontario-ESA | Custom
crdMode: no-restriction | no-import | no-export | no-exchange
siteExportMode: no-restriction | no-export
```

`crdMode` is PCS/battery-side restriction. `siteExportMode` is whole-site export
restriction and should use utility meter feedback as the final truth.

### battery

```json
{
  "minSoc": 0.2,
  "maxSoc": 0.95,
  "socLow": 0.15,
  "socLowRecover": 0.25,
  "socHigh": 0.98,
  "socHighRecover": 0.9,
  "forceGridChargeSoc": 0.1,
  "forceGridChargeMinCellVoltageV": 3.1,
  "forceGridChargeKw": 50,
  "powerHeadroomKw": 10,
  "commandRampKwPerSec": 5
}
```

SOC values are stored as decimals `0..1`. The UI may display them as percent,
but the API should save decimals.

### pcs

eSpire280 only:

```json
{
  "pcsDaisyChain": [1, 2],
  "maxChargeKw": 125,
  "maxDischargeKw": 125
}
```

### mbmu

eSpire280 only:

```json
{
  "sbmuStrings": [1, 2, 3, 4]
}
```

### pv

```json
{
  "dcCoupledToMiniPcs": false,
  "curtailmentMethod": "modbus",
  "acInverters": [
    {
      "id": "pv-1",
      "type": "SMA",
      "model": "STP",
      "ratedKwAc": 100,
      "ip": "192.168.1.50",
      "port": 502,
      "modbusProfile": "sma-sunspec"
    }
  ]
}
```

For Mini:

- `dcCoupledToMiniPcs: true` means DC PV is internal to the Mini PCS path.
- `dcCoupledToMiniPcs: false` means AC PV only; do not model PV as passing
  through the Mini PCS.
- If `systemProfile` is a Mini model string, the runtime may derive DC PV
  capability from the model segment even when this field is omitted.

### metering

```json
{
  "meterType": "eGauge-4015",
  "modbusProfile": "configured_eGauge",
  "ip": "192.168.1.60",
  "port": 502,
  "unitId": 1,
  "reads": {
    "pv": true,
    "pvFromInverter": false,
    "utility": true,
    "load": true
  },
  "registerMap": [
    {
      "signal": "utilityPowerKw",
      "tagID": "Meter.Utility_Total_Power",
      "register": 9020,
      "function": "IRF",
      "scale": 0.001,
      "sign": 1
    },
    {
      "signal": "siteLoadKw",
      "tagID": "Meter.Load_Active_Power_Raw",
      "register": 9032,
      "function": "IRF",
      "scale": 0.001,
      "sign": 1
    },
    {
      "signal": "pvKw",
      "tagID": "Meter.PV_Total_Power_Raw",
      "register": 9040,
      "function": "IRF",
      "scale": 0.001,
      "sign": -1
    }
  ],
  "calculations": {
    "utilityPowerKw": {
      "source": "tag",
      "tagID": "Meter.Utility_Total_Power"
    },
    "pvKw": {
      "source": "tag",
      "tagID": "Meter2.Solar"
    },
    "siteLoadKw": {
      "source": "calc",
      "inputs": {
        "utility": "Meter.Utility_Total_Power",
        "pv": "Meter2.Solar",
        "pcs": "PCS.SYSTEM_POWER_ACTIVE_ALL"
      },
      "expr": "utility + pv + pcs"
    }
  }
}
```

`metering.registerMap` is the preferred eGauge path for legacy sites. The UI
stores one row per canonical signal/register, plus optional `custom` rows for
site-specific SS40K/export readings such as phase powers. The unified Node-RED
flow turns these rows into an inline eGauge telemetry template at runtime, so the
repo does not need `eGauge_<site>.json` files for every legacy installation.

Supported register row fields:

| Field | Meaning |
| --- | --- |
| `signal` | Canonical meaning, selected from a fixed dropdown such as `utilityPowerKw`, `siteLoadKw`, `pvKw`, `frequencyHz`, voltage/energy keys, or `custom` for export-only legacy rows. |
| `tagID` | Optional emitted telemetry tag. `Meter.` prefix is accepted but stored internally as the Meter equipment tag name. |
| `register` | eGauge Modbus register address used by this site. |
| `function` | Modbus/parser type, for example `IRF`, `HRF`, `HR`, or `HRUS`. |
| `scale` | Numeric multiplier applied after decoding. |
| `offset` | Optional numeric offset applied with scale. |
| `sign` | `1` for normal sign, `-1` to invert legacy meter convention. |
| `ss40kName` | Optional SS40K fixed-point override. Defaults are supplied for major canonical signals. |

For eGauge rows, the runtime also derives stable tags when possible:

```text
utilityPowerKw -> Utility_Import_Power, Utility_Export_Power
siteLoadKw     -> Load_Active_Power
backupLoadKw   -> Load_Active_Power when no siteLoadKw row is configured
pvKw           -> PV_Total_Power
```

`metering.calculations` is the older direct/calc structure. New logic should
prefer `signalMapping` for controller decisions, but this section is still valid
for UI display and backwards compatibility.

## Signal Mapping

`signalMapping` is the key part that makes existing sites configurable without
changing eGauge tag lists or vendor templates.

It maps raw telemetry to canonical control inputs.

```json
{
  "sources": {
    "Meter": {
      "profile": "eGauge_280_ss40k",
      "role": "siteMeter",
      "ip": "192.168.1.60",
      "port": 502,
      "unitId": 1,
      "route": "Meter"
    },
    "Meter2": {
      "profile": "eGauge_Mission_Energy_Meter2_ss40k",
      "role": "pvMeter",
      "ip": "192.168.1.61",
      "port": 502,
      "unitId": 1,
      "route": "Meter2"
    },
    "PCS": {
      "profile": "Delta_280_ss40k",
      "role": "pcs",
      "route": "PCS"
    }
  },
  "deadbands": {
    "pvKw": 0.3
  },
  "signals": {
    "utilityPowerKw": {
      "expr": "Meter.Utility_Total_Power"
    },
    "pvKw": {
      "expr": "deadband(Meter2.Solar, 0.3)"
    },
    "pcsActivePowerKw": {
      "expr": "PCS.SYSTEM_POWER_ACTIVE_ALL"
    },
    "siteLoadKw": {
      "expr": "utilityPowerKw + pvKw + pcsActivePowerKw"
    },
    "generatorRunning": {
      "expr": "Meter.Generator_Total_Power > 1"
    }
  }
}
```

Canonical signal names currently expected by the repo:

```text
utilityPowerKw
pvKw
siteLoadKw
backupLoadKw
batteryPowerKw
pcsActivePowerKw
generatorRunning
```

Expression scope:

- Each telemetry root is exposed by equipment ID. Example:
  `Meter.Utility_Total_Power`, `Meter2.Solar`, `PCS.SYSTEM_POWER_ACTIVE_ALL`.
- Previously calculated canonical signals are also available to later signals.
  Example: `siteLoadKw` can use `utilityPowerKw`, `pvKw`, and
  `pcsActivePowerKw`.
- Helper functions available in repo logic:
  `deadband(value, threshold)`, `max`, `min`, `abs`, `round`, and `Math`.

Sign conventions for canonical signals:

```text
utilityPowerKw: positive = importing from grid, negative = exporting to grid
pvKw: positive = producing
siteLoadKw: positive = consuming
backupLoadKw: positive = consuming on backup output
batteryPowerKw: positive = discharging, negative = charging
pcsActivePowerKw: positive = discharging, negative = charging
```

If a raw source has the opposite sign, set:

```json
{
  "expr": "AMPACE.BamsActivePower",
  "invertSign": true
}
```

Mini vendor convention reminders:

```text
AMPACE BamsPower raw value: positive = discharging, negative = charging
Some Mini PCS active-power values use the opposite sign by site/configuration.
Canonical pcsActivePowerKw: positive = discharging, negative = charging
```

For AWS SS40K export, these canonical signals can override site-level 40101
fields after template mapping:

```text
pvKw -> pPvTotal
utilityPowerKw -> pGridImpTot / pGridExpTot
siteLoadKw -> pLoad
backupLoadKw -> pBkupTot
batteryPowerKw -> pBatDischg / pBatChg
```

## Optional Telemetry Readers

Node-RED may either derive telemetry readers from `signalMapping.sources` or
accept explicit `telemetryReaders`.

```json
{
  "telemetryReaders": [
    {
      "equipmentId": "PCS",
      "profileName": "Sinexcel_Mini_PCS_ss40k",
      "ip": "192.168.1.20",
      "port": 502,
      "unitId": 1,
      "route": "PCS",
      "role": "pcs"
    }
  ]
}
```

If `telemetryReaders` is present, Node-RED should use it as the exact reader
list. If omitted, Node-RED can derive readers from `signalMapping.sources`,
`metering`, `network`, and `system.systemProfile`.

## Validation Requirements

Minimum required validation:

- `system.systemProfile` is present.
- `system.controllerTimezone` is present.
- `system.nominal.voltageVll` and `frequencyHz` are finite positive numbers.
- `operation.mode`, `gridCode`, `crdMode`, and `siteExportMode` match allowed
  enum values.
- `battery.minSoc < battery.maxSoc`.
- All SOC fields are between `0` and `1`.
- `pcs.maxChargeKw` and `pcs.maxDischargeKw` are positive when `pcs` is present.
- PV inverter `port` values are `1..65535`.
- Modbus source/reader `port` values are `1..65535`.
- `signalMapping.signals` expressions exist for at least:
  `utilityPowerKw`, `pvKw`, `pcsActivePowerKw`, and `siteLoadKw`.
- Mini model strings should parse if they start with `MINI-`.
- If `operation.siteExportMode` is `no-export`, `utilityPowerKw` must be
  mapped because utility meter feedback is the final export truth.

Recommended validation:

- Warn when Mini has AC PV but no PV inverter curtailment path.
- Warn when Mini has DC PV and no battery max charge current output path.
- Warn when a configured source references a template/profile that does not
  exist in `src/templates`.
- Warn when both `metering.calculations` and `signalMapping.signals` define the
  same canonical value differently.

## Runtime Expectations

Node-RED should convert telemetry into this runtime sequence:

```text
raw telemetry
  -> template-normalized tags
  -> site signal mapping
  -> canonical control inputs
  -> runUnifiedControlCycle(...)
  -> writer envelopes
  -> Modbus writes
  -> SS40K output to AWSFeedModule and FeedModule
```

The TypeScript control logic should consume canonical values, not raw vendor tag
names.

Expected runtime input example:

```json
{
  "timestamp": "2026-06-04T20:00:00.000Z",
  "systemProfile": "MINI-60-90-163-480",
  "utilityPowerKw": -12.4,
  "pvKw": 68.2,
  "pcsActivePowerKw": -40,
  "siteLoadKw": 15.8,
  "generatorRunning": false,
  "batterySoc": 0.91
}
```

Expected normalized control output concepts:

```json
{
  "pcsActivePowerSetpointKw": -25,
  "maxChargeCurrentA": 80,
  "maxDischargeCurrentA": 120,
  "pvActivePowerLimitKw": 45,
  "reason": "no-export correction"
}
```

Actual device writes should still be emitted through writer envelopes so the
same Modbus writer path is used for eSpire280 and Mini.

## Mini No-Export Behavior

For Mini with DC PV:

- DC PV is inside the Mini PCS path.
- Non-export logic can influence DC PV by limiting battery charge current.
- If the battery is full, setting max charge current to `0` curtails DC PV.
- For sites with non-backed-up load, do not blindly curtail to backed-up load.
  Use `utilityPowerKw` feedback as the final no-export correction signal.

For Mini with AC PV only:

- AC PV does not pass through the Mini PCS DC path.
- Do not use DC PV pass-through assumptions.
- Use PV inverter active power limit when curtailment is required, similar to
  eSpire280.

## Example Existing eGauge Site

Legacy site formula:

```js
gridPower = Meter.Utility_Total_Power;
solarPower = deadband(Meter2.Solar, 0.3);
pcsPower = PCS.SYSTEM_POWER_ACTIVE_ALL;
loadActivePower = gridPower + solarPower + pcsPower;
```

Equivalent config:

```json
{
  "signalMapping": {
    "sources": {
      "Meter": {
        "profile": "eGauge_280_ss40k",
        "role": "siteMeter",
        "ip": "192.168.1.60",
        "route": "Meter"
      },
      "Meter2": {
        "profile": "eGauge_Mission_Energy_Meter2_ss40k",
        "role": "pvMeter",
        "ip": "192.168.1.61",
        "route": "Meter2"
      },
      "PCS": {
        "profile": "Delta_280_ss40k",
        "role": "pcs",
        "route": "PCS"
      }
    },
    "signals": {
      "utilityPowerKw": {
        "expr": "Meter.Utility_Total_Power"
      },
      "pvKw": {
        "expr": "deadband(Meter2.Solar, 0.3)"
      },
      "pcsActivePowerKw": {
        "expr": "PCS.SYSTEM_POWER_ACTIVE_ALL"
      },
      "siteLoadKw": {
        "expr": "utilityPowerKw + pvKw + pcsActivePowerKw"
      }
    }
  }
}
```

## Future API Methods

These are optional but useful once the UI grows:

```text
ValidateControlConfig
GetResolvedControlInputs
GetTelemetryReaders
GetAvailableTemplates
```

`ValidateControlConfig` should run validation without saving.

`GetResolvedControlInputs` should return the latest canonical signals and
diagnostics so setup can verify mapping before enabling control.
