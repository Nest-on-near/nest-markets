# UI Thoughts (Nest Markets)

## Why this file
Single place to preserve design intent, decisions, and next iterations so work can resume quickly.

## Current status
- Current UI is in a decent state and usable.
- Major shift completed from data-heavy dashboard feel to editorial/brand-driven experience.
- Landing page now carries a stronger visual narrative and motion language.

## What we wanted
- A full product experience, not just data tables/cards.
- Elegant, fluid, modern UI with scroll-based motion.
- Less clutter, fewer hard boxes, more breathing room.
- Strong visual identity for Nest Markets.

## What was explicitly disliked
- Generic AI-looking layouts.
- Overuse of boxes/cards.
- Dense, dashboard-heavy structure.

## Design direction chosen
- Editorial + cinematic feel.
- Large type and whitespace-driven hierarchy.
- Animated background/organic shapes inspired by reference mood.
- Softer rounded surfaces and cleaner navigation.
- Motion used for guidance, not decoration overload.

## Reference influence
- Mindmarket-style *feel* was the target (not exact copy).
- Key extracted cues from provided recording thumbnail:
  - Bright playful field colors.
  - Floating rounded nav container.
  - Oversized headline impact.
  - Organic scene elements and soft movement.

## App information architecture
- `/` -> Landing page (brand/story-first)
- `/markets` -> Markets list
- `/markets/[id]` -> Market detail + trade panel
- `/portfolio` -> Positions
- `/create` -> Create market form

## Current visual system (high level)
- Palette moved to warm/playful + clean neutrals.
- Typography uses expressive display for headings + clean sans for body.
- Borders are softer; list rows favored over boxed cards where possible.
- Scroll reveal transitions are in place via reusable `Reveal` component.

## Key implementation notes
- Landing and global styling are now primarily controlled in:
  - `src/app/page.tsx`
  - `src/app/globals.css`
- Motion utility:
  - `src/components/ui/reveal.tsx`
- Navigation and page routes already refactored for landing-first flow.

## What is working well
- Better brand personality.
- Better spacing than earlier iterations.
- More unique look vs scaffold baseline.
- Functional product pages still intact.

## Next polish pass (recommended order)
1. Typography refinement:
   - Tighten display/body scale ratios.
   - Improve line lengths and rhythm per section.
2. Motion timing pass:
   - Harmonize reveal durations and delays.
   - Add subtle parallax depth to hero scene.
3. Landing composition pass:
   - Tune shape placement for stronger art direction.
   - Improve section-to-section narrative transitions.
4. Markets/Portfolio UI polish:
   - Further reduce generic controls feel.
   - Improve microcopy and empty states.
5. Mobile-specific polish:
   - Validate spacing hierarchy on small screens.
   - Ensure hero impact remains strong without crowding.

## Product-functional follow-up
- Verify all contract integration argument casing/ABI compatibility against deployed testnet contracts.
- Validate buy/sell/create/redeem flows end-to-end with wallet.

## Practical note for restart later
- Dev command:
  - `cd /Users/prakharojha/Desktop/me/personal/nest-all/nest-markets/apps/ui`
  - `npm run dev -- -p 3003`
- If port busy:
  - `kill $(lsof -ti:3003)`

## Definition of "done" for this design track
- Feels distinctly "Nest" and non-generic at first glance.
- Motion feels intentional and premium.
- Clear hierarchy with generous whitespace.
- Product pages remain fast and usable for actual trading actions.
