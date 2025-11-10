import type { BrokerEnv } from "../types";
export type BrokerOut = [any | null, any | null];

function isReply(m: any) {
  if (m?.err) return true;
  if (Array.isArray(m?.payload)) return true;
  if (Array.isArray((m?.payload || {}).data)) return true;
  if (Array.isArray((m?.payload || {}).register)) return true;
  if (Array.isArray((m?.responseBuffer || {}).data)) return true;
  if (m?.payload === undefined && m?.responseBuffer === undefined) return true;
  return false;
}

export function routeWithTimeout(
  msg: any,
  env: BrokerEnv,
  timers: Map<string, NodeJS.Timeout>
): BrokerOut {
  const TO = Number(env.REQUEST_TIMEOUT_MS ?? 3000);

  if (!isReply(msg)) {
    const id = Math.random().toString(16).slice(2) + Date.now().toString(16);
    const out = { ...msg, _broker: { id, sentAt: Date.now() } };
    const t = setTimeout(() => {
      // timeout logic handled by Node-RED glue
    }, TO);
    timers.set(id, t);
    return [out, null];
  }

  const id = msg?._broker?.id;
  if (id && timers.has(id)) {
    clearTimeout(timers.get(id)!);
    timers.delete(id);
  }
  return [null, msg];
}
