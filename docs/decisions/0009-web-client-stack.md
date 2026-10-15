# 0009 Web client stack

Date: 2026-10-15
Status: accepted

## Context
The web app needs a build tool, router, data layer and component base. Owner priorities: performance first (small bundles, lazy screens), no fancy effects, easy to extend.

## Decision
- Vite with `@vitejs/plugin-react`; Tailwind CSS v4 through `@tailwindcss/vite` (no PostCSS config).
- TanStack Router (code-based route tree, lazy routes) and TanStack Query for server state.
- shadcn/ui components copied into `src/components/ui/` (they depend on `radix-ui` primitives, `class-variance-authority`, `clsx`, `tailwind-merge`). Their classes are trimmed to the egrant tokens; animations and the icon library (`lucide-react`) are left out.
- `socket.io-client` for realtime, `zod` with `@spolu/shared` for response parsing.
- Vitest, jsdom and Testing Library for tests.

## Consequences
- Each route is a separate chunk; Radix code is only shipped by screens that import a component using it.
- Components are our code, so restyling is a normal edit; updating them from shadcn is manual.
- No file-based routing codegen to maintain; routes are listed in `src/router.tsx`.
