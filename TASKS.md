# Keystone Controller Logic - Recovered Task List

This task list was rebuilt on April 3, 2026 from:
- current local repo changes
- current templates/tests/runtime code
- Node-RED flow export: `test_controller_export_v2.json`

## Recovered Progress (Already Done)

- [x] Added telemetry template adapter pipeline:
  - `resolveTelemetryTemplate(...)`
  - `adaptTelemetryTemplateToReadProfile(...)`
- [x] Added telemetry runtime orchestration:
  - `createTelemetryRuntimeState(...)`
  - `handleTelemetryMessage(...)` with `compile/start/stop/reply`
- [x] Extended compiler/reader for telemetry template features:
  - constants
  - calc tags
  - virtual placeholder tags
  - startup polling class
  - enum status decoding
  - bitfield status decoding
- [x] Added Modbus reader logic for telemetry templates:
  - function/address handling
  - poll-class-driven read planning
  - status/bitfield decoding inputs
- [x] Added Modbus writer/command handling foundation:
  - command-spec-driven write shape
  - dtype-aware value coercion and validation
- [x] Added template support for derived/static points:
  - `calc` expression handling
  - `constant` value handling
- [x] Added/expanded ingestion tests in:
  - `src/__tests__/telemetryIngestion.spec.ts`
- [x] Updated TS config for test globals:
  - `tsconfig.json` now includes `types: ["node", "jest"]`
- [x] Node-RED runtime flow is wired to repo API:
  - compile/start/stop injects
  - function node calls `lib.telemetry.handleTelemetryMessage(...)`
  - modbus-flex-getter reply loops back to runtime
  - parsed telemetry + diagnostics debug outputs

## Confirmed Local Template Changes

- [x] `src/templates/MBMU_280_ss40k.json`
  - migrated legacy `status.enum` -> `enumStatus`
  - migrated legacy `status.bitfieldStatus` -> `bitfieldStatus`
- [x] `src/templates/eGauge_280_ss40k.json`
  - local diff appears mostly formatting/line-ending churn
- [x] Added Mini Sinexcel templates:
  - `src/templates/Sinexcel_Mini_ss40k.json`
  - `src/templates/Sinexcel_Mini_Fault_Map_ss40k.json`
  - Mini fault map aligned to SS40K model `40103`

## Active Tasks (Next)

- [ ] Run full verification in a working Node/TS runtime:
  - `npm run build`
  - `npm test`
  - fix any remaining compile/test failures
- [ ] Decide whether to keep or revert whitespace-only churn in template/docs/config files.
- [ ] Reconcile test file move:
  - `src/__tests__/modbusFunctions.spec.ts` is deleted
  - confirm replacement coverage in `src/__tests__/telemetryIngestion.spec.ts`
- [ ] Validate all templates against adapter rules (no malformed `calc`, `scale`, or source-type mixes).
- [ ] Validate Node-RED flow end-to-end against target meter:
  - compile -> start -> poll -> parse -> diagnostics
  - confirm tag IDs and sample values in debug output
- [ ] Add `Configurations` task set based on `src/coreControl/keystone_ci_addition.yaml`:
  - verify every YAML point is represented in controller config ingestion/apply coverage
  - confirm section/subsection grouping matches intended SiteConfig UX
  - validate enum/range handling for site, microgrid, battery, AC-coupled PV, protection, metering, and generator settings
  - add or update tests for YAML-backed config points and expected diagnostics
- [ ] Add core control logic for both product lines:
  - `280`
  - `Mini`
  - define product-specific control behavior and shared abstractions
  - confirm command routing, limits, and operating-mode handling per product
  - add or update tests covering both product control paths
- [ ] Add commit checkpoints once green:
  1. runtime + adapter + reader/compiler changes
  2. templates + tests
  3. flow/export docs

## Config Engine Progress (Cloud -> SiteConfig)

- [x] Added YAML-driven command-spec loader from `src/coreControl/keystone_ci_addition.yaml`
- [x] Added cloud config ingestion/apply engine:
  - `src/cloudConfig/engine.ts`
  - command/arg validation, dtype conversion, enum/range enforcement
  - hybrid apply classification (`hot` vs `restart-required`)
  - post-apply `SiteConfig` validation and structured diagnostics
- [x] Expanded `SiteCapabilities` for topology/integration/control-policy flags
- [x] Added config ingestion tests:
  - `src/__tests__/configIngestion.spec.ts`
  - fixture: `src/__tests__/fixtures/cloudConfigUpdates.json`
- [x] Added telemetry baseline lock test group in `src/__tests__/telemetryIngestion.spec.ts`

## Cloud Integration And Testing

- [ ] Validate cloud config ingestion against every point in `src/coreControl/keystone_ci_addition.yaml`.
- [ ] Verify Cloud -> `SiteConfig` mapping for both `280` and `Mini`.
- [ ] Confirm `hot` vs `restart-required` apply behavior per cloud-driven command.
- [ ] Add product capability gating so cloud updates expose only valid settings per site profile.
- [ ] Validate controller diagnostics returned to cloud for invalid enum, range, type, and missing-field cases.
- [ ] Add end-to-end tests for cloud payload -> validation -> apply plan -> resulting `SiteConfig`.
- [ ] Add cloud config fixture sets for both `280` and `Mini`.
- [ ] Add negative/regression tests for invalid cloud payloads and YAML-backed command changes.
- [ ] Add integration tests proving cloud config changes do not break telemetry/runtime flows.

## Optional Hardening

- [ ] Add a small schema validation test for every template file in `src/templates`.
- [ ] Add runtime diagnostics for missing calc inputs (tag IDs not yet populated).
- [ ] Add explicit unit test for `bitfieldStatus: true` on high bits (e.g., bit 31).

## Working Notes

- Current branch `main` is aligned with `origin/main` at last check.
- Many tracked files are modified locally (expected based on current work-in-progress).
- Node tooling from this shell environment is currently blocked (WSL/Node runtime issue), so final green checks should be run in your normal VS Code terminal environment.
