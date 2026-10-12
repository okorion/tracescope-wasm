# README diagrams

Self-contained conceptual SVGs with embedded Noto Sans KR (see [OFL](OFL.txt)).
Icons represent software roles; boundaries show execution ownership. Slot numbers
are examples. Animated arrows show direction, not live measurements.

Regenerate: `node docs/visuals/render.mjs` from the repository root.
Edit `spec.json` for text and `render.mjs` for layout. Both desktop and mobile,
light/dark, animated/static variants are generated. `picture` selects static
variants for reduced motion.

The font is a character subset. After adding text, regenerate it from Noto Sans KR
with `python docs/visuals/subset-font.py /path/to/NotoSansKR-VF.ttf`.
Documentation tools: fonttools 4.60.1 and brotli 1.1.0. App dependencies are unchanged.
