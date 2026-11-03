# Podframes design

## Approved direction
Mint editorial studio, confirmed by the user on 2026-11-03. References are Jellypod for welcoming creator controls, a script desk for the editing hierarchy, and a cinema monitor for the preview. A creator works at a desk in changing daylight, directing a short episode in a focused but playful mood. The interface follows the computer theme.

## Register and scope
Product register for the library and five-step studio. Brand register for the landing page. Production interface with responsive layouts, working controls, empty/loading/error/success states, and readable Chinese dialogue. The web design is independent of exported video artwork.

## Visual system
Warm off-white canvas, white raised surfaces, deep green ink, mint actions. Dark theme uses ink surfaces and bright mint. Use OKLCH tokens in globals.css. Accent text has a separate accessible darker tone in light mode. Main action uses mint with deep ink text. Semantic error/warning/success colors remain distinct.

Keep the existing DM Sans and Geist Mono font assets. Use sans for labels and body, mono for timecodes and machine values. Body is 14–16px, helper text at least 12px, major headings 28–56px. Dialogue gets 16px and generous line height. Rounded controls 10px, panels 18–24px. Hairline dividers and restrained shadows establish depth.

## Layout and interaction
Compact studio navigation connects home, project library, and new episode. Five steps remain visible with circular numbered markers. Forms sit on a wide readable workspace beside a sticky dark video monitor. Mobile stacks the editor before preview. Footers wrap actions and keep targets easy to reach. Use existing behavior and generation safeguards. Clearly distinguish primary generation from supporting actions.

Library cards prioritize actual video imagery, title, cast, duration, progress, and template action. Empty states explain the first useful action. Dialogs have rounded surfaces, bounded height, readable labels, and visible close controls. Keep animation limited to short state feedback and honor reduced motion.

## Accessibility
Visible focus, meaningful names, disabled states, and contrast in both themes. Avoid horizontal overflow at mobile widths. Preview canvas retains dark local tokens so captions and video overlays stay legible in either app theme.

## Theme review standard
Check light and dark themes for every visual change. Review normal, hover, focus, selected, disabled, error, and loading states across the library, five studio steps, dialogs, landing, and dark preview. Measure text contrast against canvas and both raised surfaces. Target WCAG AA 4.5:1 for normal text, and 3:1 for meaningful control boundaries and focus indicators. Also review narrow phone, laptop, and desktop layouts.

Wondercraft is a secondary styling reference for confident typography, quiet charcoal surfaces, clear separation between panels, and vivid teal actions. Keep the approved mint identity and system theme behavior.
