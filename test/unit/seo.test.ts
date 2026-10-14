/** Public metadata must stay usable on operator-owned Community installations. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

function prerenderedRoutes(): string[] {
  const src = read("scripts/prerender.mjs");
  return [...src.match(/const ROUTES = \[([^\]]*)\]/)![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

describe("Community page delivery", () => {
  it("prerenders the current public routes only", () => {
    expect(prerenderedRoutes()).toEqual([
      "/", "/security", "/methodology", "/contact", "/legal/privacy", "/legal/terms",
    ]);
  });

  it("keeps the robots file deployment-neutral", () => {
    const robots = read("public/robots.txt");
    expect(robots).toContain("Disallow: /api/");
    expect(robots).not.toMatch(/Sitemap:\s*https?:\/\//i);
    expect(robots).not.toContain("zenith.me.uk");
  });
});

describe("Community brand metadata", () => {
  const html = read("index.html");

  it("describes the self-hosted Community edition", () => {
    expect(html).toContain("<title>Zenith Community — self-hosted website monitoring</title>");
    expect(html).toContain('<meta property="og:site_name" content="Zenith" />');
    expect(html).toContain('<meta name="application-name" content="Zenith" />');
    expect(html).not.toContain("zenith.me.uk");
    expect(html).not.toContain("zenith-verification");
  });

  it("does not load the commercial analytics bootstrap", () => {
    expect(html).not.toContain("ga-init.js");
    expect(html).not.toContain("googletagmanager.com");
  });
});
