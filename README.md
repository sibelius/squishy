# squishy.lab

Build, squish and print squishies in the browser. Pick a base shape (mochi, kitty, bear, bunny, froggy, heart, star, donut, peach, cloud, toast, butter, chick), customize colors, pattern, face and proportions, then poke, squash and pull it with a real-time soft-body simulation. When you like it, generate a 3D-printable mold and download it as STL, or print a real-size paper squishy template.

**Live:** https://squishy-nu.vercel.app

## Features

Everything lives on a single page (`/`) with three tabs:

- **Build**: 13 shapes from a catalog, colors, patterns (gradient, icing, crust, belly patch, sprinkles, foil wrapper), eyes, mouth, blush, stretch/puff, size in mm, and materials (slow-rise foam, mochi/TPR, jelly, stress ball, butter, paper). Touch/mouse tools: poke, squash, pull, and a squeeze plate.
- **Mold**: two-part or open molds with a parting plane, wall thickness, pour sprue, vent, registration keys and clearance. Meshing runs in a Web Worker. You can export the master, each part, or the whole plate as binary STL. Includes casting instructions.
- **Paper**: a printable SVG template at real size, either a front/back "pillow" or a fold-up box net for the butter shape. It uses the same shader as the 3D view, so the print matches your design. You can download the SVG or print it directly.
- Favicon, Apple icon and generated OG/Twitter images.

## Stack

- Next.js 16.3 (App Router), React 19.2, TypeScript
- three.js + @react-three/fiber + @react-three/drei
- Tailwind CSS v4
- A custom position-based-dynamics soft body, SDF shapes meshed with surface nets, and a hand-written STL writer (no CAD dependencies)

## Getting started

```bash
pnpm install
pnpm dev
```

Open http://localhost:3100. The dev script pins port 3100.

## Scripts

| Script       | What it does                                  |
| ------------ | --------------------------------------------- |
| `pnpm dev`   | Dev server on port 3100                       |
| `pnpm build` | Production build                              |
| `pnpm start` | Serve the production build (default port 3000) |
| `pnpm lint`  | ESLint                                        |

There are no tests and no environment variables.

## Project structure

```
src/
  app/            layout, page, icon/apple-icon, opengraph/twitter images
  components/
    Studio.tsx    UI: tabs, controls, downloads
    Scene.tsx     R3F canvas, lights, camera
    SquishyBody.tsx  soft-body mesh + interaction tools
  lib/
    sdf.ts        signed distance functions for every shape
    mesher.ts     surface-nets mesher
    softbody.ts   PBD soft body engine + material presets
    squishyMaterial.ts  shader (colors, patterns, face)
    mold.ts / mold.worker.ts  mold SDF + meshing in a worker
    paper.ts      printable paper templates (SVG)
    stl.ts        binary STL export
    catalog.ts    shape catalog and defaults
    og.tsx        site metadata + OG image art
assets/fonts/     Geist fonts used by the OG images
```

## Deploy

The site deploys on Vercel as project `squishy`. The GitHub remote is `sibelius/squishy`.

```bash
vercel --prod
```

Note: `SITE_URL` in `src/lib/og.tsx` (used for `metadataBase`) is set to `https://squishy.vercel.app`, but this project's production alias is `https://squishy-nu.vercel.app`.
