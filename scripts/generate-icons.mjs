/**
 * PWA アイコン一次性生成スクリプト。
 *
 * public/favicon.svg（角丸ティール背景 + 白いペン先グリフ）を原寸デザインとして流用し、
 * PWA 用 PNG 群を生成して public/ に書き出す。favicon.svg を変更したあとは
 * `pnpm icons:generate` で再生成できる。
 *
 * - 通常アイコン（192 / 512）: favicon.svg の角丸背景をそのまま維持
 * - maskable（512）: 背景を塗りつぶし（角丸なし）に変更。グリフはすでに
 *   セーフゾーン（中央 80% 円）内に収まっているためそのまま流用
 * - apple-touch-icon（180）: iOS が自前で角丸マスクを適用するため、
 *   maskable と同じく全面塗りつぶし背景を使用
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const FAVICON_PATH = fileURLToPath(new URL("../public/favicon.svg", import.meta.url));
const OUTPUT_DIR = fileURLToPath(new URL("../public/", import.meta.url));

// favicon.svg の viewBox は 32x32。sharp の SVG ラスタライズは density に依存するため、
// 出力サイズに応じた density を指定してボケのないラスタライズを行う。
const VIEWBOX_SIZE = 32;

const faviconSvg = await readFile(FAVICON_PATH, "utf8");
// maskable / apple-touch-icon 用: 角丸（rx）を外して全面塗りつぶし背景にする。
const fullBleedSvg = faviconSvg.replace(/\s*rx="[\d.]+"/, "");

if (fullBleedSvg === faviconSvg) {
  throw new Error(
    "favicon.svg から rx 属性を除去できませんでした。構造が変わった場合は本スクリプトを見直してください。",
  );
}

/** SVG を指定サイズの PNG として public/ に書き出す。 */
async function render(svg, size, filename) {
  await sharp(Buffer.from(svg), { density: (72 * size) / VIEWBOX_SIZE })
    .resize(size, size)
    .png()
    .toFile(`${OUTPUT_DIR}${filename}`);
  console.log(`generated: public/${filename} (${size}x${size})`);
}

await render(faviconSvg, 192, "pwa-192x192.png");
await render(faviconSvg, 512, "pwa-512x512.png");
await render(fullBleedSvg, 512, "maskable-512x512.png");
await render(fullBleedSvg, 180, "apple-touch-icon-180x180.png");
