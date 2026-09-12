# TeamLoop: copy-ready AI instructions

## Full AI handoff

Create the requested work for TeamLoop using this brand system. Preserve it rather than inventing a new identity.

WHAT IT IS
TeamLoop is a local orchestration toolkit that coordinates multiple AI subscriptions and optional specialist providers from a Codex-led workflow. Created by Mark Salisbury with Codex, inspired by Claudex Loop but implemented as a separate system. It is not a new model, a separate hosted chat app, or a universal model ranking. Do not invent a fixed speedup, token-saving percentage, provider endorsement, or guaranteed correctness.

LOCKED IDENTITY
Name: TeamLoop, exactly this casing.
Symbol: supplied Assembly Cinch / AC1, refined junction. Preserve its two angular modular loops, shared cinched junction, silhouette and internal gaps. Use the actual asset. Do not redraw it from this description, substitute an infinity glyph, generate a new mark, or add AI-provider logos. If the asset is missing, ask for it or use an explicitly text-only layout.
Wordmark and short display headlines: Anta Regular 400. No fake bold, italics, stretching or added letter spacing. Recommended body/UI type: Sora 400, with 600 for emphasis. Keep long reading text out of Anta.
Arcade blue: #315BFF. Arcade green: #43F052. Navy: #0C1220. Off-white: #F5F7FB. White: #FFFFFF. Symbol is blue; wordmark is green. Do not alter those two colors for a different background.

TREATMENTS
On dark navy: plain blue symbol and green wordmark. No glow or shadow.
On light backgrounds: exact green wordmark, navy outline 0.045em, paint-order: stroke fill, and a hard navy shadow offset 0.045em right / 0.05em down with zero blur. This is the approved default, not outline alone. The blue symbol stays unchanged.
On tiny or visually busy placements: use a provided backed asset or a simple navy backing if needed. Do not turn the green hunter green. Do not assume a tiny export is legible without inspecting it.

CHARACTER AND LAYOUT
Independent home-lab ingenuity, arcade confidence, precise construction, useful software. Angular motifs, clear space, straightforward hierarchy and restrained hard offsets. Not enterprise blandness and not a neon sci-fi nightclub. No orange, purple/magenta/cyan palette, gradients, glossy 3D effects or decorative provider branding. This identity is visually separate from StarForge.
Use navy or off-white for reading text as appropriate. Blue buttons with white text and green buttons with navy text are good starting pairs. Never use bare green body text on white. Do not outline whole paragraphs.
Keep at least one-quarter of the symbol's height clear around the lockup as a working rule. Start at 24px wordmark type / 52px-wide symbol or larger, then inspect actual rendering. No crop, warp, rotation or rearrangement of the symbol pieces.

VOICE
Direct, curious, specific, human. A little playful, not forced. Explain what the system does before using orchestration jargon. No fake metrics, universal superiority claims or em dashes. Optional descriptor: Many models. One conversation.

DELIVERY
Use the supplied assets and actual fonts. The current SVG files contain a source-derived raster symbol, not a fully vector master. Prefer PNG exports for tools that render SVG filters or embedded fonts inconsistently. Check desktop and mobile, text contrast, actual font loading and the hard-shadow treatment. Disclose substitutions and unverified output sizes. Do not publish or change software licensing without separate permission.

## Fonts and naming

TEAMLOOP TYPOGRAPHY
Write TeamLoop with capital T and L, no space.
Locked wordmark and short display type: Anta Regular, native weight 400. Use the supplied font. No synthetic bold, italics, width scaling or extra tracking. The wordmark is not an all-caps TEAMLOOP replacement.
Recommended companion for body text, navigation and controls: Sora Regular 400; Sora Semibold 600 for emphasis. This companion is a supporting kit recommendation, not a redesign of the locked wordmark.
Use a system UI fallback for ordinary reading text if Sora is unavailable. If Anta is unavailable, use the provided rendered wordmark asset instead of silently substituting another font.
Fonts are bundled with their own OFL licenses. Keep the license files with redistributed font files.

## Color rules

TEAMLOOP ARCADE COLORS
Blue #315BFF: symbol, primary signal, blue action fills.
Green #43F052: wordmark, selected accents, green action fills.
Navy #0C1220: dark ground, outline, hard shadow, text on light grounds.
Off-white #F5F7FB and white #FFFFFF: light grounds and reading text on dark grounds.
Supporting dark surface #151F32; supporting muted text on dark #AEB9D0.

Do not darken or desaturate the brand blue/green to suit the background. In particular, no hunter-green light-mode wordmark. Solve separation with the approved hard shadow or a navy backing.
Normal reading text: navy on light, off-white on dark. White text on blue buttons; navy text on green buttons. Avoid small blue text on navy and bare green text on white. Green is not a universal success state; pair status colors with labels.
No orange or StarForge-like purple/magenta/cyan mix. No gradient blending between the two brand colors.

## Logo treatments

TEAMLOOP LOGO TREATMENTS
Use the supplied Assembly Cinch symbol with Anta 400 lettering. Symbol blue #315BFF, wordmark green #43F052 in every treatment.

DARK: Plain color on navy #0C1220. No wordmark outline or shadow.
LIGHT: Green fill stays #43F052. Navy outline width 0.045em, painted behind the fill. Navy hard shadow: 0.045em right, 0.05em down, blur 0. The outline plus hard shadow is the selected treatment. Do not replace it with outline alone.
At 48px type: outline 2.16px, offset 2.16px right / 2.4px down. At 24px: outline 1.08px, offset 1.08px right / 1.2px down.
FALLBACK: A simple navy backing can support tiny or busy placements and software that does not render the outline correctly. Keep the brand fills unchanged. This is a utility fallback, not the default light treatment.

Keep effects local to the wordmark. Do not apply soft shadows, glows, outlines to every UI label, or extra strokes to the symbol's internal pieces. Preserve its negative space.

## Drop-in CSS

@font-face {
  font-family: 'Anta'; font-style: normal; font-weight: 400;
  font-display: swap; src: url('../fonts/Anta-Regular.woff2') format('woff2');
}
@font-face {
  font-family: 'Sora'; font-style: normal; font-weight: 100 800;
  font-display: swap; src: url('../fonts/Sora-Variable.ttf') format('truetype');
}
:root {
  --tl-blue: #315BFF;
  --tl-green: #43F052;
  --tl-navy: #0C1220;
  --tl-paper: #F5F7FB;
  --tl-white: #FFFFFF;
  --tl-display: 'Anta', sans-serif;
  --tl-body: 'Sora', system-ui, sans-serif;
}
.tl-wordmark {
  font: 400 48px/1.25 var(--tl-display);
  font-synthesis: none;
  letter-spacing: 0;
  white-space: nowrap;
  color: var(--tl-green);
}
.tl-wordmark--light {
  -webkit-text-stroke: 0.045em var(--tl-navy);
  paint-order: stroke fill;
  text-shadow: 0.045em 0.05em 0 var(--tl-navy);
}
.tl-wordmark--dark { -webkit-text-stroke: 0; text-shadow: none; }
.tl-wordmark--backed {
  background: var(--tl-navy);
  padding: 0.13em 0.22em 0.17em;
  border-radius: 0.08em;
  -webkit-text-stroke: 0; text-shadow: none;
}
@supports not (paint-order: stroke fill) {
  .tl-wordmark--light {
    background: var(--tl-navy);
    padding: 0.13em 0.22em 0.17em;
    border-radius: 0.08em;
    -webkit-text-stroke: 0; text-shadow: none;
  }
}
/* Use a supplied logo asset for the symbol. Never recreate it with a text glyph. */


## Voice and layout direction

TEAMLOOP CREATIVE DIRECTION
Independent maker energy with arcade confidence. Sharp, modular, practical and welcoming. The visual identity is separate from StarForge even though the creator is the same person.
Use Anta for short distinctive headlines, Sora for reading, solid navy or clean light grounds, generous breathing room and blue/green focal accents. Prefer hard edges and small, crisp offsets to glossy depth. Corner radii can be modest; do not make every surface a pill. Gradient budget: zero.
Explain plainly before getting technical. Be direct, specific, a little playful and comfortable admitting limits. Do not force jokes, overpromise capability, invent savings, or make provider endorsement claims. No em dashes.
Optional short descriptor: Many models. One conversation.
Plain-English description: TeamLoop helps one lead AI bring in other models for focused work, keep the evidence, and verify what comes back.
Technical description: A local orchestration toolkit with a Codex-led skill, deterministic routing, Node.js runners, provider adapters and file-based context packets and run records.
Do not describe it as one shared model brain or a hosted database.

## Final check before delivery

TEAMLOOP BRAND CHECK
1. Actual supplied Assembly Cinch asset, unchanged geometry and internal gaps.
2. TeamLoop casing and real Anta 400, not a substitute or synthetic bold.
3. Blue #315BFF and green #43F052 retained exactly.
4. Light background uses the navy outline PLUS tight hard shadow, blur zero. Dark background is plain.
5. No hunter-green substitution, orange, StarForge palette, gradients, glow or 3D logo effects.
6. Text contrast is checked. No bare green paragraphs on white or small blue labels on navy.
7. Smallest actual logo placement is inspected. No cropped, cramped or illegible interiors.
8. Every claim about the product is supported. No invented model ranking, usage saving or endorsement.
9. SVG raster-containing status and any export/font limitations are disclosed. Use supplied PNG if the target app misrenders SVG.
10. No publication, new license grant or irreversible system change without separate permission.
