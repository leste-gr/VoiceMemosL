import sharp from 'sharp';
import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 1024×1024 SVG — red rounded background + white microphone
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <!-- Background -->
  <rect width="1024" height="1024" rx="224" ry="224" fill="#e53935"/>

  <!-- Mic capsule body -->
  <rect x="392" y="180" width="240" height="360" rx="120" ry="120" fill="white"/>

  <!-- Mic stand arc -->
  <path d="M 272 480
           A 240 240 0 0 0 752 480"
        fill="none" stroke="white" stroke-width="52" stroke-linecap="round"/>

  <!-- Mic stem -->
  <line x1="512" y1="700" x2="512" y2="820" stroke="white" stroke-width="52" stroke-linecap="round"/>

  <!-- Mic base -->
  <line x1="352" y1="820" x2="672" y2="820" stroke="white" stroke-width="52" stroke-linecap="round"/>
</svg>
`;

const outPath = path.join(__dirname, '..', 'assets', 'icon.png');
const splashPath = path.join(__dirname, '..', 'assets', 'splash.png');
const adaptivePath = path.join(__dirname, '..', 'assets', 'adaptive-icon.png');
const faviconPath = path.join(__dirname, '..', 'assets', 'favicon.png');

await sharp(Buffer.from(svg)).resize(1024, 1024).png().toFile(outPath);
console.log('icon.png written');

await sharp(Buffer.from(svg)).resize(1024, 1024).png().toFile(adaptivePath);
console.log('adaptive-icon.png written');

await sharp(Buffer.from(svg)).resize(2048, 2048).png().toFile(splashPath);
console.log('splash.png written');

await sharp(Buffer.from(svg)).resize(32, 32).png().toFile(faviconPath);
console.log('favicon.png written');
