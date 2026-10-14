/**
 * index.html carries one inline script: the pre-paint theme/boot-frame setter.
 * It exists inline so it costs no render-blocking request, which only works
 * while its sha256 is whitelisted in both CSPs — the Worker's (src/middleware.ts)
 * and the static one Cloudflare Assets serves (public/_headers).
 *
 * Reformatting the script, even by a space, changes the hash and the browser
 * silently refuses to run it: dark mode flashes and the boot frame is wrong.
 * This test is the thing that catches that before a deploy does.
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const html = readFileSync(join(root, "index.html"), "utf8");

/** Inline <script> bodies, excluding JSON-LD and anything with a src. */
function inlineScripts(): string[] {
  return [...html.matchAll(/<script(?![^>]*\ssrc=)([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter((m) => !/type\s*=\s*"application\/ld\+json"/.test(m[1] ?? ""))
    .map((m) => m[2] ?? "");
}

const csps = [
  ["src/middleware.ts", readFileSync(join(root, "src/middleware.ts"), "utf8")],
  ["public/_headers", readFileSync(join(root, "public/_headers"), "utf8")],
] as const;

describe("inline scripts are whitelisted by the CSP", () => {
  it("index.html has exactly one inline script", () => {
    expect(inlineScripts()).toHaveLength(1);
  });

  it.each(csps)("%s whitelists its sha256", (_name, csp) => {
    for (const body of inlineScripts()) {
      const hash = `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`;
      expect(csp).toContain(hash);
    }
  });

  it("the boot script still sets the theme class and the boot frame", () => {
    const body = inlineScripts()[0] ?? "";
    expect(body).toContain("wh-theme");
    expect(body).toContain("data-boot");
    expect(body).toContain("prefers-color-scheme: dark");
  });

  it("no render-blocking script sits in front of the first paint", () => {
    const head = html.slice(0, html.indexOf("</head>"));
    const blocking = [...head.matchAll(/<script\b(?![^>]*\b(?:defer|async|type="module"|type="application\/ld\+json")\b)[^>]*\ssrc=/g)];
    expect(blocking).toEqual([]);
  });
});
