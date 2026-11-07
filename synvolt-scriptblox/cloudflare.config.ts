import { defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };
export default defineConfig({ worker: { name: "synvolt-scriptblox", compatibilityDate: "2026-11-06", entrypoint } });
