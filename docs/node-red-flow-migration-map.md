# Node-RED Flow Migration Map

Source export: `C:\Users\ShawnChapari\Downloads\flows (56).json`

This map treats the existing Node-RED work as the field-proven behavior source.
The goal is not to discard the flow. The goal is to harvest its control intent,
preserve it with tests, and leave Node-RED responsible for IO/orchestration.

## Flow Inventory

- Export size: 230 nodes.
- Main tab: `Controls`.
- Subflows:
  - `Modbus Writer (2)` and three copied variants.
- Heavy node groups:
  - 80 `modbus-flex-write` nodes.
  - 59 `function` nodes.
  - 14 `switch` nodes.
  - 4 `subflow` definitions.

## Migration Rule

- Keep in Node-RED:
  - Modbus polling and writes.
  - Inject/debug/UI/link plumbing.
  - Device-specific raw-bit reads until adapters are built.
  - Calling `coreControl.runUnifiedControlCycle(...)`.
- Move into TypeScript:
  - Control decisions.
  - Dispatch math.
  - Safety gates.
  - State machines that affect control outputs.
  - Writer-envelope generation.
- Convert into config:
  - Site tag names.
  - Metering formulas.
  - Schedule/plan definitions.
  - Limits, deadbands, thresholds, retry counts, and product enable flags.

## Existing Flow Domains

### Writer Subflows

Nodes:
- `Modbus Writer (2)`
- `Modbus Writer (2) (2) (2)`
- `Modbus Writer (2) (3)`
- `Modbus Writer (2) (4)`

Behavior found:
- Looks up tag Modbus properties.
- Routes by register type.
- Builds S16, U16, F32, S32, U32, and coil payloads.
- Applies linear scaling.
- Emits incorrect-server diagnostics.

Migration:
- Already mostly replaced by the typed writer runtime.
- Keep Node-RED only as the final Modbus transport.
- Reuse existing writer templates and `writerEnvelopes` from unified control.

Destination:
- `src/writer/*`
- `runUnifiedControlCycle(...).writerEnvelopes`

### BMS Heartbeat

Nodes:
- `Calculate BMS Heartbeat`
- `Create MBMU_1 Hearbeat Command`

Behavior found:
- Reads `global.state.BmsHeartbeat`.
- Increments 0 to 255, then rolls to 0.
- Writes `MBMU.EMS_Heartbeat`.

Migration:
- Move into TypeScript as a periodic auxiliary command producer.
- Keep timer cadence in Node-RED.

Destination:
- New auxiliary command stage, likely `buildAuxiliaryWriterEnvelopes(...)`.

Open question:
- Should heartbeat live in the main control cycle or a separate fast auxiliary cycle?

### PCS Startup

Node:
- `PCS Startup`

Behavior found:
- Reads `PCS.SYSTEM_GLOBAL_STATE`.
- For state 1, sends:
  - `PCS.SYSTEM_ACTIVE_POWER_DEMAND = 0`
  - `PCS.SYSTEM_ON_OFF = 1`
- For SA states 4, 5, 6, sends active power demand 0.
- Reads `PCS.SYSTEM_HARDWARE_FAULT` and EPO bit but does not currently use the EPO result for startup decisions.

Migration:
- Move as a product-aware startup policy.
- Gate through protection and safety stages.

Destination:
- New pipeline stage: `startup`.
- Writer envelope topic: `PCS`.

### MBMU Startup

Node:
- `MBMU Startup`

Behavior found:
- Reads `MBMU.BMS_Status`, `MBMU.BMS_PowerOn_State`, and battery SOC.
- If status 0, sends `MBMU.EMS_Cmd = 2`.
- If status 1 and power-on state is 0 and SOC < 0.97, sends `MBMU.EMS_Cmd = 2`.

Migration:
- Move into TypeScript as BMS startup policy.
- Keep the SOC threshold configurable.

Destination:
- New pipeline stage: `battery-startup`.
- Writer envelope topic: `MBMU`.

### PCS Fault Handling

Node:
- `PCS Fault handling`

Behavior found:
- Reads `PCS.SYSTEM_GLOBAL_STATE`.
- If state 7, attempts fault clear up to 6 times.
- Sends `PCS.SYSTEM_CLEAR_FAULTS = 1`.
- Uses `global.state.PCSRecoveryAttempts`.
- Reads hardware fault/EPO bit.

Migration:
- Move into TypeScript as a stateful PCS recovery policy.
- Preserve attempt limits and EPO guard after verifying the EPO bit semantics.

Destination:
- New stateful recovery module.

Open question:
- Current code checks `pcsEPOStatus != 2`, but the bit mask produces 0 or 1. Confirm intended EPO blocking condition.

### SEL Bit Parsing

Node:
- `parse received SEL HR's bitfield's values`

Behavior found:
- Reads three holding-register words.
- Extracts:
  - `sel_outage` from arr[0] bit 7.
  - `sel_remote_interlock` from arr[1] bit 7.
  - `sel_ktran_command` from arr[1] bit 6.
  - `sel_kgrid_status` from arr[2] bit 0.
  - `sel_ktran_status` from arr[2] bit 1.
- Stores results in flow context.

Migration:
- Convert into a device adapter that emits normalized protection telemetry:
  - `protectionState`
  - `pcsRunAllowed`
  - `remoteInterlockClosed`

Destination:
- New adapter helper, likely `src/coreControl/protectionAdapters.ts`.
- Feeds `TelemetrySnapshot.protectionState`, `pcsRunAllowed`, and `remoteInterlockClosed`.

### Outage Detection And PCS GT/SA Mode

Nodes:
- `Outage Detection and SA/GT settings`
- `Outage Detection and GT/SA mode settings with repeatable command`
- `SEL751 without RB1`

Behavior found:
- Uses SEL outage bit to choose PCS mode:
  - outage = 1 -> off-grid mode.
  - outage = 0 -> grid-tie mode.
- Writes:
  - `PCS.SYSTEM_RUN_MODE`
  - `PCS.GRID_WIRE_CONNECTION`
- Repeatable version resends until telemetry matches target.
- SEL751-specific version reads `SEL751.ROW_21` bit 7 and writes only `PCS.SYSTEM_RUN_MODE`.

Migration:
- Split into two pieces:
  - Adapter: SEL bits -> normalized protection/islanding state.
  - Control output: desired PCS run mode and grid-wire connection writer envelope.
- Preserve retry-until-readback behavior as a writer/retry policy, not dispatch math.

Destination:
- New command fields on `CoreControlCommand`, for example:
  - `pcsRunMode?: "grid-tie" | "off-grid"`
  - `gridWireConnection?: boolean`
- New writer tags:
  - `PCS.SYSTEM_RUN_MODE`
  - `PCS.GRID_WIRE_CONNECTION`

Status:
- Extracted into unified control.
- A healthy protected `islanded` state now requests:
  - `SYSTEM_RUN_MODE = 1`
  - `GRID_WIRE_CONNECTION = 1`
- A healthy protected `normal` state now requests:
  - `SYSTEM_RUN_MODE = 0`
  - `GRID_WIRE_CONNECTION = 0`
- Retry-until-readback behavior is not extracted yet.

### SEL851 RB Commands

Nodes:
- `SEL851` for `SEL851.RB_1`
- `SEL851` for `SEL851.RB_2`

Behavior found:
- Passes `msg.payload` into relay-bit commands:
  - `SEL851.RB_1`
  - `SEL851.RB_2`

Migration:
- Keep direct manual controls in Node-RED during commissioning.
- Later move into protection/islanding writer envelopes once command semantics are confirmed.

Destination:
- Protection writer route.

Open question:
- Confirm which relay bit is remote interlock and which is KTran command for each SEL variant.

### MBMU Fault Reset / Lockout / Recovery

Node:
- `System Fault Reset`

Behavior found:
- Voltage-based hard lockout:
  - Min cell voltage below 2.95 V for 60 seconds.
  - Max cell voltage above 3.6 V for 60 seconds.
  - Latches `MBMU_Lockout`.
  - Sends `MBMU.EMS_Cmd = 3` to turn MBMU off.
  - Does not auto-recover until manual lockout clear.
- Recovery sequencer:
  - Handles BMS warning status 4 only if `BMS_PowerOn_State == 0`.
  - Handles BMS fault status 5 always.
  - Sequence:
    - OFF
    - wait OFF-ready
    - clear fault
    - check active status
    - ON
    - wait ON-ready
  - Max attempts: 5.
- Normal/idle behavior:
  - Sends `MBMU.EMS_Cmd = 2` if OFF-ready and cooldown allows.
  - SOC is visibility only in this node.

Migration:
- Move into TypeScript as a stateful battery protection/recovery module.
- This should be separate from dispatch SOC policy.

Destination:
- New module, likely `src/coreControl/batteryRecovery.ts`.
- New pipeline stages:
  - `battery-protection`
  - `battery-recovery`

Open questions:
- Keep thresholds at 2.95 V / 3.6 V / 60 s globally, or make them site config?
- Is max high trip comment 3.57 V older than current 3.6 V implementation?

### Site Metering Normalization

Node:
- `Telemetry -> msg.readings`

Behavior found:
- Builds flat tag index from `global.telemetry`.
- Reads:
  - Utility/net: `Meter2.Grid`
  - PCS actual: `PCS.SYSTEM_POWER_ACTIVE_ALL`
  - Load: `Meter.Load_Active_Power`
  - PV: `Meter2.Solar`
  - PV fallback: sum all `*.PAC` inverter tags.
  - SOC: `MBMU.System_SOC_pct`
  - Charge/discharge caps from MBMU voltage/current.
- Reads environment overrides:
  - `ESR_EXPORT_LIMIT_KW`
  - `ESR_ALLOW_EXPORT`
  - `ESR_DEADBAND_KW`

Migration:
- Convert tag choices and formulas into `config.metering.calculations`.
- Keep generic grouped telemetry input support in TypeScript.
- Add optional formula helpers such as inverter PAC sum.

Destination:
- Existing `src/coreControl/meteringCalculations.ts`.
- Existing `config.metering.calculations`.

### ESR Parse Inputs

Node:
- `1) Parse Inputs (coerce + PCC netload first)`

Behavior found:
- Coerces telemetry into numeric readings.
- Priority:
  - use `netLoadKW` directly if present.
  - otherwise calculate `netLoadKW = siteLoadKW - pvKW`.
- Defaults:
  - `deadbandKW` from env/config.
  - `allowExport` from env/config.
- Carries:
  - rated charge/discharge kW.
  - import cap.
  - grid OK.
  - BMS charge/discharge permissions.

Migration:
- Preserve as telemetry normalization and metering calculation config.
- Map BMS permissions to `allowCharge` and `allowDischarge`.

Destination:
- Existing `runUnifiedControlCycle(...)` input preparation.
- Possible new adapter from `msg.readings` to `TelemetrySnapshot`.

### Schedule / Active Plan Selection

Node:
- `2) Match Active Plan (cron+duration)`

Behavior found:
- Reads plans from `flow.plans` or `msg.plans`.
- Uses timezone from `flow.esr_timezone`, default `America/Los_Angeles`.
- Supports:
  - cron schedule.
  - duration windows.
  - cross-midnight matching.
  - start/until bounds.
  - default fallback.
  - midnight short TTL.
  - prefer-today guard.
- Marks selected local plan as `_source: "local"`.

Migration:
- Move into scheduler module or keep as schedule adapter initially.
- Preserve with dedicated regression tests.

Destination:
- `src/scheduler` or new `src/coreControl/schedulePlan.ts`.

Open question:
- Do we want cloud schedules to use this exact plan format, or should we translate cloud schedules into the existing `ScheduleOutput` shape?

### Meter Rule Dispatch

Node:
- `4) Meter Rule`

Behavior found:
- This is the richest dispatch behavior in the flow.
- Sign convention:
  - `+ PCS kW` = discharge.
  - `- PCS kW` = charge.
  - `+ utility/netLoad kW` = import.
  - `- utility/netLoad kW` = export.
- Requires utility reading.
- SOC guards:
  - charge allowed below max SOC.
  - discharge allowed above min SOC.
  - optional override.
- Supports fixed output for charge/discharge in kW or percent of rated capacity.
- SOC floor top-off:
  - default floor 15%.
  - default release floor + 2%.
  - default top-off 30% of rated charge, with fallback kW.
- Continuous meter-rule tracker:
  - charge target threshold.
  - discharge target threshold.
  - baseline memory using `baseMemKW`.
  - smoothing factor `BASE_ALPHA`.
  - stickiness threshold `BASE_STICK_EPS`.
  - in-band hold.
  - target-loss grace.
  - hysteresis/persist.
- Export guard:
  - if export not allowed, min net is 0.
  - if export allowed, cap by export limit.
- Flow context state:
  - `lastPcsKW`
  - `lastMode`
  - `lastPV`
  - `baseMemKW`
  - `lastTarget`
  - `lastTs`
  - `prevUtilKW`

Migration:
- Move into TypeScript as a stateful dispatch strategy.
- Current `applyCrdPolicy(...)` is simpler and should not be considered equivalent.
- Preserve behavior with tests copied from old-flow scenarios.

Destination:
- New module, likely `src/coreControl/meterRuleDispatch.ts`.
- New state object passed into `runUnifiedControlCycle(...)` or held by `initCoreControl(...)`.

Open questions:
- Which sites currently depend on baseline memory/hysteresis behavior?
- Should no-export CRD use this meter-rule tracker instead of simple one-cycle correction?
- Which env knobs should become YAML/cloud settings?

### PV Rule Dispatch

Node:
- `4) Evaluate PV Rule (optional path)`

Behavior found:
- Supports `selfconsumption`:
  - PV surplus -> charge by surplus.
  - PV deficit -> discharge by deficit.
- Supports `off`.
- Uses max charge/discharge percentage constraints.

Migration:
- Move into TypeScript as dispatch strategy.
- Keep separate from PV curtailment. This is battery dispatch for PV self-consumption, not inverter curtailment.

Destination:
- New dispatch strategy in `evaluateCoreControl(...)` or `dispatchStrategies.ts`.

### PCS Command Preparation

Nodes:
- `5) Prepare PCS Command`
- `Create Control Commands`

Behavior found:
- Converts signed `pcsSetpointKW` or action target into PCS kW.
- Emits:
  - `PCS.SYSTEM_ACTIVE_POWER_DEMAND`

Migration:
- Already present in `runUnifiedControlCycle(...).writerEnvelopes`.

Destination:
- Existing PCS writer envelope.

## Immediate Next Extraction Order

1. Metering adapter parity:
   - Preserve `Meter2.Grid`, `Meter.Load_Active_Power`, `Meter2.Solar`, `*.PAC`, and PCS actual formulas in config/tests.
2. Protection adapter parity:
   - Convert SEL bit parsing to normalized protection telemetry.
3. PCS GT/SA mode writer:
   - Add `PCS.SYSTEM_RUN_MODE` and `PCS.GRID_WIRE_CONNECTION` outputs.
4. Meter rule dispatch parity:
   - Implement stateful meter-rule strategy with baseline memory, hysteresis, grace, and export cap.
5. MBMU lockout/recovery:
   - Implement voltage debounce lockout and recovery sequencer.
6. Auxiliary heartbeat/startup:
   - Add heartbeat and startup command producers.

## Current Unified-Control Coverage

Already represented:
- Product route plan for eSpire280 and Mini.
- Site-specific metering calculations.
- Simple CRD modes.
- SOC min/max dispatch limits.
- PCS limits.
- Generator start/stop and generator charge support.
- PV curtailment decision.
- Normalized protection hard gates.
- SEL/ATS-driven PCS grid-tie/off-grid mode command generation.
- PCS active/reactive writer envelope.

Not yet fully represented from the old flow:
- Stateful meter-rule tracker.
- Schedule plan selection parity.
- MBMU voltage lockout/recovery.
- PCS startup/fault recovery.
- PCS grid-tie/standalone retry-until-readback behavior.
- Heartbeat auxiliary command.
- SEL-specific adapter functions.
