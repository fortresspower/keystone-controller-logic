export const VERSION = "1.2.0";

export * as broker from "./broker/broker";
export * as reader from "./reader/reader";
export * as compiler from "./compiler/compiler";
export * as writer from './writer/writer';
export * from "./types";
export * as bitTools from "./utils/bitTools";

// NEW:
export * as telemetry from "./telemetry";          // or "./telemetry/index"
export * as capabilities from "./capabilities";
export * as config from "./config"; 

// optional but useful