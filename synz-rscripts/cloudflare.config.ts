import { defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
	worker: {
		name: "synz-rscripts",
		compatibilityDate: "2026-11-04",
		entrypoint,
	},
});

