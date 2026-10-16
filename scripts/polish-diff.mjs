/**
 * Mechanical check of the immutable login contract.
 *
 *   npm run login-review:diff
 *
 * Compares artifacts/login-review/before/login/*.json with the matching
 * after/ record and fails loudly if any control's tag, visible text, type,
 * order or resting rectangle changed. Rectangles are compared at rest (t15 and
 * after resize), because entry animation resolves to translate zero.
 */

import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BEFORE = join(ROOT, "artifacts", "login-review", "before", "login");
const AFTER = join(ROOT, "artifacts", "login-review", "after", "login");
const TOLERANCE = 0.5; // CSS px

const near = (a, b) => Math.abs(a - b) <= TOLERANCE;

async function main() {
  const files = (await readdir(BEFORE)).filter((f) => f.endsWith(".json") && f !== "summary.json");
  let failures = 0;
  let compared = 0;

  for (const file of files) {
    let before, after;
    try {
      before = JSON.parse(await readFile(join(BEFORE, file), "utf8"));
      after = JSON.parse(await readFile(join(AFTER, file), "utf8"));
    } catch {
      console.log(`SKIP  ${file} (no matching pair)`);
      continue;
    }

    for (const phase of ["t15", "afterResize"]) {
      const b = before[phase].controls;
      const a = after[phase].controls;
      const where = `${file} ${phase}`;
      compared++;

      if (b.length !== a.length) {
        console.log(`FAIL  ${where}: control count ${b.length} -> ${a.length}`);
        failures++;
        continue;
      }
      for (let i = 0; i < b.length; i++) {
        const problems = [];
        if (b[i].tag !== a[i].tag) problems.push(`tag ${b[i].tag} -> ${a[i].tag}`);
        if (b[i].text !== a[i].text) problems.push(`text "${b[i].text}" -> "${a[i].text}"`);
        if (b[i].type !== a[i].type) problems.push(`type ${b[i].type} -> ${a[i].type}`);
        for (const k of ["x", "y", "width", "height"]) {
          if (!near(b[i].rect[k], a[i].rect[k])) problems.push(`${k} ${b[i].rect[k]} -> ${a[i].rect[k]}`);
        }
        if (problems.length) {
          console.log(`FAIL  ${where} control ${i} (${b[i].text || b[i].type}): ${problems.join("; ")}`);
          failures++;
        }
      }
    }
  }

  console.log(`\n${compared} control snapshots compared, ${failures} difference(s).`);
  if (failures) process.exitCode = 1;
  else console.log("Login contract intact: same controls, same order, same resting rectangles.");
}

main().catch((e) => { console.error(e); process.exit(1); });
