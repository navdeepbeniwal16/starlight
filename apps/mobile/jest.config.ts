import type { Config } from "jest";

// Plain-TS unit tests under node (no React Native preset) — RN-free modules only.
const config: Config = {
  testEnvironment: "node",
  roots: ["<rootDir>/lib"],
  testMatch: ["**/*.test.ts"],
  moduleFileExtensions: ["ts", "tsx", "js", "json"],
  transform: {
    "^.+\\.tsx?$": ["@swc/jest", {}],
  },
};

export default config;
