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

## Optional Hardening

- [ ] Add a small schema validation test for every template file in `src/templates`.
- [ ] Add runtime diagnostics for missing calc inputs (tag IDs not yet populated).
- [ ] Add explicit unit test for `bitfieldStatus: true` on high bits (e.g., bit 31).

## Working Notes

- Current branch `main` is aligned with `origin/main` at last check.
- Many tracked files are modified locally (expected based on current work-in-progress).
- Node tooling from this shell environment is currently blocked (WSL/Node runtime issue), so final green checks should be run in your normal VS Code terminal environment.
