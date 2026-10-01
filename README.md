# Dev

Dev is an experimental pump.fun launch workspace with a tweet feed beside a compact token-deploy panel, an OpenRouter model catalog, tracked developer wallets, and capped instant-launch sessions. The Overview view follows Sweep's typography and layout.

## Run locally

Use Node.js 24 or later.

```powershell
npm ci
node scripts/init-local.mjs
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_broad_apocalypse.sql
npm run dev -- --hostname 127.0.0.1
```

Apply the migration only to a new local database. Open the URL printed by the server. Local Sign in uses the starter's development-only identity; hosted Sites use ChatGPT sign-in with server-side per-user ownership.

## Connections

Use **Use my API key** in the terminal. OpenRouter supports its account authorization flow or your existing API key. Keys are encrypted server-side, never sent to an AI prompt, and never saved in browser storage.

- **OpenRouter:** generation credits and a model with tool support.
- **X:** an app-only bearer token from the X Developer Console, recent-search access, and prepaid X API credits. The token is marked saved until a successful refresh verifies access. The tracker uses owner-scoped `since_id` checkpoints and paginates a bounded batch of ten posts per due tracker; it preserves unfinished pages, isolates failed queries, and respects provider retry windows. Auto-refresh is opt-in every two minutes while the terminal/tracker is visible. This is polling, not a persistent stream.
- **TwitterAPI.io:** an alternative using its own API key and credits. Save the key, then choose **Use for tweet feed**. Each refresh fetches at most one page of 20 posts; each tracker waits at least two minutes between reads. The first search covers the previous hour. Frozen time windows, pagination, deduplication, isolated query failures, and a shared-key request gate preserve progress across refreshes. Search coverage depends on the provider index. Dev never switches providers automatically.
- **Pinata:** JWT for publishing coin artwork and metadata to public IPFS.
- **Solana RPC:** HTTPS mainnet RPC for preparing, simulating, and confirming launches. For capped launches, the node must return simulation preBalances and postBalances. Public wallet scans fall back to the official public RPC, which can rate-limit or reject requests.

The selected developer wallet is **bwamJzztZsepfkteWRChggmXuiiCQvpLqPietdNfSXa**. It is a tracked source only, never a fee recipient. Identity and performance are not inferred from the address.

Wallet scans examine the latest twelve transactions and store recognized Pump/PumpSwap buys and sells, launches, token changes, and source transaction links. Matched buy/sell results require complete observed token-account round trips; transfers, missing transactions, and ambiguous multi-swap activity are excluded. The display reports sampled SOL cash flow and holding time, not lifetime profit or proof of a wallet owner's motivation. **Create a dev from this wallet** prepares a research mission grounded in those observations.

## Launch behavior

The application builds official pump.fun create_v2 instructions through @pump-fun/pump-sdk. This on-chain route needs no separate Pump API key. It does not buy tokens on creation. Normal launches require the connected injected Phantom wallet to sign. Network fees and account rent are simulated first. A submitted transaction is shown separately from a confirmed coin.

Instant mode uses a dedicated, server-controlled encrypted wallet. The user creates, funds, and explicitly enables a session with a 24-hour expiry, total SOL cap, per-launch cap, and maximum launch count. The main wallet's private key is never requested. A stop button disables further launches, and remaining SOL can be returned only to the fixed recipient chosen when the session was created. Reserved budget is not automatically refunded after ambiguous submissions.

While Dev is open, enabled sessions refresh sources and run every two minutes. It is not a 24/7 hosted worker or a subsecond launch guarantee. No wallet is funded or session enabled by this project.

The execution log shows real tool actions and concise decision summaries. It does not request or expose private chain-of-thought.

## Dev thesis room

The Overview homepage includes an animated critique of opaque, repetitive launches after the three-step introduction. It pauses outside the viewport, offers pause/manual controls, and respects reduced-motion preferences. Both supplied wallet screenshots are displayed unchanged and uncropped, with full-size links: bwa reports +$21.9M and kreo reports +$2.93M. These are dated-unknown supplied snapshots, not verified live performance. The general market critique does not assert misconduct by the pictured wallets; kreo's incomplete address is not used for tracking.

The terminal now includes provider logos sourced from OpenRouter's public catalog and provider pages. Exact image provenance is in `public/model-icons/sources.json`; unsupported provider images use the OpenRouter mark. The selected model, model cards, and dev avatars share those images.

Enter a narrative, ticker, or mint in **Dev thesis**. Choose one model for three AI perspectives, or select up to three of your saved devs. Each round performs three bounded OpenRouter calls and streams completed public contributions from an analyst, critic, and editor. Saved dev missions influence their creative preferences. The initial conversation is clearly marked as an illustrative preview until a real round runs.

The room reads up to 12 saved tweet/wallet signals and a fresh, bounded DexScreener search sample. It does not refresh X or wallet trackers itself; source timestamps and search coverage are shown. The roles compare other coins, challenge a competing narrative (a “vamp” angle), and propose a differentiated concept. A second search checks the candidate name against up to eight returned pairs. “Not found in the searched sample” never means proven original or unused.

Pairing recommendations describe a narrative/community fit, not an endorsement, partnership, or additional market. The executable launch quote remains SOL. **Send to launch terminal** imports an idempotent draft with its thesis and source links; it never calls the automatic launch route. A new round can continue the latest completed discussion with fresh market data. The latest complete round is saved per owner; interrupted replies remain visible during the current visit and do not replace the saved completed round.

An OpenRouter connection is required to generate real discussions. Each round is limited to three replies of at most 1,200 output tokens each, with request timeouts and per-owner concurrency/throttle controls. Model choice determines credit use. No paid model request or on-chain action is made by the automated checks.

## Main coin support

A main mint and treasury are intentionally unset. A main mint is optional for operating-budget support. Users can configure a proposed share of each created coin's creator fees, then separately review and confirm a permanent on-chain fee-sharing setup after that coin is confirmed. The setup cannot be silently changed. This is a share of creator fees, not a share of all trading volume. No automatic buyback, burn, token gate, or return guarantee is implemented.

The fee setup is a separate transaction because a basic combined create-plus-fee-setup transaction exceeds the standard transaction size without an address lookup table. Graduated coins may require setup through pump.fun. A fee setup is active only after on-chain confirmation.

Confirmed SOL fee splits have a **Preview fee distribution** flow. It verifies on-chain recipients, simulates an unsigned transaction, and asks the connected wallet to sign. A verified graduated PumpSwap pool's accumulated SOL fees are swept before distribution when its fee vault exists. Estimates are snapshots; confirmation matches the exact prepared message and reports actual treasury lamport receipts. A missing signature is not a payout, and dropped transactions expire only after finalized block expiry and a history check. Non-SOL and holder-reward configurations are not supported by this collector.

## Funding model usage

Personal OpenRouter connections continue to pay from the user's account. Optional Dev-sponsored access uses a server-only OpenRouter **Management API key** to provision one encrypted, provider-capped inference key per approved authenticated owner. Management keys cannot run inference themselves. Configure `DEV_SPONSORED_AI_ENABLED`, `OPENROUTER_MANAGEMENT_KEY`, `DEV_SPONSORED_AI_OWNERS`, and `DEV_SPONSORED_AI_DAILY_USD` as documented in `.env.example`. No public auto-enrollment or unlimited fallback is enabled. A personal key takes precedence; a broken personal key never silently spends platform credits.

Daily child-key caps reset at midnight UTC. They bound the approved allowance, not a funded balance. The platform OpenRouter account needs credits before inference can run. Uncertain provisioning is durably blocked to prevent duplicate keys and budgets; an operator must reconcile the named attempt with OpenRouter before resetting it. Do not use the normal personal connection field for a management key.

The intended funding flow is creator-fee distribution → treasury → operating budget → OpenRouter credit purchase → model usage. The current OpenRouter crypto-credit API has been removed; replenishment uses its supported credits checkout, separately from Solana fee distribution. No automatic conversion or credit purchase is implemented. Startup credit and network-fee funding is still required before fee revenue exists.

## Storage and deployment

Cloudflare Worker-compatible Vinext app, D1 database. Schema and generated migration are included. .dev.vars, .wrangler runtime data, API credentials, and launch-wallet keys are excluded from the repository. Each installation needs its own credentials and database.

To publish with Sites, register the project once, preserve its D1 binding, set CREDENTIAL_SECRET as a host secret, and use the Sites deployment flow. Do not expose the development server or development sign-in to the public internet.

## Verification

- TypeScript check and production Worker build.
- Local API checks for authentication, forged identity, cross-origin writes, persistence, bad wallet input, bad fee percentages, and missing-key handling.
- Offline official-SDK create transaction inspection; no RPC or broadcasts.
- Spending-cap arithmetic fails closed when simulation data is unavailable.
- Live OpenRouter catalog verified (375 tool-capable models at build time).
- Fifteen isolated thesis regression tests cover scoped evidence, continuations, concurrent leases, streamed failures, Unicode name matching, and idempotent draft import. Model HTTP replies are fixtures; these tests do not spend credits.
- OpenRouter OAuth and one bounded live GPT-4.1 Nano inference call were verified during development.
- A live TwitterAPI.io search fetched 20 posts; a live research run read saved tweets and created a draft proposal. No token was deployed by that check.
- Nine isolated TwitterAPI.io tests cover bounded pagination, deduplication, concurrent request limits, malformed responses, fair query selection, retry windows, key replacement, and persistence failures.
- IPFS uploads, funded launch simulations, fee routing, and on-chain submissions still require the missing connections and funding; they have not been exercised live.
- The public Solana endpoint returned 403 in this environment; configure a dedicated RPC for reliable wallet scans. Seventeen offline wallet tests cover transaction attribution, incomplete data, matched cash flow, and scanner persistence.

```powershell
npx tsc --noEmit
node --test scripts/limits.test.mjs
node scripts/transaction-check.mjs
node --test scripts/thesis-import.test.mjs scripts/thesis-regression.test.mjs
node --test scripts/ai-access.test.mjs scripts/ai-check.test.mjs scripts/twitter-tracker.test.mjs
node --test scripts/twitterapi.test.mjs
node --test scripts/fee-distribution.test.mjs scripts/wallet-analysis.test.mjs
node scripts/thesis-smoke.mjs
```

The smoke script creates temporary test devs in the local database; it is intended for a disposable development workspace.

## Primary integration references

- https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request
- https://openrouter.ai/docs/guides/overview/auth/oauth
- https://docs.dexscreener.com/api/reference
- https://docs.x.com/x-api/posts/search/quickstart/recent-search
- https://docs.twitterapi.io/api-reference/endpoint/tweet_advanced_search
- https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/COIN_CREATION.md
- https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/CREATOR_FEE_SHARING.md
- https://docs.pinata.cloud/api-reference/endpoint/upload-a-file
- https://solana.com/docs/rpc/http/simulatetransaction

Typography uses Syne, Geist and Geist Mono from the reference site's public font assets.

