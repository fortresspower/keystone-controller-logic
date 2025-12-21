const x = {
  "version": "2",
  "device": {
    "vendor": "Delta",
    "model": "PCS125HV",
    "protocol": "modbus-tcp",
    "defaultByteOrder": "BE",
    "defaultWordOrder32": "ABCD"
  },

  // NOTE:
  // - telemetry[] = ONLY real modbus-readable tags (no CONST/DERIVED)
  // - ss40k.name uses the EXACT entry.name from ss40k_inverter.json
  // - pollClass supports: startup | fast | normal | slow | manual
  // - address is DECIMAL, 1-based

  "telemetry": [
    // ============================================================
    // PCS INFORMATION (ss40k)
    // ============================================================

    {
      "id": "PCS_SN",
      "description": "PCS serial number",
      "category": "PCSInfo",
      "function": "HRS8",
      "address": 1537,
      "scale": { "mode": "none" },
      "pollClass": "startup",
      "alarmFlag": false,
      "statusFlag": true,
      "bitfieldStatus": false,
      "supporting": false,
      "ss40k": { "name": "SN", "section": "PCS information" }
    },

    // OPTIONAL if available in Delta map (replace address/function)
    {
      "id": "PCS_HW_VER",
      "description": "Hardware version",
      "category": "PCSInfo",
      "function": "HRS10",
      "address": 1600,
      "scale": { "mode": "none" },
      "pollClass": "startup",
      "alarmFlag": false,
      "statusFlag": true,
      "bitfieldStatus": false,
      "supporting": false,
      "ss40k": { "name": "hwVer", "section": "PCS information" }
    },
    {
      "id": "PCS_VER_DSP_MASTER",
      "description": "DSP master firmware version",
      "category": "PCSInfo",
      "function": "HRS10",
      "address": 1610,
      "scale": { "mode": "none" },
      "pollClass": "startup",
      "alarmFlag": false,
      "statusFlag": true,
      "bitfieldStatus": false,
      "supporting": false,
      "ss40k": { "name": "verDspMaster", "section": "PCS information" }
    },
    {
      "id": "PCS_VER_PROTO",
      "description": "Protocol version",
      "category": "PCSInfo",
      "function": "HRS10",
      "address": 1620,
      "scale": { "mode": "none" },
      "pollClass": "startup",
      "alarmFlag": false,
      "statusFlag": true,
      "bitfieldStatus": false,
      "supporting": false,
      "ss40k": { "name": "verProto", "section": "PCS information" }
    },

    // NOTE: Mn, Md, pNom, sNom, vNom, fNom are best provided by binding/config,
    // not Modbus (unless Delta exposes them). We can add them later if registers exist.

    // ============================================================
    // INVERTER (ss40k) - POWER
    // ============================================================

    {
      "id": "PCS_W",
      "description": "Total active power",
      "category": "Inverter",
      "function": "HR",
      "address": 1816,
      "scale": { "mode": "factor", "factor": 1.0 },
      "pollClass": "fast",
      "alarmFlag": false,
      "statusFlag": true,
      "bitfieldStatus": false,
      "supporting": false,
      "ss40k": { "name": "W", "section": "Inverter" }
    },
    {
      "id": "PCS_VAR",
      "description": "Total reactive power",
      "category": "Inverter",
      "function": "HR",
      "address": 1817,
      "scale": { "mode": "factor", "factor": 1.0 },
      "pollClass": "fast",
      "alarmFlag": false,
      "statusFlag": true,
      "bitfieldStatus": false,
      "supporting": false,
      "ss40k": { "name": "Var", "section": "Inverter" }
    },
    {
      "id": "PCS_VA",
      "description": "Total apparent power",
      "category": "Inverter",
      "function": "HR",
      "address": 1818,
      "scale": { "mode": "factor", "factor": 1.0 },
      "pollClass": "fast",
      "alarmFlag": false,
      "statusFlag": true,
      "bitfieldStatus": false,
      "supporting": false,
      "ss40k": { "name": "VA", "section": "Inverter" }
    },

    // Per-phase power
    { "id": "PCS_WL1", "description": "Active power L1", "category": "Inverter", "function": "HR", "address": 1807,
      "scale": { "mode": "factor", "factor": 1.0 }, "pollClass": "fast", "alarmFlag": false, "statusFlag": true,
      "bitfieldStatus": false, "supporting": false, "ss40k": { "name": "WL1", "section": "Inverter" } },
    { "id": "PCS_WL2", "description": "Active power L2", "category": "Inverter", "function": "HR", "address": 1808,
      "scale": { "mode": "factor", "factor": 1.0 }, "pollClass": "fast", "alarmFlag": false, "statusFlag": true,
      "bitfieldStatus": false, "supporting": false, "ss40k": { "name": "WL2", "section": "Inverter" } },
    { "id": "PCS_WL3", "description": "Active power L3", "category": "Inverter", "function": "HR", "address": 1809,
      "scale": { "mode": "factor", "factor": 1.0 }, "pollClass": "fast", "alarmFlag": false, "statusFlag": true,
      "bitfieldStatus": false, "supporting": false, "ss40k": { "name": "WL3", "section": "Inverter" } },

    { "id": "PCS_VARL1", "description": "Reactive power L1", "category": "Inverter", "function": "HR", "address": 1810,
      "scale": { "mode": "factor", "factor": 1.0 }, "pollClass": "fast", "alarmFlag": false, "statusFlag": true,
      "bitfieldStatus": false, "supporting": false, "ss40k": { "name": "VarL1", "section": "Inverter" } },
    { "id": "PCS_VARL2", "description": "Reactive power L2", "category": "Inverter", "function": "HR", "address": 1811,
      "scale": { "mode": "factor", "factor": 1.0 }, "pollClass": "fast", "alarmFlag": false, "statusFlag": true,
      "bitfieldStatus": false, "supporting": false, "ss40k": { "name": "VarL2", "section": "Inverter" } },
    { "id": "PCS_VARL3", "description": "Reactive power L3", "category": "Inverter", "function": "HR", "address": 1812,
      "scale": { "mode": "factor", "factor": 1.0 }, "pollClass": "fast", "alarmFlag": false, "statusFlag": true,
      "bitfieldStatus": false, "supporting": false, "ss40k": { "name": "VarL3", "section": "Inverter" } },

    { "id": "PCS_VAL1", "description": "Apparent power L1", "category": "Inverter", "function": "HR", "address": 1813,
      "scale": { "mode": "factor", "factor": 1.0 }, "pollClass": "fast", "alarmFlag": false, "statusFlag": true,
      "bitfieldStatus": false, "supporting": false, "ss40k": { "name": "VAL1", "section": "Inverter" } },
    { "id": "PCS_VAL2", "description": "Apparent power L2", "category": "Inverter", "function": "HR", "address": 1814,
      "scale": { "mode": "factor", "factor": 1.0 }, "pollClass": "fast", "alarmFlag": false, "statusFlag": true,
      "bitfieldStatus": false, "supporting": false, "ss40k": { "name": "VAL2", "section": "Inverter" } },
    { "id": "PCS_VAL3", "description": "Apparent power L3", "category": "Inverter", "function": "HR", "address": 1815,
      "scale": { "mode": "factor", "factor": 1.0 }, "pollClass": "fast", "alarmFlag": false, "statusFlag": true,
      "bitfieldStatus": false, "supporting": false, "ss40k": { "name": "VAL3", "section": "Inverter" } },

    // ============================================================
    // INVERTER (ss40k) - VOLTAGE / CURRENT / FREQUENCY
    // ============================================================

    // Frequency
    {
      "id": "PCS_HZ",
      "description": "AC frequency",
      "category": "Inverter",
      "function": "HR",
      "address": 1791,
      "scale": { "mode": "factor", "factor": 1.0 },
      "pollClass": "fast",
      "alarmFlag": false,
      "statusFlag": true,
      "bitfieldStatus": false,
      "supporting": false,
      "ss40k": { "name": "Hz", "section": "Inverter" }
    },

    // Line-line voltages
    { "id": "PCS_VL1L2", "description": "Voltage L1-L2", "category": "Inverter", "function": "HR", "address": 1760,
      "scale": { "mode": "factor", "factor": 1.0 }, "pollClass": "fast", "alarmFlag": false, "statusFlag": true,
      "bitfieldStatus": false, "supporting": false, "ss40k": { "name": "VL1L2", "section": "Inverter" } },
    { "id": "PCS_VL2L3", "description": "Voltage L2-L3", "category": "Inverter", "function": "HR", "address": 1761,
      "scale": { "mode": "factor", "factor": 1.0 }, "pollClass": "fast", "alarmFlag": false, "statusFlag": true,
      "bitfieldStatus": false, "supporting": false, "ss40k": { "name": "VL2L3", "section": "Inverter" } },
    { "id": "PCS_VL3L1", "description": "Voltage L3-L1", "category": "Inverter", "function": "HR", "address": 1762,
      "scale": { "mode": "factor", "factor": 1.0 }, "pollClass": "fast", "alarmFlag": false, "statusFlag": true,
      "bitfieldStatus": false, "supporting": false, "ss40k": { "name": "VL3L1", "section": "Inverter" } },

    // Line-neutral voltages
    { "id": "PCS_VL1", "description": "Voltage L1-N", "category": "Inverter", "function": "HR", "address": 1763,
      "scale": { "mode": "factor", "factor": 1.0 }, "pollClass": "fast", "alarmFlag": false, "statusFlag": true,
      "bitfieldStatus": false, "supporting": false, "ss40k": { "name": "VL1", "section": "Inverter" } },
    { "id": "PCS_VL2", "description": "Voltage L2-N", "category": "Inverter", "function": "HR", "address": 1764,
      "scale": { "mode": "factor", "factor": 1.0 }, "pollClass": "fast", "alarmFlag": false, "statusFlag": true,
      "bitfieldStatus": false, "supporting": false, "ss40k": { "name": "VL2", "section": "Inverter" } },
    { "id": "PCS_VL3", "description": "Voltage L3-N", "category": "Inverter", "function": "HR", "address": 1765,
      "scale": { "mode": "factor", "factor": 1.0 }, "pollClass": "fast", "alarmFlag": false, "statusFlag": true,
      "bitfieldStatus": false, "supporting": false, "ss40k": { "name": "VL3", "section": "Inverter" } },

    // Currents
    { "id": "PCS_AL1", "description": "Current L1", "category": "Inverter", "function": "HR", "address": 1770,
      "scale": { "mode": "factor", "factor": 1.0 }, "pollClass": "fast", "alarmFlag": false, "statusFlag": true,
      "bitfieldStatus": false, "supporting": false, "ss40k": { "name": "AL1", "section": "Inverter" } },
    { "id": "PCS_AL2", "description": "Current L2", "category": "Inverter", "function": "HR", "address": 1771,
      "scale": { "mode": "factor", "factor": 1.0 }, "pollClass": "fast", "alarmFlag": false, "statusFlag": true,
      "bitfieldStatus": false, "supporting": false, "ss40k": { "name": "AL2", "section": "Inverter" } },
    { "id": "PCS_AL3", "description": "Current L3", "category": "Inverter", "function": "HR", "address": 1772,
      "scale": { "mode": "factor", "factor": 1.0 }, "pollClass": "fast", "alarmFlag": false, "statusFlag": true,
      "bitfieldStatus": false, "supporting": false, "ss40k": { "name": "AL3", "section": "Inverter" } },

    // Power factor per-phase + total (if available as real tags; if not, compute in binding)
    { "id": "PCS_PF_TOTAL", "description": "Power factor total", "category": "Inverter", "function": "HR", "address": 1825,
      "scale": { "mode": "factor", "factor": 0.001 }, "pollClass": "fast", "alarmFlag": false, "statusFlag": true,
      "bitfieldStatus": false, "supporting": false, "ss40k": { "name": "PF", "section": "Inverter" } },
    { "id": "PCS_PFL1", "description": "Power factor L1", "category": "Inverter", "function": "HR", "address": 1826,
      "scale": { "mode": "factor", "factor": 0.001 }, "pollClass": "fast", "alarmFlag": false, "statusFlag": true,
      "bitfieldStatus": false, "supporting": false, "ss40k": { "name": "PFL1", "section": "Inverter" } },
    { "id": "PCS_PFL2", "description": "Power factor L2", "category": "Inverter", "function": "HR", "address": 1827,
      "scale": { "mode": "factor", "factor": 0.001 }, "pollClass": "fast", "alarmFlag": false, "statusFlag": true,
      "bitfieldStatus": false, "supporting": false, "ss40k": { "name": "PFL2", "section": "Inverter" } },
    { "id": "PCS_PFL3", "description": "Power factor L3", "category": "Inverter", "function": "HR", "address": 1828,
      "scale": { "mode": "factor", "factor": 0.001 }, "pollClass": "fast", "alarmFlag": false, "statusFlag": true,
      "bitfieldStatus": false, "supporting": false, "ss40k": { "name": "PFL3", "section": "Inverter" } },

    // Temps
    { "id": "PCS_TEMP_AMB", "description": "Ambient temperature", "category": "Inverter", "function": "HR", "address": 1822,
      "scale": { "mode": "factor", "factor": 0.1 }, "pollClass": "normal", "alarmFlag": false, "statusFlag": true,
      "bitfieldStatus": false, "supporting": false, "ss40k": { "name": "tempAmb", "section": "Inverter" } },
    { "id": "PCS_TEMP_INT", "description": "Internal temperature", "category": "Inverter", "function": "HR", "address": 1823,
      "scale": { "mode": "factor", "factor": 0.1 }, "pollClass": "normal", "alarmFlag": false, "statusFlag": true,
      "bitfieldStatus": false, "supporting": false, "ss40k": { "name": "tempInt", "section": "Inverter" } },
    { "id": "PCS_TEMP_LLC", "description": "LLC temperature", "category": "Inverter", "function": "HR", "address": 1824,
      "scale": { "mode": "factor", "factor": 0.1 }, "pollClass": "normal", "alarmFlag": false, "statusFlag": true,
      "bitfieldStatus": false, "supporting": false, "ss40k": { "name": "tempLLC", "section": "Inverter" } },
    { "id": "PCS_TEMP_INV_STAGE", "description": "Inverter stage temperature", "category": "Inverter", "function": "HR", "address": 1830,
      "scale": { "mode": "factor", "factor": 0.1 }, "pollClass": "normal", "alarmFlag": false, "statusFlag": true,
      "bitfieldStatus": false, "supporting": false, "ss40k": { "name": "tempInv", "section": "Inverter" } },

    // Energies (today/total) — placeholders
    { "id": "PCS_E_INV_TDY", "description": "Inverter energy today", "category": "Inverter", "function": "HRUI_64", "address": 1900,
      "scale": { "mode": "factor", "factor": 1.0 }, "pollClass": "slow", "alarmFlag": false, "statusFlag": true,
      "bitfieldStatus": false, "supporting": false, "ss40k": { "name": "eInvTdy", "section": "Inverter" } },
    { "id": "PCS_E_INV_TOT", "description": "Inverter energy total", "category": "Inverter", "function": "HRUI_64", "address": 1904,
      "scale": { "mode": "factor", "factor": 1.0 }, "pollClass": "slow", "alarmFlag": false, "statusFlag": true,
      "bitfieldStatus": false, "supporting": false, "ss40k": { "name": "eInvTot", "section": "Inverter" } },
    { "id": "PCS_E_REC_TDY", "description": "Rectifier energy today", "category": "Inverter", "function": "HRUI_64", "address": 1910,
      "scale": { "mode": "factor", "factor": 1.0 }, "pollClass": "slow", "alarmFlag": false, "statusFlag": true,
      "bitfieldStatus": false, "supporting": false, "ss40k": { "name": "eRecTdy", "section": "Inverter" } },
    { "id": "PCS_E_REC_TOT", "description": "Rectifier energy total", "category": "Inverter", "function": "HRUI_64", "address": 1914,
      "scale": { "mode": "factor", "factor": 1.0 }, "pollClass": "slow", "alarmFlag": false, "statusFlag": true,
      "bitfieldStatus": false, "supporting": false, "ss40k": { "name": "eRecTot", "section": "Inverter" } },

    // ============================================================
    // CONTROL LOGIC ESSENTIALS (no ss40k)
    // ============================================================

    {
      "id": "PCS_STATE_GLOBAL",
      "description": "Global PCS state",
      "category": "GlobalState",
      "function": "HR",
      "address": 1780,
      "scale": { "mode": "none" },
      "pollClass": "fast",
      "alarmFlag": false,
      "statusFlag": true,
      "bitfieldStatus": false,
      "supporting": false
    },
    {
      "id": "PCS_STATE_SWITCH",
      "description": "Switch / contactor state bitfield",
      "category": "GlobalState",
      "function": "HR",
      "address": 1783,
      "scale": { "mode": "none" },
      "pollClass": "fast",
      "alarmFlag": false,
      "statusFlag": true,
      "bitfieldStatus": true,
      "supporting": false
    },

    // Raw faults/warnings for 40103 translation later
    { "id": "PCS_FAULT_SYS_0", "description": "Fault bitfield 0", "category": "FaultRaw", "function": "HR", "address": 2000,
      "scale": { "mode": "none" }, "pollClass": "fast", "alarmFlag": true, "statusFlag": true, "bitfieldStatus": true, "supporting": false },
    { "id": "PCS_FAULT_SYS_1", "description": "Fault bitfield 1", "category": "FaultRaw", "function": "HR", "address": 2001,
      "scale": { "mode": "none" }, "pollClass": "fast", "alarmFlag": true, "statusFlag": true, "bitfieldStatus": true, "supporting": false },
    { "id": "PCS_WARN_SYS_0", "description": "Warning bitfield 0", "category": "WarnRaw", "function": "HR", "address": 2010,
      "scale": { "mode": "none" }, "pollClass": "fast", "alarmFlag": false, "statusFlag": true, "bitfieldStatus": true, "supporting": false }
  ],

  "commands": [
    // NOTE: command list is for writer usage; still uses the same function/address conventions.
    // We can add behavior/confirm later once we decide your control framework needs it.

    {
      "id": "CMD_PCS_RUN_STOP",
      "description": "Start/Stop PCS",
      "category": "RunControl",
      "function": "HR",
      "address": 1280,
      "dataType": "uint16",
      "enum": { "0": "Stop", "1": "Start" }
    },
    {
      "id": "CMD_PCS_OP_MODE",
      "description": "Operation mode select",
      "category": "RunControl",
      "function": "HR",
      "address": 1281,
      "dataType": "uint16",
      "enum": { "2": "GT", "6": "SA", "10": "SA2GC" }
    },
    {
      "id": "CMD_PCS_FAULT_RESET",
      "description": "Fault reset",
      "category": "RunControl",
      "function": "HR",
      "address": 1290,
      "dataType": "uint16",
      "enum": { "1": "Reset" }
    },

    {
      "id": "CMD_PCS_P_LIMIT_PCT",
      "description": "Active power limit (0.1%)",
      "category": "PowerControl",
      "function": "HRUS",
      "address": 1300,
      "dataType": "uint16",
      "min": 0,
      "max": 1000
    },
    {
      "id": "CMD_PCS_Q_MODE",
      "description": "Reactive power control mode",
      "category": "PowerControl",
      "function": "HR",
      "address": 1301,
      "dataType": "uint16",
      "enum": { "0": "FixedPF", "1": "FixedQ", "2": "VoltVAR", "3": "VoltWatt" }
    },
    {
      "id": "CMD_PCS_PF_SET",
      "description": "PF setpoint (x1000)",
      "category": "PowerControl",
      "function": "HRI",
      "address": 1302,
      "dataType": "int16",
      "min": -1000,
      "max": 1000
    }
  ]
}
