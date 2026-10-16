import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const value = process.env.PRODUCTION_APP_URL?.trim();
if (!value) {
  throw new Error("Set PRODUCTION_APP_URL to the public HTTPS origin before building for production.");
}

let appUrl;
try {
  appUrl = new URL(value);
} catch {
  throw new Error("PRODUCTION_APP_URL must be a valid HTTPS origin.");
}

if (
  appUrl.protocol !== "https:" ||
  !appUrl.hostname ||
  appUrl.hostname === "localhost" ||
  appUrl.hostname.endsWith(".localhost") ||
  appUrl.username ||
  appUrl.password ||
  appUrl.pathname !== "/" ||
  appUrl.search ||
  appUrl.hash
) {
  throw new Error("PRODUCTION_APP_URL must be a public HTTPS origin without credentials, path, query, or fragment.");
}

const configPath = resolve("wrangler.jsonc");
let config = await readFile(configPath, "utf8");

function replaceVar(name, replacement) {
  const pattern = new RegExp(`("${name}"\\s*:\\s*)"[^"]*"`, "g");
  const matches = [...config.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${name} value in wrangler.jsonc.`);
  }
  config = config.replace(pattern, (_match, prefix) => `${prefix}${JSON.stringify(replacement)}`);
}

replaceVar("APP_URL", appUrl.origin);
replaceVar("ENVIRONMENT", "production");

const outputPath = resolve("wrangler.production.jsonc");
await writeFile(outputPath, config, "utf8");
console.log("Prepared ignored production Wrangler config with the supplied HTTPS origin.");
