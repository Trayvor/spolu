# 0028 — Finance charts as our own SVG components

Date: 2026-10-17 · Status: accepted · Phase 32 part C ([spec](../superpowers/specs/2026-10-17-finance-module-design.md) §8, decision 21)

## Context

The finance screens need three kinds of chart: bars by month grouped and stacked (money: paid, to be paid, and the cost of the work), small multiples of bars (hours, one chart per admin on one scale) and horizontal proportional bars (the rankings of part D). No lines, pies, zoom or pan. Performance is a top priority (lazy screens, small bundles), and the charts must be accessible and use the egrant.sk tokens.

| option | gzip (about) | fit |
|---|---|---|
| Chart.js 4 (tree-shaken, bar only) | 45–65 kB | canvas, good bars and tooltips; heavy for three bar charts; canvas is not accessible by itself |
| Recharts | ~95 kB + d3 parts | React-friendly, far too big |
| uPlot | ~20 kB | fast time series on canvas; bars and small multiples need plugins; weak accessibility |
| visx (scale, shape, axis) | ~20–25 kB | SVG primitives, still a dependency with d3 modules |
| **Own SVG components** | **~3 kB** | bars, axes and labels are simple geometry; accessible SVG plus a table; styled by our tokens; no dependency |

## Decision

- Hand-written components in `apps/web/src/features/finance/charts/`: `MonthBars` (grouped and stacked bars by month, a zero line, round gridlines, month labels), `SmallMultiples` (one `MonthBars` per item on a shared y scale, the first 6 and "Show all"), `RankBar` (a plain CSS bar for part D), `ChartTable` (the same numbers as a table), and the pure helpers in `scale.ts`: `niceScale(max)` (0 and round steps of 1, 2, 2.5 or 5 × 10ⁿ) and `monthAxis(months, locale)` (short month names, the year on January and on the first month).
- Drawn in pixels from the measured width (`ResizeObserver`), so text never stretches; labels are never rotated, every n-th shows instead (2, 3, 4, 6 or 12, keeping January).
- Colours only from tokens: `--chart-1` (ink: paid, hours), `--chart-2` (surface-3, hatched: to be paid), `--chart-3` (brand blue: cost). The app has no dark theme (egrant.sk has none), so there is one set.
- Accessibility: each chart is a labelled group; each month a focusable column with a spoken summary and a tooltip on hover or focus; every chart has "Show as table".
- Motion: only a 150 ms opacity on the other months while one is pointed at; none under reduced motion.
- They live only in the finance chunks; no new dependency.

## Consequences

- The initial JS does not change; the charts cost about 3 kB gzip inside the finance cards' lazy chunk.
- Anything beyond bars (lines, zoom) would mean extending these components or revisiting this decision.
- `niceScale` and `monthAxis` are unit-tested; the components are covered through the cards' tests.
