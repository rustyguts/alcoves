// Generates public/og-image.png (1200×630) from the brand logo + an SVG card.
// Run once with `bun scripts/generate-og.mjs` (or node). The output is a static
// asset committed to the repo — the CI build does not regenerate it.
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const W = 1200;
const H = 630;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="0.2">
      <stop offset="0" stop-color="#ff7a45"/>
      <stop offset="0.5" stop-color="#f43f6b"/>
      <stop offset="1" stop-color="#5b4be6"/>
    </linearGradient>
    <filter id="blur" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="80"/>
    </filter>
  </defs>

  <rect width="${W}" height="${H}" fill="#08080a"/>
  <g filter="url(#blur)">
    <ellipse cx="1000" cy="70" rx="300" ry="200" fill="#5b4be6" opacity="0.55"/>
    <ellipse cx="1180" cy="430" rx="260" ry="220" fill="#f43f6b" opacity="0.4"/>
    <ellipse cx="120" cy="600" rx="260" ry="180" fill="#10b981" opacity="0.2"/>
  </g>

  <!-- subtle grid -->
  <g opacity="0.05" stroke="#ffffff">
    ${Array.from({ length: 21 }, (_, i) => `<line x1="${i * 60}" y1="0" x2="${i * 60}" y2="${H}"/>`).join('')}
    ${Array.from({ length: 11 }, (_, i) => `<line x1="0" y1="${i * 60}" x2="${W}" y2="${i * 60}"/>`).join('')}
  </g>

  <text x="252" y="158" font-family="Georgia, 'Times New Roman', serif" font-size="58" font-weight="700" fill="#ededf0">Alcoves</text>

  <text x="90" y="372" font-family="Georgia, 'Times New Roman', serif" font-size="76" font-weight="600" fill="#ededf0">Your media, understood —</text>
  <text x="90" y="462" font-family="Georgia, 'Times New Roman', serif" font-size="76" font-weight="600" fill="#ededf0">and entirely <tspan fill="url(#brand)" font-style="italic">yours.</tspan></text>

  <text x="90" y="556" font-family="Menlo, 'Courier New', monospace" font-size="24" fill="#a1a1aa" letter-spacing="1">Self-hosted · Privacy-first · CPU-only local AI</text>
  <text x="1110" y="556" text-anchor="end" font-family="Menlo, 'Courier New', monospace" font-size="24" fill="#34d399">alcoves.io</text>
</svg>`;

const bg = await sharp(Buffer.from(svg)).png().toBuffer();
const logo = await sharp(resolve(root, 'src/assets/logo.webp'))
	.resize(150, 150, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
	.png()
	.toBuffer();

await sharp(bg)
	.composite([{ input: logo, top: 35, left: 80 }])
	.png()
	.toFile(resolve(root, 'public/og-image.png'));

console.log('Wrote public/og-image.png');
