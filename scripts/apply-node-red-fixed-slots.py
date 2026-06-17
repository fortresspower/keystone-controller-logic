#!/usr/bin/env python3
import json
import sys
from pathlib import Path


UNUSED = ("unused", "127.0.0.1", 502, 1)


def as_int(value, fallback):
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def product_default_ip(profile, equipment_id):
    if str(profile or "").startswith("MINI-"):
        if equipment_id == "AMPACE":
            return "192.168.1.100"
        if equipment_id in {"PCS", "Load", "PVDC1", "PVDC2", "PVDC3"}:
            return "192.168.1.10"
    if profile == "eSpire280":
        if equipment_id == "PCS":
            return "192.168.1.136"
        if equipment_id == "MBMU":
            return "192.168.1.50"
    return ""


def patch_node(node, name, ip, port, unit_id):
    node["name"] = name
    node["tcpHost"] = ip
    node["tcpPort"] = str(port)
    node["unit_id"] = str(unit_id)


def target_tuple(profile, target):
    equipment_id = str(target.get("equipmentId") or target.get("route") or "unused")
    ip = str(target.get("ip") or product_default_ip(profile, equipment_id) or UNUSED[1])
    port = as_int(target.get("port"), 502)
    unit_id = as_int(target.get("unitId", target.get("unit_id")), 1)
    return equipment_id, ip, port, unit_id


def slot_plan(profile, telemetry_readers, writer_targets):
    telemetry = unique_endpoint_slots(profile, telemetry_readers)
    writers = unique_endpoint_slots(profile, writer_targets)
    while len(telemetry) < 6:
        telemetry.append(UNUSED)
    while len(writers) < 6:
        writers.append(UNUSED)
    return telemetry, writers


def unique_endpoint_slots(profile, targets):
    slots = []
    seen = set()
    for item in targets:
        equipment_id, ip, port, unit_id = target_tuple(profile, item)
        key = (ip, port, unit_id)
        if key in seen:
            continue
        seen.add(key)
        slots.append((equipment_id, ip, port, unit_id))
        if len(slots) >= 6:
            break
    return slots


def main():
    if len(sys.argv) != 3:
        print(
            "usage: apply-node-red-fixed-slots.py /path/to/flows.json /path/to/control-status.json",
            file=sys.stderr,
        )
        return 2

    flows_path = Path(sys.argv[1])
    status_path = Path(sys.argv[2])
    flows = json.loads(flows_path.read_text())
    status_raw = json.loads(status_path.read_text())
    status = status_raw.get("data") or status_raw.get("status") or status_raw
    profile = status.get("systemProfile") or ""
    telemetry, writers = slot_plan(
        profile,
        status.get("telemetryReaderConfig") or [],
        status.get("writerTargets") or [],
    )

    patched = []
    for node in flows:
        node_id = node.get("id", "")
        if node_id.startswith("platform_tslot") and node_id.endswith("_client"):
            index = int(node_id.split("platform_tslot", 1)[1].split("_client", 1)[0]) - 1
            equipment_id, ip, port, unit_id = telemetry[index]
            patch_node(node, f"telemetry_slot_{index + 1}_{equipment_id}", ip, port, unit_id)
            patched.append((node_id, node["name"], ip, port, unit_id))
        elif node_id.startswith("platform_wslot") and node_id.endswith("_client"):
            index = int(node_id.split("platform_wslot", 1)[1].split("_client", 1)[0]) - 1
            equipment_id, ip, port, unit_id = writers[index]
            patch_node(node, f"writer_slot_{index + 1}_{equipment_id}", ip, port, unit_id)
            patched.append((node_id, node["name"], ip, port, unit_id))

    flows_path.write_text(json.dumps(flows, indent=2) + "\n")
    print(json.dumps({"systemProfile": profile, "patched": patched}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
