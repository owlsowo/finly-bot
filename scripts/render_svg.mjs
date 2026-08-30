import { readFile, writeFile } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";

const [inputPath, outputPath, widthArgument] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error("Usage: node scripts/render_svg.mjs <input.svg> <output.png> [width]");
}

const outputWidth = widthArgument === undefined ? 1920 : Number(widthArgument);
if (!Number.isInteger(outputWidth) || outputWidth <= 0 || outputWidth > 8192) {
  throw new Error("width must be an integer between 1 and 8192 pixels");
}

const svg = await readFile(inputPath, "utf8");
const renderer = new Resvg(svg, {
  fitTo: { mode: "width", value: outputWidth },
  font: {
    loadSystemFonts: true,
    defaultFontFamily: "Helvetica Neue",
  },
});

await writeFile(outputPath, renderer.render().asPng());
