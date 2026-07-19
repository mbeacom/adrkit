---
name: adrkit
description: Decision memory rendered as a precise, inspectable instrument.
colors:
  canvas: "oklch(1 0 0)"
  surface: "oklch(0.965 0 0)"
  ink: "oklch(0.2 0.018 35)"
  muted-ink: "oklch(0.43 0.018 35)"
  border: "oklch(0.82 0.012 35)"
  decision-coral: "oklch(0.58 0.17 34)"
  decision-coral-deep: "oklch(0.47 0.16 30)"
  blueprint-ink: "oklch(0.43 0.1 245)"
  inverse-canvas: "oklch(0.145 0.01 30)"
  inverse-ink: "oklch(0.94 0.008 35)"
  inverse-muted: "oklch(0.72 0.012 35)"
typography:
  display:
    fontFamily: "'Anybody Variable', 'Arial Narrow', sans-serif"
    fontSize: "clamp(3.25rem, 7.4vw, 5.75rem)"
    fontWeight: 720
    lineHeight: 0.94
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "'Anybody Variable', 'Arial Narrow', sans-serif"
    fontSize: "clamp(2.25rem, 4.5vw, 4rem)"
    fontWeight: 680
    lineHeight: 1
    letterSpacing: "-0.025em"
  title:
    fontFamily: "'Anybody Variable', 'Arial Narrow', sans-serif"
    fontSize: "clamp(1.35rem, 2.2vw, 2rem)"
    fontWeight: 660
    lineHeight: 1.12
    letterSpacing: "-0.015em"
  body:
    fontFamily: "'Atkinson Hyperlegible Next Variable', sans-serif"
    fontSize: "1rem"
    fontWeight: 430
    lineHeight: 1.65
    letterSpacing: "normal"
  label:
    fontFamily: "'Atkinson Hyperlegible Next Variable', sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 680
    lineHeight: 1.25
    letterSpacing: "0.02em"
  code:
    fontFamily: "ui-monospace, 'SFMono-Regular', Consolas, monospace"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.55
    letterSpacing: "-0.01em"
rounded:
  xs: "3px"
  sm: "6px"
  md: "10px"
  pill: "999px"
spacing:
  xs: "0.375rem"
  sm: "0.75rem"
  md: "1.25rem"
  lg: "2rem"
  xl: "clamp(3rem, 7vw, 6rem)"
  section: "clamp(5rem, 11vw, 10rem)"
components:
  button-primary:
    backgroundColor: "{colors.decision-coral}"
    textColor: "{colors.canvas}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0.875rem 1.125rem"
    height: "2.875rem"
  button-primary-hover:
    backgroundColor: "{colors.decision-coral-deep}"
    textColor: "{colors.canvas}"
  button-secondary:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0.875rem 1.125rem"
    height: "2.875rem"
  status-current:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.canvas}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0.375rem 0.625rem"
  status-planned:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0.375rem 0.625rem"
---

# Design System: adrkit

## 1. Overview

**Creative North Star: "The Decision Instrument"**

adrkit should feel like a precision instrument that makes architectural
consequences visible. Its physical references are Braun technical manuals, NASA
standards diagrams, and GitHub Primer's operational clarity: disciplined
geometry, plain-language labels, durable controls, and one unmistakable signal
color. The working scene is a Staff+ engineer evaluating the site on a bright
desktop display during a design review, so the primary canvas is true white
rather than a theatrical dark terminal.

The signature is the **affects map**: a decision record visibly routes to the
code paths and packages it governs. Coral behaves like an operational redline,
not decoration. The one orchestrated load sequence draws those connections in
the hero; everything else uses restrained state transitions. The interface
explicitly rejects generic developer-tool darkness, terminal cosplay,
interchangeable SaaS card grids, and ornamental editorial styling.

**Key Characteristics:**

- True-white working canvas with committed coral fields.
- Wide, expressive grotesk display type paired with a highly legible body face.
- Structural rules, lists, and matrices instead of repeated cards.
- Real records, commands, statuses, and constraints used as visual material.
- One choreographed hero map; motion elsewhere is responsive and quiet.

**The Instrument Test.** Every visual device must help a visitor locate,
compare, route, or verify a decision. If it only decorates the page, remove it.

## 2. Colors

The palette treats coral as a decision redline, blueprint ink as a navigational
signal, and neutral surfaces as working material.

### Primary

- **Decision Coral** (`decision-coral`): Carries the hero instrument, primary
  actions, and high-consequence emphasis. White text is mandatory on this fill.
- **Decision Coral Deep** (`decision-coral-deep`): Hover, active, and compact
  high-emphasis states where extra contrast is required.

### Secondary

- **Blueprint Ink** (`blueprint-ink`): Links, focus-supporting details, and
  route lines that mean "this connects to that." It never becomes a broad
  background wash.

### Neutral

- **True Canvas** (`canvas`): The dominant light-mode background. It is literal
  white, not cream, paper, sand, or parchment.
- **Instrument Surface** (`surface`): Recessed documentation controls, code
  gutters, and alternating table rows.
- **Working Ink** (`ink`): Primary text and structural lines.
- **Measured Ink** (`muted-ink`): Secondary copy that remains comfortably
  readable at body sizes.
- **Calibration Rule** (`border`): Dividers and table structure.
- **Night Canvas / Night Ink** (`inverse-canvas`, `inverse-ink`,
  `inverse-muted`): User-selected dark mode, kept neutral and matte rather than
  neon or terminal-like.

**The Redline Rule.** Coral must carry meaning: decision, consequence, or the
primary route forward. Never scatter it as decorative confetti.

**The White-Surface Rule.** Warmth lives in Decision Coral, never in a
cream-tinted page background.

## 3. Typography

**Display Font:** Anybody Variable (with Arial Narrow fallback)  
**Body Font:** Atkinson Hyperlegible Next Variable (with sans-serif fallback)  
**Label/Mono Font:** Atkinson Hyperlegible Next Variable for labels; the native
system monospace stack only for literal code and schema data.

**Character:** Anybody's width and weight axes give headings the decisive,
engineered silhouette of a technical manual without turning the page into
terminal cosplay. Atkinson Hyperlegible Next makes dense explanations,
navigation, and examples exceptionally easy to scan.

### Hierarchy

- **Display** (720, fluid to 5.75rem, 0.94): Homepage thesis only. Keep
  letter-spacing no tighter than -0.035em and test every line at narrow widths.
- **Headline** (680, fluid to 4rem, 1): Major narrative turns and section
  conclusions.
- **Title** (660, fluid to 2rem, 1.12): Capability names, documentation titles,
  and compact calls to action.
- **Body** (430, 1rem, 1.65): Explanatory copy capped at 70ch.
- **Label** (680, 0.8125rem, 0.02em): Status, metadata, and short controls in
  sentence case. Uppercase is reserved for genuinely coded states such as
  `PRE-ALPHA`.
- **Code** (500, 0.875rem, 1.55): Literal commands, frontmatter, paths, and
  schema values only.

**The Code-Is-Evidence Rule.** Monospace appears only when the content is
machine-readable evidence. It is never a brand costume.

## 4. Elevation

The system is flat by default. Depth comes from tonal contrast, structural
rules, overlap within the affects map, and one shallow state shadow when an
interactive element lifts. Documentation surfaces never stack decorative
shadows.

### Shadow Vocabulary

- **Responsive Lift** (`0 10px 30px oklch(0.2 0.018 35 / 0.12)`): Primary
  actions and the decision instrument on hover-capable devices only.

**The Flat-Until-Active Rule.** Resting surfaces use no shadow. A shadow is a
response to interaction, never permanent decoration.

## 5. Components

Components should feel durable, compact, and inspectable. Controls read as parts
of one instrument rather than soft promotional objects.

### Buttons

- **Shape:** Gently machined corners (`sm`) rather than pills.
- **Primary:** Decision Coral with True Canvas text, compact label typography,
  and a 2.875rem target height.
- **Hover / Focus:** Shift to Decision Coral Deep and lift by one pixel. Focus
  uses a two-color ring that remains visible on white, coral, and dark surfaces.
- **Secondary:** True Canvas with Working Ink text and a full Calibration Rule
  border. Ghost actions use underline offset rather than a floating container.

### Chips

- **Style:** Pills are reserved for finite status values such as `works today`
  and `planned`. Every chip includes text or an icon plus text; color alone never
  carries status.
- **State:** Current capabilities use Working Ink fills. Planned capabilities use
  Instrument Surface with a visible outline.

### Cards / Containers

- **Corner Style:** Purpose-built instruments may use `md`; content groups and
  documentation sections remain square and rule-separated.
- **Background:** True Canvas or Instrument Surface.
- **Shadow Strategy:** None at rest; use Responsive Lift only for actual
  interaction.
- **Border:** Full one-pixel Calibration Rule borders only. Colored side stripes
  are prohibited.
- **Internal Padding:** `md` for compact controls and `lg` for instruments.

### Navigation

- The header is a quiet calibration bar: compact wordmark, wide search field,
  GitHub link, and theme control.
- The active documentation item uses Working Ink weight plus a Decision Coral
  marker that does not rely on color alone.
- Mobile navigation retains the same vocabulary and exposes a minimum 44px
  target for every control.

### Affects Map

The signature component pairs a real ADR excerpt with the paths and packages in
its `affects` field. Connection lines draw once on page load, remain visible by
default, and become instant under reduced motion. The map is explanatory, not a
fake terminal and not a decorative network graph.

### Capability Matrix

Current and planned capabilities use aligned rows with explicit status text,
command evidence, and plain descriptions. Do not convert this matrix into a
same-sized icon-card grid.

**The One-Orchestrated-Moment Rule.** The affects map owns the page-load
choreography. All other motion is a short state response using exponential
ease-out.

## 6. Do's and Don'ts

### Do:

- **Do** make the `affects` relationship the homepage's memorable visual proof.
- **Do** use real commands, schema fields, ADR ids, and honest current/planned
  labels.
- **Do** keep body copy below 70ch and preserve readable reflow at 200% zoom.
- **Do** maintain WCAG 2.2 AA, visible keyboard focus, reduced motion, and
  color-independent status cues.
- **Do** let Decision Coral carry 30–60% of the hero composition while True
  Canvas remains the dominant reading surface.

### Don't:

- **Don't** build a generic dark developer-tool landing page with neon accents,
  terminal cosplay, glowing grids, or hacker aesthetics.
- **Don't** use interchangeable SaaS layouts built from repeated icon cards,
  vague claims, and decorative metrics.
- **Don't** let the documentation theme expose navigation and prose without
  first explaining why adrkit matters.
- **Don't** use editorial-magazine treatments that make governance feel
  ornamental rather than operational.
- **Don't** use gradient text, decorative glassmorphism, colored side-stripe
  borders, or tiny uppercase eyebrows above every section.
- **Don't** use monospace for brand headings or ordinary body copy.
