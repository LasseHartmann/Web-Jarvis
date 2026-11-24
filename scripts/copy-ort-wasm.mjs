import fs from "node:fs";
import path from "node:path";

const srcDir = path.join(process.cwd(), "node_modules", "onnxruntime-web", "dist");
const destDir = path.join(process.cwd(), "public", "ort");

fs.mkdirSync(destDir, { recursive: true });

const files = ["ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs"];
for (const file of files) {
  const from = path.join(srcDir, file);
  const to = path.join(destDir, file);
  if (fs.existsSync(from)) {
    fs.copyFileSync(from, to);
  }
}
