// One-shot generator for the static Open Graph / Twitter social card.
//
// Rasterizes scripts/og-card.svg to public/og.png with sharp. Run manually and
// commit the PNG — the build itself pulls no remote assets (ADR-0007):
//
//   bun run scripts/gen-og.ts
//
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const svgPath = fileURLToPath(new URL('./og-card.svg', import.meta.url));
const outPath = fileURLToPath(new URL('../public/og.png', import.meta.url));

const svg = await Bun.file(svgPath).bytes();
await sharp(svg, { density: 144 })
	.resize(1200, 630)
	.png()
	.toFile(outPath);

console.log(`wrote ${outPath}`);
