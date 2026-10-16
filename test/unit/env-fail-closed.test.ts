import { describe, expect, it } from "vitest";
import type { Bindings } from "../../src/env";
import { isProductionEnvironment, loadConfig } from "../../src/env";

describe("deployment environment defaults", () => {
  const base = { APP_NAME: "Community", APP_URL: "https://community.example" };

  it.each([undefined, "prod", "staging"])('treats ENVIRONMENT=%s as production-like', (environment) => {
    const env = { ...base, ENVIRONMENT: environment } as unknown as Bindings;
    expect(isProductionEnvironment(env)).toBe(true);
    expect(loadConfig(env).environment).toBe("production");
    expect(loadConfig(env).isProduction).toBe(true);
  });

  it.each(["development", "preview"] as const)("preserves explicit %s mode", (environment) => {
    const env = { ...base, ENVIRONMENT: environment } as Bindings;
    expect(isProductionEnvironment(env)).toBe(false);
    expect(loadConfig(env).environment).toBe(environment);
    expect(loadConfig(env).isProduction).toBe(false);
  });
});
