# 0020 Header menus on first use and native dialog sheets

Date: 2026-10-17
Status: accepted

## Context
The owner asked to polish the interface and the phone version, with speed and bundle size first, and to split the phone navigation: the section links (Skupiny, Úlohy, Tikety, Znalosti …) lived in the account menu under 641 px. The initial JS was 199.95 kB gzip of the 200 kB budget. About 25 kB of it was the Radix menu stack (menu, popper, floating-ui, focus scope, dismissable layer, scroll lock), which only the header's account and language menus used eagerly. The owner also asked for animations without a new library.

## Decision
- **Header menus load on first use.** `components/deferred-menu.tsx` renders a plain button that looks like the menu's trigger; pointing at it, touching or focusing it starts the import of the menu's Radix part, the click mounts it open (`defaultOpen`), and it stays mounted. The account menu (`features/auth/user-menu-content.tsx`) and the language menu (`components/language-menu.tsx`) use it. Radix stays the menu library; only when it loads changes.
- **The section menu is a native `<dialog>`.** `components/ui/bottom-sheet.tsx` uses `showModal()`: the browser gives the focus trap, the inert page, Escape and focus return; the component adds the backdrop tap, a downward swipe, closing after the slide-out animation and the scroll lock. It is a bottom sheet on phones and a panel under the header from 641 px. The sheet is its own lazy chunk (`section-sheet`). The existing message action sheet keeps its own implementation.
- **Motion is CSS only.** Keyframes and `--animate-*` tokens in `theme.css` (menu, sheet, fade, toast, page, skeleton), transform and opacity only, off under `prefers-reduced-motion`; screen and tab changes fade with opacity only (`RouteFade`), because a transform would make the screen the containing block of its fixed panels while it runs.

## Consequences
- Initial JS 174.1 kB gzip (from 199.95 kB). The first open of the account or language menu fetches the shared `dropdown-menu` chunk (18.7 kB gzip), usually while the pointer or finger is on its way; the service worker precaches it, so later opens are instant.
- Tests that open these menus wait for them (`findBy…`), as the first click loads a chunk.
- A menu whose chunk cannot load (offline before the first open, a deploy in between) does not open; the header still works and a reload fixes it.
- e2e contexts run with `reducedMotion: 'reduce'`, so measured boxes are final.
