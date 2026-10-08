import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "www");
const files = [
  "index.html",
  "styles.css",
  "firebase-client.js",
  "manifest.webmanifest",
  "pwa.js",
  "service-worker.js",
  "privacy.html",
  "terms.html",
  "icons",
  "js",
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all(files.map(file => cp(resolve(root, file), resolve(output, file), { recursive: true })));

console.log("Android web bundle prepared in www/");
