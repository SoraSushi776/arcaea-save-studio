import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "node_modules");
const DEST = path.join(ROOT, "public", "vendor");

const PACKAGES = [
  ["@material/web", "material"],
  ["lit", "lit"],
  ["lit-html", "lit-html"],
  ["lit-element", "lit-element"],
  ["@lit/reactive-element", "@lit/reactive-element"],
  ["@lit-labs/ssr-dom-shim", "@lit-labs/ssr-dom-shim"],
  ["tslib", "tslib"],
];

for (const [from, to] of PACKAGES) {
  const src = path.join(SOURCE, from);
  const dest = path.join(DEST, to);
  if (!fs.existsSync(src)) {
    console.warn(`[sync-vendor] 缺少依赖：${from}，先跑 npm install`);
    continue;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log(`[sync-vendor] ${from} -> public/vendor/${to}`);
}
