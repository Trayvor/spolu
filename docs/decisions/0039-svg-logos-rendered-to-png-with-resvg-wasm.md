# 0039 SVG logos from eGrant are rendered to PNG with resvg compiled to WebAssembly

Date: 2026-10-18
Status: accepted

(Numbered after 0038 of the same pull request. Parallel pull requests (#132, #143) also claim ADR numbers from 0037, so this one and 0038 may still be renumbered at merge time.)

## Context
Many eGrant instances have an SVG logo, and the groups webhook ([ADR 0038](0038-egrant-groups-webhook-and-group-deactivation.md)) refused SVG with `415`: an SVG is an XML document that can carry scripts, event handlers and links to other files or URLs, and served from our origin it would run in the browser. The owner wants SVG accepted, security first: never store or serve the SVG itself.

## Decision
- **An SVG logo is rendered to a PNG on the server** (`modules/groups/logo-svg.ts`) and only the PNG goes on, through the same path as a sent PNG (sniffed, metadata stripped, stored as `logo-<random>.png`, served as `image/png`). The SVG bytes are never stored, logged or served.
- **The renderer is `@resvg/resvg-wasm`** (resvg, a Rust SVG renderer, compiled to WebAssembly; MPL-2.0, no dependencies). resvg runs no scripts, ignores `<foreignObject>` and has no HTML or CSS engine beyond SVG styling. The WebAssembly build was chosen over the native `@resvg/resvg-js` for safety: a check showed the native build reads an `<image href="/absolute/path.png">` from the server's disk into the rendered picture (a way to leak other stored images), while the WebAssembly module has no file system and no network at all, so no `href` other than an embedded `data:` image can load anything. It also has no per-platform binary, so the production image (Debian bookworm, `pnpm deploy`) needs no matching optional package; the 2.4 MB `.wasm` file ships in `node_modules` and is loaded once, on the first SVG.
- **No fonts**: system fonts are not loaded (`loadSystemFonts: false`) and none are bundled, so SVG text that is not converted to paths draws nothing. Logos usually have outlined text; the integration guide says so.
- **Limits**: the declared type must be `image/svg+xml`; the existing 2 MiB decoded limit applies (`413`); bytes that are not a well-formed SVG with a size, or render to nothing, are `422 invalid_logo`. The output is fitted so its longer side is 512 px (the ratio is kept, no padding), which also bounds the rendering work, whatever size the SVG declares.
- The in-app logo upload (512 KiB, PNG/JPEG/WebP) is unchanged.

## Consequences
- One new dependency (`@resvg/resvg-wasm`, about 2.4 MB on disk in the server image, nothing in the web bundle).
- Rendering is synchronous WebAssembly on the main thread, a few to tens of milliseconds for a logo. A pathological SVG (heavy filters) could hold the event loop longer; the route is behind eGrant's key and 60 calls a minute, so a worker thread is not worth it now.
- Rendering is deterministic, so a resent SVG gives the same PNG and the webhook answers `unchanged`.
- An SVG logo whose text relies on fonts loses that text; eGrant converts it to paths.
