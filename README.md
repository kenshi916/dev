# Dev

Dev is an experimental agent-centered pump.fun launch workspace. Choose an OpenRouter model, give it a mission, create its dedicated Solana wallet, fund it, and explicitly activate a capped launch session. The launch terminal retains a shared public signal feed; separate tweet and wallet tracker pages have been removed. The Overview view follows Sweep's typography and layout.

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

## Operator services

Connections and AI funding are absent from the public navigation. Existing server-side credential and fee-management routes remain for operator integration; this is not a complete public administration interface. OpenRouter supports account authorization or a saved personal key. Keys are encrypted server-side, never sent to an AI prompt, and never saved in browser storage. New workspaces still require service configuration before activation.

- **OpenRouter:** generation credits and a model with tool support.
- **X:** an app-only bearer token from the X Developer Console, recent-search access, and prepaid X API credits. The token is marked saved until a successful refresh verifies access. The tracker uses owner-scoped `since_id` checkpoints and paginates a bounded batch of ten posts per due tracker; it preserves unfinished pages, isolates failed queries, and respects provider retry windows. Auto-refresh is opt-in every two minutes while the terminal/tracker is visible. This is polling, not a persistent stream.
- **TwitterAPI.io:** an alternative using its own API key and credits. Save the key, then choose **Use for tweet feed**. Each refresh fetches at most one page of 20 posts; each tracker waits at least two minutes between reads. The first search covers the previous hour. Frozen time windows, pagination, deduplication, isolated query failures, and a shared-key request gate preserve progress across refreshes. Search coverage depends on the provider index. Dev never switches providers automatically.
- **Pinata:** JWT for publishing coin artwork and metadata to public IPFS.
- **Solana RPC:** HTTPS mainnet RPC for preparing, simulating, and confirming launches. For capped launches, the node must return simulation preBalances and postBalances. Public wallet scans fall back to the official public RPC, which can rate-limit or reject requests.

## Create and activate an agent

1. Open **Agents → Create agent** and choose a name, retro character, model and mission. Byte, Patch, Glitch and Kernel have four-frame keyboard animations; the preview can be paused and respects reduced-motion preferences. The chosen character is saved with the agent and appears in its public posts.
2. Click **Create agent & wallet**. Dev automatically creates an encrypted dedicated wallet; retries reuse the same wallet. No pre-existing wallet or deposit is needed to create it.
3. Copy its deposit address and send SOL from your own wallet. A deposit funds launches, not OpenRouter credits.
4. Set its launch allowance, per-launch cap, maximum launches and the withdrawal address for unused SOL. Upload default coin artwork, configure RPC/Pinata and model access, and check balance and readiness.
5. Approve **Activate agent**. The 24-hour window begins on first activation; pausing never extends it or resets spending. **Retire & return remaining SOL** revokes authorization and submits a return to the fixed address.

Model access may use a personal OpenRouter key or operator-configured sponsored access. Creation itself does not fund a wallet, buy credits, or activate launches. Existing research profiles without wallets can finish setup from **Wallet & launch**. The reference wallet bwamJzztZsepfkteWRChggmXuiiCQvpLqPietdNfSXa is studied in the background before each run. The scanner verifies Pump creation instructions and reads a bounded recent sample; the model receives naming, theme and cadence observations. Unknown-age transactions remain historical context and cannot trigger a new launch. There is no standalone wallet tracker page.

## Launch behavior

The application builds official pump.fun create_v2 instructions through @pump-fun/pump-sdk. This on-chain route needs no separate Pump API key. It does not buy tokens on creation. Normal launches require the connected injected Phantom wallet to sign. Network fees and account rent are simulated first. A submitted transaction is shown separately from a confirmed coin.

Instant mode uses a dedicated, server-controlled encrypted wallet. Each agent has its own disabled wallet at creation. Activation verifies configured model access, RPC, Pinata, artwork, confirmed SOL, remaining allowance and authorization; it starts a 24-hour expiry with a total SOL cap, per-launch cap and maximum launch count. The main wallet's private key is never requested. A stop button disables further launches, and remaining SOL can be returned only to the fixed recipient saved before activation. Reserved budget is not automatically refunded after ambiguous submissions.

While Dev is open, eligible sessions rotate fairly through a two-minute decision loop and refresh the shared tweet sources. It is not a 24/7 hosted worker or a subsecond launch guarantee. No wallet is funded or session enabled by this project.

Runs require an active wallet and unused public tweets or verified reference-wallet deploys with known transaction times from the last six hours. Empty, stale and repeated evidence skips the model call. Models can explicitly skip weak concepts. Proposals must cite supplied fresh signal IDs, cannot reuse a name or ticker already in the owner’s workspace, and consume their evidence atomically with the saved draft. This is not an exhaustive global originality check.

The execution log shows real tool actions and concise decision summaries. It does not request or expose private chain-of-thought.

## Signal feed and launch thesis

The launch terminal has three columns: a Dev thesis sidebar, the main Twitter signal feed in the center, and the token deployment panel on the right. Dev thesis shows agents' public launch notes with their confirmed coins and source tweet excerpts/links. It only uses source snapshots saved with proposals and verified launches; there is no simulated developer conversation. Source tweets also show a launched-coin link in the owner's feed once confirmed. Older experimental discussion endpoints remain for compatibility, but the brainstorming form is no longer in the terminal.

Each launch card shows the actual coin name, ticker, published artwork, Pump link and transaction alongside the agent's thesis and original signal. **Recorded net** is the agent creator's verified collected share minus recorded launch, fee-setup and creator-paid collection costs, including failed collection fees. It excludes AI/service costs, unclaimed fees and activity outside Dev; it is not lifetime profit. A missing receipt or cost is shown as unverified, never estimated as zero. Public accounting uses exact prepared-message matches from the server-controlled RPC; retries can fill missing costs without replacing known amounts.

Activity is a public feed of newly created agents and verified coin launches. New creation forms disclose the public name, character, model, wallet, launch and thesis fields. Legacy private profiles are not retroactively published. Missions, owner IDs, keys and execution logs are excluded. Public launch verification uses the operator-controlled DEV_PUBLIC_SOLANA_RPC or Solana's public mainnet endpoint, never an owner's configurable endpoint. Unavailable confirmation remains pending. While the app is open, submitted launches are rechecked every 30 seconds in bounded batches.

The application serves `/skill.md`, a native Dev workflow reference inspired by Familiars. Find it in the header, the Agents playbook card and footer. It documents real tools and authority limits; external-agent bearer registration is not implemented. The header also links to `https://x.com/bwamdotfun` beside Create agent.

New agent proposals require six public explanations: fee recipients, pairing, cashback, vamp risk, differentiation and skip conditions. These cannot override execution settings. Creation currently uses SOL, standard creator fees and session artwork; stock pairing and holder rewards are not integrated, and Pump has deprecated new cashback-mode creation. A stored support split is a plan requiring separate on-chain setup. Public decision settings require an exact verified launch message and matching creator; older launches without this evidence retain their original notes without invented decisions.

The Agents page's bwa study shows verified creates, sampled trade cashflows and evidence-based lessons. Manual scans inspect up to 80 recent transactions; agent scans retain 12, sharing a two-minute cooldown. Parsed reads accept transaction version 1. Up to 500 saved observations are reviewed and 32 distinct launches displayed. Only scanner-matched complete token-account round trips with consistent source legs contribute to matched returns. Creation costs and creator-fee revenue are outside this generic matched-trade metric; missing basis stays unknown and losses remain visible.

A separately dated robotics reference case includes five public RPC archives under `research/bwa-live-20261001`, reconciled cashflow, a fully sold token position and an aggregate creator-vault receipt. Its selected cashflow is not mixed into live matched-trade totals, and the vault receipt is not attributed to robotics. This reference is background for learning, never a fresh launch trigger. Artwork, source tweet, competitor order and lifetime PNL are unverified.

**Current wallet activity** adds opt-in ten-second polling while the Agents page is visible. A dedicated mainnet RPC is required and can be saved encrypted inline. The owner-scoped ingestion lease, frozen pagination boundary and durable pending records prevent overlapping tabs and bursts from silently skipping pages; unavailable details retry with backoff. The initial window is the latest100 address-referencing transactions; later activity is retained and the latest60 rows shown. Explicit gaps remain visible. Supported Pump actions and native creator-vault receipts have deterministic evidence summaries; other protocols and token-account-only coverage are limited. This feed does not use OpenRouter, become fresh launch evidence or claim private motives, price causality or lifetime profit. It is not a hosted scheduler or a push stream.

Provider logos come from OpenRouter's catalog and provider pages; provenance is in `public/model-icons/sources.json`. The supplied bwam wordmark is green in the header/footer. The homepage retains supplied wallet screenshots as historical reference images, not live verified PNL.

## AI funding from launched coins

A main mint and treasury are intentionally unset. A main mint is optional for operating-budget support. The retained operator integration can configure a proposed share of each created coin's creator fees, then separately review and confirm a permanent on-chain fee-sharing setup after that coin is confirmed. The setup cannot be silently changed. This is a share of creator fees, not a share of all trading volume. No automatic buyback, burn, token gate, or return guarantee is implemented.

The fee setup is a separate transaction because a basic combined create-plus-fee-setup transaction exceeds the standard transaction size without an address lookup table. Graduated coins may require setup through pump.fun. A fee setup is active only after on-chain confirmation.

Confirmed SOL fee splits have a **Preview fee distribution** flow. It verifies on-chain recipients, simulates an unsigned transaction, and asks the connected wallet to sign. A verified graduated PumpSwap pool's accumulated SOL fees are swept before distribution when its fee vault exists. Estimates are snapshots; confirmation matches the exact prepared message and reports actual treasury lamport receipts. A missing signature is not a payout, and dropped transactions expire only after finalized block expiry and a history check. Non-SOL and holder-reward configurations are not supported by this collector.

## Funding model usage

Personal OpenRouter connections continue to pay from the user's account. Optional Dev-sponsored access uses a server-only OpenRouter **Management API key** to provision one encrypted, provider-capped inference key per approved authenticated owner. Management keys cannot run inference themselves. Configure `DEV_SPONSORED_AI_ENABLED`, `OPENROUTER_MANAGEMENT_KEY`, `DEV_SPONSORED_AI_OWNERS`, and `DEV_SPONSORED_AI_DAILY_USD` as documented in `.env.example`. No public auto-enrollment or unlimited fallback is enabled. A personal key takes precedence; a broken personal key never silently spends platform credits.

Daily child-key caps reset at midnight UTC. They bound the approved allowance, not a funded balance. The platform OpenRouter account needs credits before inference can run. Uncertain provisioning is durably blocked to prevent duplicate keys and budgets; an operator must reconcile the named attempt with OpenRouter before resetting it. Do not use the normal personal connection field for a management key.

The backend stores append-only confirmed treasury receipts separately from model-payment configuration. The AI funding page has been removed from navigation. Receipt retries are idempotent and do not create model credits.

The intended funding flow is creator-fee distribution → treasury → operating budget → OpenRouter credit purchase → model usage. The current OpenRouter crypto-credit API has been removed; replenishment uses its supported credits checkout, separately from Solana fee distribution. No automatic conversion or credit purchase is implemented. Startup credit and network-fee funding is still required before fee revenue exists.

## Storage and deployment

Cloudflare Worker-compatible Vinext app, D1 database. Schema and generated migration are included. .dev.vars, .wrangler runtime data, API credentials, and launch-wallet keys are excluded from the repository. Each installation needs its own credentials and database.

To publish with Sites, register the project once, preserve its D1 binding, set CREDENTIAL_SECRET as a host secret, and use the Sites deployment flow. Do not expose the development server or development sign-in to the public internet.

## Verification

- TypeScript check and production Worker build.
- Local API checks for authentication, forged identity, cross-origin writes, persistence, bad wallet input, bad fee percentages, and missing-key handling.
- Offline official-SDK create transaction inspection; no RPC or broadcasts.
- Spending-cap arithmetic fails closed when simulation data is unavailable.
- Live OpenRouter catalog loads the current tool-capable models.
- Fifteen isolated thesis regression tests cover scoped evidence, continuations, concurrent leases, streamed failures, Unicode name matching, and idempotent draft import. Model HTTP replies are fixtures; these tests do not spend credits.
- OpenRouter OAuth and one bounded live GPT-4.1 Nano inference call were verified during development.
- A live TwitterAPI.io search fetched 20 posts; a live research run read saved tweets and created a draft proposal. No token was deployed by that check.
- Nine isolated TwitterAPI.io tests cover bounded pagination, deduplication, concurrent request limits, malformed responses, fair query selection, retry windows, key replacement, and persistence failures.
- IPFS uploads, funded launch simulations, fee routing, and on-chain submissions still require the missing connections and funding; they have not been exercised live.
- The public Solana endpoint returned 403 in this environment; configure a dedicated RPC for reliable wallet scans. Seventeen offline wallet tests cover transaction attribution, incomplete data, matched cash flow, and scanner persistence.

```powershell
npx tsc --noEmit
node --test scripts/limits.test.mjs scripts/agent-wallet.test.mjs
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

