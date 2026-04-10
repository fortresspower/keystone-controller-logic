# Telemetry Reference

This document covers how telemetry data moves from Guardian firmware into the cloud (ra-telemetry / InfluxDB), the data model, MQTT topics, and the gRPC API for reading and writing telemetry.

---

## Architecture Overview

```
                        Guardian (firmware)
                        │
                        │  Reads device data via RS485/Modbus, CAN, etc.
                        │  Publishes ONE model per MQTT message
                        ▼
             MQTT topic: fort/v1/things/{GSN}/telem
             Raw JSON payload (see format below)
                        │
                        ▼
             Telegraf (ra-ingester/intake_iotcore)
             Wraps in {name, tags, fields, timestamp} envelope
             Publishes to NATS: telemetry.raw.intake
                        │
                        ▼
             Dedupe service
             Deduplicates within 5-min window
             Publishes to NATS: telemetry.raw.deduped
                        │
                        ▼
             sink_influxdb
             Converts field names, extracts tags
             Writes to InfluxDB (bucket: product_records)
                        │
                        ▼
             ra-telemetry (gRPC service, port 50051)
             Reads from InfluxDB on demand
                        │
                        ▼
             cmsandbox services (managers, apps, dashboards)
```

---

## Guardian MQTT Payload Format

This is what the Guardian actually publishes to `fort/v1/things/{GSN}/telem`.

### Structure

The payload is a **nested JSON object**. The top-level key is the model index (a 0-based integer assigned by the firmware, not the SunSpec model number). Under it:

- `fixed` — object of scalar point name/value pairs
- `repeating` — object of 0-based index strings, each an object of point name/value pairs (only present if the model has repeating blocks)
- `id` — the SunSpec model number (integer)
- `version` — firmware version string

```json
{
  "N": {
    "fixed": {
      "PointName": value,
      ...
    },
    "repeating": {
      "0": { "PointName": value },
      "1": { "PointName": value },
      ...
    },
    "id": <model_number>,
    "version": "2.0"
  }
}
```

Each MQTT message contains **one model's data**. The firmware publishes a separate message per model per device (one for the battery, one for the gateway summary, etc.).

There is **no timestamp field** in the raw payload. The ingestion pipeline (Telegraf) adds the timestamp from message receipt time.

### Telegraf flattening

Telegraf receives this nested JSON and flattens it using `_` as the separator, producing the `{N}_{blockType}_{pointName}` field names seen in the ingestion pipeline. For example:

| Guardian sends                      | Telegraf field name   |
| ----------------------------------- | --------------------- |
| `"2" → "fixed" → "A"`               | `2_fixed_A`           |
| `"5" → "repeating" → "3" → "CellV"` | `5_repeating_3_CellV` |
| `"2" → "id"`                        | `2_id`                |
| `"2" → "version"`                   | `2_version`           |

### Real example: battery model (ss_8041)

From GSN `2307GRBF0292`, one eFlex battery — **as Guardian publishes it**:

```json
{
  "2": {
    "fixed": {
      "ID": 8041,
      "SN": "2410055F1856",
      "A": -4.1,
      "V": 53.2,
      "L": 78,
      "NMod": 1,
      "Idx": 1
    },
    "id": 8041,
    "version": "2.0"
  }
}
```

How this is interpreted after ingestion:

- `gsn` = `2307GRBF0292` (from the MQTT topic)
- `model` = `ss_8041` (from `fixed.ID: 8041` → prefixed with `ss_`)
- `psn` = `2410055F1856` (from `fixed.SN`)
- Stored fields: `A = -4.1`, `V = 53.2`, `version = "2.0"`
- Dropped fields: `L`, `NMod`, `Idx` (internal SunSpec metadata, not stored)

### Real example: battery module cell data (ss_805)

From GSN `2303GRBF0189`, repeating block with per-cell voltages — **as Guardian publishes it**:

```json
{
  "5": {
    "fixed": {
      "ID": 805,
      "SN": "2306054F0150",
      "StrSN": "2306054F0150",
      "StrIdx": 2,
      "ModIdx": 0,
      "NCell": 16,
      "CellVAvg": 3426,
      "CellVMax": 3443,
      "CellVMaxCell": 10,
      "CellVMin": 3408,
      "L": 118
    },
    "repeating": {
      "0": { "CellV": 3432 },
      "1": { "CellV": 3427 },
      "2": { "CellV": 3408 },
      "3": { "CellV": 3440 },
      "4": { "CellV": 3408 },
      "5": { "CellV": 3429 },
      "6": { "CellV": 3427 },
      "7": { "CellV": 3431 },
      "8": { "CellV": 3417 },
      "9": { "CellV": 3435 },
      "10": { "CellV": 3443 },
      "11": { "CellV": 3428 },
      "12": { "CellV": 3427 },
      "13": { "CellV": 3431 },
      "14": { "CellV": 3417 },
      "15": { "CellV": 3422 }
    },
    "id": 805,
    "version": "2.0"
  }
}
```

> **Note:** Model 805 (battery module cell-level data) is **filtered out** by the ingestion pipeline and never stored in InfluxDB. It's too granular for time-series storage.

### Repeating block field name transformation (after Telegraf flattening)

After Telegraf flattens the payload, `sink_influxdb` further renames repeating block fields from 0-based to 1-based zero-padded:

| Guardian sends                 | Telegraf field         | Stored in InfluxDB as |
| ------------------------------ | ---------------------- | --------------------- |
| `"repeating" → "0" → "CellV"`  | `5_repeating_0_CellV`  | `CellV__01`           |
| `"repeating" → "1" → "CellV"`  | `5_repeating_1_CellV`  | `CellV__02`           |
| `"repeating" → "15" → "CellV"` | `5_repeating_15_CellV` | `CellV__16`           |

### Fields always present

| Field      | Type    | Description                                               |
| ---------- | ------- | --------------------------------------------------------- |
| `fixed.ID` | integer | SunSpec model number. Used to derive the `ss_` model tag. |
| `fixed.SN` | string  | Product serial number. Stored as `psn` tag.               |
| `id`       | integer | Duplicate of model ID. Internal use, not stored.          |

### Fixed block fields dropped during ingestion

These SunSpec structural fields are not stored in InfluxDB:

| Field          | Meaning                                                 |
| -------------- | ------------------------------------------------------- |
| `fixed.L`      | Model length (number of registers)                      |
| `fixed.N`      | Number of repeating blocks                              |
| `fixed.NCell`  | Number of cells in module                               |
| `fixed.NMod`   | Number of modules                                       |
| `fixed.ModIdx` | Module index                                            |
| `fixed.Idx`    | Device index                                            |
| `fixed.ID`     | Model ID (used for tag, not stored as field)            |
| `fixed.SN`     | Serial number (used for tag, not stored as field)       |
| `fixed.StrSN`  | String SN (used for `part_of` tag, not stored as field) |
| `fixed.siteID` | Site ID (used for `site_id` tag, not stored as field)   |

### String preservation in Telegraf

Telegraf's `json_string_fields` config explicitly preserves these as strings (otherwise they'd be parsed as numbers):

```
"*_fixed_SN", "*_fixed_StrSN", "*_version"
```

Without this, serial numbers like `"2303GRBF0103"` would be mistyped as a float.

---

## MQTT Topics

```
# Telemetry data (cloud via AWS IoT Core, or local MQTT broker)
fort/v1/things/{GSN}/telem

# Device logs
fort/v1/things/{GSN}/log

# Discovery (local LAN only)
fort/v1/things/discovery

# AWS IoT lifecycle events (connected/disconnected)
$aws/events/presence/connected/{GSN}
$aws/events/presence/disconnected/{GSN}
```

---

## Telemetry Configuration (CGI API)

The Guardian's `Telemetry` CGI endpoint controls when and how telemetry is published.

### Get current config

```json
{
  "version": "1.0",
  "requestId": 5,
  "endPoint": "Telemetry",
  "method": "GetConfig"
}
```

Response `data`:

```json
{
  "lockout": 10,
  "heartbeat": {
    "delay": 14440,
    "qos": 1,
    "verbose": 1
  },
  "states": {
    "active": { "delay": 60, "qos": 0 },
    "idle": { "delay": 1800, "qos": 0 }
  }
}
```

| Field                 | Description                                                |
| --------------------- | ---------------------------------------------------------- |
| `lockout`             | Minimum seconds between sends (rate limiting)              |
| `heartbeat.delay`     | Seconds between heartbeat sends                            |
| `heartbeat.verbose`   | `1` = full payload, `0` = minimal                          |
| `states.active.delay` | Send interval (seconds) while actively producing/consuming |
| `states.idle.delay`   | Send interval (seconds) when idle                          |
| `qos`                 | MQTT QoS: `0` = at-most-once, `1` = at-least-once          |

### Set config

```json
{
  "version": "1.0",
  "requestId": 6,
  "endPoint": "Telemetry",
  "method": "Config",
  "data": {
    "lockout": 10,
    "heartbeat": { "delay": 3600, "qos": 1, "verbose": 1 },
    "states": {
      "active": { "delay": 60, "qos": 0 },
      "idle": { "delay": 900, "qos": 0 }
    }
  }
}
```

### Force immediate send

```json
{
  "version": "1.0",
  "requestId": 123,
  "endPoint": "Telemetry",
  "method": "Send"
}
```

### Enable/disable local MQTT

```json
{ "version": "1.0", "requestId": 4, "endPoint": "Telemetry", "method": "EnableLocalMqtt" }
{ "version": "1.0", "requestId": 3, "endPoint": "Telemetry", "method": "DisableLocalMqtt" }
```

---

## Data Model

Telemetry is organized into three levels:

```
Model → Block → Point
```

- **Model** — identifies the equipment type (`ss_8041` for batteries, `ss_40101` for inverters)
- **Block** — `fixed` (single values) or `repeating` (per-device arrays)
- **Point** — individual data field (`SoC`, `pPvTotal`, `vMppt1`)

### Key Models

| Model      | Device                    | Key Points                                                                       |
| ---------- | ------------------------- | -------------------------------------------------------------------------------- |
| `ss_802`   | eFlex batteries (classic) | `SoC`, `V`, `A`, `W`, `ChaSt`, `WHRtg`                                           |
| `ss_7011`  | Inverter AC output        | `Hz`, `LNV`, `LLV`                                                               |
| `ss_7999`  | Avalon inverter state     | `GridStatus`, `PVPowerPriority`                                                  |
| `ss_8041`  | eFlex batteries (V2)      | `SoC`, `V`, `A`, `ModTmpMax`, `ModTmpMin`                                        |
| `ss_30001` | Avalon Energy Panel       | `OperatingMode`, `CircuitType` (repeating)                                       |
| `ss_39997` | Guardian gateway totals   | `TotalPowerFromDCPV`, `TotalEnergyFromGrid`, `NtpLastSyncTs`, `version`          |
| `ss_40101` | Avalon inverter (V3)      | `pPvTotal`, `pLoad`, `pGridImpTot`, `pGridExpTot`, `pBatChg`, `socBat`, `vMppt1` |
| `ss_40102` | Energy metrics (V3)       | `ePvTdy`, `ePvTot`, `eGridImpTot`, `eGridExpTot`, `eLoadTot`                     |
| `ss_40104` | System config (V3)        | `OperatingMode`, `WorkMode`                                                      |
| `ss_42101` | Battery status (V3)       | `ChaSt`, `W`, `SoC`, `A`, `V`                                                    |

V3 models (`ss_40000`+) are the current standard for new equipment. Prefer them for new integrations.

### `ss_39997` power unit gotcha

`ss_39997` power points are in **kW**, not Watts. Everything else uses Watts. The `manager-avalon-translator` multiplies by 1000 when writing these to `ss_40101`.

---

## ra-telemetry gRPC API

Proto definition: `cmsandbox/components/ra-telemetry/src/public/proto/sunspec.proto`
Default address: `ra-telemetry:50051`

### Write API

#### WriteBatch (preferred)

```json
{
  "request_id": "batch-001",
  "partial_success": true,
  "points": [
    {
      "timestamp": "2024-01-15T10:30:00Z",
      "model": "ss_8041",
      "gsn": "2303GRBF0103",
      "psn": "2304054F0029",
      "fields": {
        "SoC": { "number_value": 85.5 },
        "V": { "number_value": 521.3 },
        "A": { "number_value": -142.0 }
      }
    }
  ]
}
```

Max 1000 points per call. `partial_success: true` continues on validation errors.

**FieldValue types:**

```json
{ "number_value": 85.5 }   // float/int
{ "string_value": "2.0" }  // string
{ "bool_value": true }     // boolean
```

### Read API

#### ReadLatestData

```json
{
  "base": {
    "request_id": "req-001",
    "model": "ss_8041",
    "gsn": "2303GRBF0103",
    "time_range": {
      "start_time": "2024-01-08T10:00:00Z",
      "end_time": "2024-01-15T10:00:00Z"
    }
  },
  "fields": ["SoC", "V", "A"]
}
```

Multiple GSNs: comma-separated in `gsn` field. Set `options.return_latest_per_gsn: true` to get one row per gateway.

#### ReadHistoricalData

```json
{
  "base": {
    "request_id": "req-002",
    "model": "ss_40101",
    "gsn": "2303GRBF0103",
    "time_range": {
      "start_time": "2024-01-14T00:00:00Z",
      "end_time": "2024-01-15T00:00:00Z"
    }
  },
  "fields": ["pPvTotal", "pLoad"],
  "max_point_num": 288,
  "aggregate_fn": "mean"
}
```

`max_point_num × fields.length` cannot exceed 10,000.

Aggregate functions: `mean`, `min`, `max`, `sum`, `count`, `first`, `last`, `median`, `state_change`, `first_last`, `cross_sum`, `cross_mean`.

---

## Service Endpoints

| Service              | Address                     | Protocol          |
| -------------------- | --------------------------- | ----------------- |
| ra-telemetry         | `ra-telemetry:50051`        | gRPC              |
| ra-telemetry health  | `ra-telemetry:8080/health`  | HTTP              |
| ra-telemetry metrics | `ra-telemetry:9090/metrics` | HTTP (Prometheus) |
| InfluxDB             | `influxdb:8086`             | HTTP              |
| Guardian (local)     | `{gateway-ip}:1883`         | MQTT              |
| AWS IoT Core         | TLS port 8883               | MQTT              |
