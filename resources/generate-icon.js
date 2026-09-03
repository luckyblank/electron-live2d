// Generate the Live2D Pet application icon for the tray/window.
// Design: recognizable Q-version cat face, with the app's indigo-purple UI palette.
// Outputs icon.png (256×256) and icon@2x.png (512×512).

const sharp = require('sharp')
const path = require('path')
const fs = require('fs')

const SIZE = 512 // render at 2x for crispness

// ── SVG template ─────────────────────────────────────
// Cute anime-style Q-version face with cat ears
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 512 512">
  <defs>
    <!-- Soft shadow filter -->
    <filter id="shadow" x="-10%" y="-10%" width="130%" height="130%">
      <feDropShadow dx="0" dy="3" stdDeviation="6" flood-color="#6d5ac7" flood-opacity="0.28"/>
    </filter>
    <!-- Eye shine gradient -->
    <radialGradient id="eyeShine" cx="35%" cy="30%">
      <stop offset="0%" stop-color="white" stop-opacity="1"/>
      <stop offset="100%" stop-color="white" stop-opacity="0"/>
    </radialGradient>
    <!-- Cheek blush gradient -->
    <radialGradient id="blush">
      <stop offset="0%" stop-color="#FFA5A5" stop-opacity="0.7"/>
      <stop offset="100%" stop-color="#FFA5A5" stop-opacity="0"/>
    </radialGradient>
    <!-- Head gradient -->
    <radialGradient id="headGrad" cx="45%" cy="35%">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="100%" stop-color="#F1EBFF"/>
    </radialGradient>
    <!-- Subtle halo ties the icon to the control panel accent. -->
    <radialGradient id="haloGrad" cx="50%" cy="42%">
      <stop offset="0%" stop-color="#A99BF5" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#667EEA" stop-opacity="0"/>
    </radialGradient>
    <!-- Indigo-to-violet accent used by the app panel. -->
    <linearGradient id="bowGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#667EEA"/>
      <stop offset="100%" stop-color="#8B5CF6"/>
    </linearGradient>
  </defs>

  <!-- Transparent canvas with a soft system-color halo. -->
  <circle cx="256" cy="270" r="225" fill="url(#haloGrad)"/>
  <!-- Main face -->
  <circle cx="256" cy="280" r="210" fill="url(#headGrad)" filter="url(#shadow)" stroke="#C9B8EE" stroke-width="3"/>

  <!-- ── Cat ears ─────────────────────────── -->
  <!-- Left ear -->
  <polygon points="85,140 160,60 185,160" fill="url(#headGrad)" stroke="#C9B8EE" stroke-width="3" filter="url(#shadow)"/>
  <!-- Left ear inner -->
  <polygon points="110,135 150,85 168,150" fill="#F6B8D5" opacity="0.68"/>
  <!-- Right ear -->
  <polygon points="427,140 352,60 327,160" fill="url(#headGrad)" stroke="#C9B8EE" stroke-width="3" filter="url(#shadow)"/>
  <!-- Right ear inner -->
  <polygon points="402,135 362,85 344,150" fill="#F6B8D5" opacity="0.68"/>

  <!-- ── Hair tufts ───────────────────────── -->
  <ellipse cx="170" cy="130" rx="55" ry="18" fill="#DCCBFF" transform="rotate(-15,170,130)"/>
  <ellipse cx="342" cy="130" rx="55" ry="18" fill="#DCCBFF" transform="rotate(15,342,130)"/>
  <!-- Top hair tuft (ahoge) -->
  <path d="M250,85 Q240,40 260,20 Q268,45 262,85" fill="#DCCBFF" stroke="#C9B8EE" stroke-width="1"/>

  <!-- ── Eyes ─────────────────────────────── -->
  <!-- Left eye -->
  <ellipse cx="195" cy="280" rx="38" ry="42" fill="#5A478F"/>
  <ellipse cx="195" cy="280" rx="34" ry="38" fill="#241B3B"/>
  <!-- Left eye highlights -->
  <circle cx="208" cy="265" r="14" fill="white"/>
  <circle cx="183" cy="290" r="6" fill="white" opacity="0.8"/>
  <circle cx="200" cy="300" r="3" fill="white" opacity="0.5"/>
  <!-- Left eye sparkle -->
  <circle cx="180" cy="258" r="5" fill="white" opacity="0.9"/>

  <!-- Right eye -->
  <ellipse cx="317" cy="280" rx="38" ry="42" fill="#5A478F"/>
  <ellipse cx="317" cy="280" rx="34" ry="38" fill="#241B3B"/>
  <!-- Right eye highlights -->
  <circle cx="330" cy="265" r="14" fill="white"/>
  <circle cx="305" cy="290" r="6" fill="white" opacity="0.8"/>
  <circle cx="322" cy="300" r="3" fill="white" opacity="0.5"/>
  <!-- Right eye sparkle -->
  <circle cx="302" cy="258" r="5" fill="white" opacity="0.9"/>

  <!-- ── Eyebrows ─────────────────────────── -->
  <path d="M155,235 Q175,222 210,228" fill="none" stroke="#786A9A" stroke-width="4" stroke-linecap="round"/>
  <path d="M357,235 Q337,222 302,228" fill="none" stroke="#786A9A" stroke-width="4" stroke-linecap="round"/>

  <!-- ── Blush ────────────────────────────── -->
  <ellipse cx="150" cy="315" rx="28" ry="16" fill="url(#blush)"/>
  <ellipse cx="362" cy="315" rx="28" ry="16" fill="url(#blush)"/>

  <!-- ── Mouth ────────────────────────────── -->
  <!-- Small "w" mouth -->
  <path d="M235,325 Q245,335 256,325 Q267,335 277,325" fill="none" stroke="#DB82A5" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>

  <!-- ── Nose ─────────────────────────────── -->
  <ellipse cx="256" cy="310" rx="4" ry="3" fill="#D4B6E8"/>

  <!-- ── Small bow accessory ──────────────── -->
  <path d="M310,190 Q330,170 340,190 Q330,185 320,192 L310,210 Q315,192 310,190Z" fill="url(#bowGrad)"/>
  <path d="M310,190 Q290,170 280,190 Q290,185 300,192 L310,210 Q305,192 310,190Z" fill="url(#bowGrad)"/>
  <circle cx="310" cy="198" r="8" fill="#FF8FB2"/>
</svg>`

// ── Render ───────────────────────────────────────────
async function generate() {
  const outDir = __dirname
  const svg256 = svg.replace('width="512" height="512"', 'width="256" height="256"')

  // Keep the editable vector source in sync with the generated PNG assets.
  fs.writeFileSync(path.join(outDir, 'icon.svg'), svg256)
  console.log('✓ icon.svg (256×256)')

  // 256×256 (main icon)
  await sharp(Buffer.from(svg))
    .resize(256, 256)
    .png()
    .toFile(path.join(outDir, 'icon.png'))
  console.log('✓ icon.png (256×256)')

  // 512×512 (high-DPI)
  await sharp(Buffer.from(svg))
    .resize(512, 512)
    .png()
    .toFile(path.join(outDir, 'icon@2x.png'))
  console.log('✓ icon@2x.png (512×512)')

  // 32×32 (for tray — sharp at small size)
  await sharp(Buffer.from(svg))
    .resize(32, 32)
    .png()
    .toFile(path.join(outDir, 'icon-tray.png'))
  console.log('✓ icon-tray.png (32×32)')

  // 64×64
  await sharp(Buffer.from(svg))
    .resize(64, 64)
    .png()
    .toFile(path.join(outDir, 'icon-64.png'))
  console.log('✓ icon-64.png (64×64)')

  // 32×32 and 16×16 compatibility sizes
  await sharp(Buffer.from(svg))
    .resize(32, 32)
    .png()
    .toFile(path.join(outDir, 'icon-32.png'))
  console.log('✓ icon-32.png (32×32)')

  await sharp(Buffer.from(svg))
    .resize(16, 16)
    .png()
    .toFile(path.join(outDir, 'icon-16.png'))
  console.log('✓ icon-16.png (16×16)')

  console.log('\nDone! New icon generated.')
  console.log('Tray uses icon.png (resized to 16×16 in code).')
}

generate().catch(err => {
  console.error('Icon generation failed:', err)
  process.exit(1)
})
