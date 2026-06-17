import type { ProtectionState } from ".";

export interface NormalizedProtectionTelemetry {
  protectionState: ProtectionState;
  pcsRunAllowed?: boolean;
  remoteInterlockClosed?: boolean;
  outageDetected: boolean;
  raw: Record<string, number>;
}

export interface SelHoldingRegisterProtectionInput {
  row46: number;
  row48: number;
  row33: number;
}

export interface Sel751ProtectionInput {
  row21: number;
}

export function normalizeSelHoldingRegisterProtection(
  input: SelHoldingRegisterProtectionInput
): NormalizedProtectionTelemetry {
  const selOutage = bit(input.row46, 7);
  const selRemoteInterlock = bit(input.row48, 7);
  const selKtranCommand = bit(input.row48, 6);
  const selKgridStatus = bit(input.row33, 0);
  const selKtranStatus = bit(input.row33, 1);

  return {
    protectionState: selOutage ? "islanded" : "normal",
    pcsRunAllowed: true,
    remoteInterlockClosed: selRemoteInterlock === 1,
    outageDetected: selOutage === 1,
    raw: {
      sel_outage: selOutage,
      sel_remote_interlock: selRemoteInterlock,
      sel_ktran_command: selKtranCommand,
      sel_kgrid_status: selKgridStatus,
      sel_ktran_status: selKtranStatus,
    },
  };
}

export function normalizeSel751Protection(
  input: Sel751ProtectionInput
): NormalizedProtectionTelemetry {
  const outage = bit(input.row21, 7);

  return {
    protectionState: outage ? "islanded" : "normal",
    pcsRunAllowed: true,
    outageDetected: outage === 1,
    raw: {
      sel_outage: outage,
    },
  };
}

function bit(value: number, position: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return (numeric >> position) & 0x01;
}
