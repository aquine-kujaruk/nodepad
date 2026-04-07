# CLAUDE.md — nodepad fork notes

This is a personal fork of [nodepad](https://github.com/mskayyali/nodepad).
Use DeepWiki and Ref MCP tools before reading the full codebase — they save tokens significantly.

## MCP tools to use first

### DeepWiki — ask questions about the upstream repo
The original repo is indexed by DeepWiki. Before exploring files manually, ask:
```
mcp__deepwiki__ask_question({ repo: "mskayyali/nodepad", question: "..." })
```
Use this to understand architecture, component relationships, and feature intent without reading every file.

### Ref — check API docs before implementing
When working with external APIs (Gemini, OpenAI, Next.js), use Ref to verify endpoint signatures, params, and response shapes before writing code:
```
mcp__Ref__ref_search_documentation("gemini chat completions response format")
mcp__Ref__ref_read_url("https://...")
```

## Provider architecture

All AI calls go **browser → provider API** directly (no server proxy). The abstraction lives in `lib/ai-settings.ts`:

- `AIProvider` = `"openai" | "gemini"`
- `AI_PROVIDER_PRESETS` maps each provider to its base URL, key URL, and key placeholder
- `getModelsForProvider(provider)` returns the model list for a given provider
- `getBaseUrl(config)` + `getProviderHeaders(config)` are used in every `fetch()` call
- Settings are persisted in `localStorage` under `"nodepad-ai-settings"`

**Current default:** Google Gemini (`gemini-3.1-flash-lite-preview`) — free tier on AI Studio.

## Key files

| File | Purpose |
|---|---|
| `lib/ai-settings.ts` | Provider config, model lists, settings hook, localStorage |
| `lib/ai-enrich.ts` | Note enrichment — calls `/chat/completions`, handles grounding |
| `lib/ai-ghost.ts` | Ghost synthesis — lighter model call, returns emergent thesis |
| `app/api/fetch-url/route.ts` | Server route: proxies URL metadata fetches (SSRF-protected) |
| `next.config.mjs` | CSP headers — `connect-src` must allowlist any new AI provider URL |

## Gemini grounding (web search)

Gemini grounding is passed via `extra_body` on the fetch request body:
```ts
{ google: { tools: [{ google_search: {} }] } }
```
This is experimental on the OpenAI-compatible endpoint — it may silently degrade if not supported. `supportsGrounding: true` on the model definition controls whether it's attempted.

## TypeScript build errors

`next.config.mjs` has `typescript: { ignoreBuildErrors: true }`. This is intentional — the project uses `"use client"` files that import server-incompatible things. Do not remove this flag.

## GitHub Pages deployment

See `.github/workflows/deploy.yml`. The workflow uses Next.js static export (`output: 'export'` in `next.config.mjs`), which outputs to `/out`.

**Important constraint:** Static export breaks `app/api/fetch-url/route.ts` (Next.js API routes don't work on static hosts). When deploying to GitHub Pages, URL metadata prefetching for `reference`-type notes will silently fail — `fetchUrlMetaViaServer()` in `lib/ai-enrich.ts` returns `null` and the enrichment falls back to URL-structure-only annotation. This is acceptable degradation.

To enable static export, add `output: 'export'` to `next.config.mjs`:
```js
const nextConfig = {
  output: 'export',
  // ...rest
}
```
This is **not currently set** — the app runs in full Next.js mode locally and on Vercel. Only add it if you actually want to build for Pages.

## CSP — adding a new AI provider

If you add a new provider, add its base domain to `connect-src` in `next.config.mjs`. Current allowlist:
- `https://api.openai.com`
- `https://generativelanguage.googleapis.com`
- `https://cloud.umami.is` / `https://api-gateway.umami.dev` (analytics)
