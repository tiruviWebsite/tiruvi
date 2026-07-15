import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const assetsDir = new URL("../assets/", import.meta.url);
const outputFile = new URL("../assets/product-images.json", import.meta.url);
const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);

const entries = await readdir(assetsDir, { withFileTypes: true });
const manifest = {};

for (const entry of entries) {
  if (!entry.isDirectory()) {
    continue;
  }

  const folderUrl = new URL(`${entry.name}/`, assetsDir);
  const files = await readdir(folderUrl, { withFileTypes: true });
  const images = files
    .filter((file) => file.isFile())
    .map((file) => file.name)
    .filter((fileName) => imageExtensions.has(path.extname(fileName).toLowerCase()))
    .sort((first, second) => first.localeCompare(second, undefined, { numeric: true }))
    .map((fileName) => `assets/${entry.name}/${fileName}`);

  if (images.length) {
    manifest[entry.name] = images;
  }
}

await writeFile(outputFile, `${JSON.stringify(manifest, null, 2)}\n`);
