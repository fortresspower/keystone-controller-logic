import { loadSiteConfig } from "../src/config/loader";
import { buildReadPlansFromConfig } from "../src/runtime/buildReadPlansFromConfig";
import type { CompilerEnv } from "../src/types";

async function main() {
  const cfg = loadSiteConfig(); // uses KEYSTONE_SITE_CONFIG or ./config.json

  const env: CompilerEnv = {
    CompilerMaxQty: 120,
    CompilerMaxSpan: 80,
    CompilerMaxHole: 4,
    PollFastMs: 250,
    PollNormalMs: 1000,
    PollSlowMs: 5000,
  };

  const plans = buildReadPlansFromConfig(cfg, env);

  console.log("=== Meter read plan ===");
  console.dir(plans.meter, { depth: null });

  console.log("=== PV inverters read plans ===");
  console.dir(plans.pvInverters, { depth: null });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
