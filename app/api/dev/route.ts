import {
  AppError,
  body,
  change,
  db,
  event,
  external,
  fail,
  httpsPublic,
  id,
  now,
  one,
  rows,
  secret,
  setSecret,
  setSetting,
  setting,
  textValue,
  userId,
} from "../../server/core";
import { PublicKey } from "@solana/web3.js";
import { aiAccessStatus } from "../../server/ai-access";
import {
  normalizeTwitterToken,
  resetTwitterStatus,
} from "../../server/twitter";
import { readTwitterStatus, refreshTweets } from "../../server/twitter-provider";
import { normalizeTwitterApiKey, resetTwitterApiStatus } from "../../server/twitterapi";
function pubkey(v: string) {
  try {
    return new PublicKey(v);
  } catch {
    throw new AppError("Enter a valid Solana wallet address.");
  }
}
const confirmLaunch = async (...args: any[]) => {
  const m: any = await import("../../server/launch");
  return m.confirmLaunch(...args);
};
const createSession = async (...args: any[]) => {
  const m: any = await import("../../server/launch");
  return m.createSession(...args);
};
const createTx = async (...args: any[]) => {
  const m: any = await import("../../server/launch");
  return m.createTx(...args);
};
const withdrawSession = async (...args: any[]) => {
  const m: any = await import("../../server/launch");
  return m.withdrawSession(...args);
};
const prepareSupport = async (...args: any[]) => {
  const m: any = await import("../../server/support");
  return m.prepareSupport(...args);
};
const submitSupport = async (...args: any[]) => {
  const m: any = await import("../../server/support");
  return m.submitSupport(...args);
};
const checkSupport = async (...args: any[]) => {
  const m: any = await import("../../server/support");
  return m.checkSupport(...args);
};
import {
  refreshWallets,
  TRACKED_WALLET,
} from "../../server/signals";
export async function GET() {
  try {
    const owner = await userId();
    // Only stale run locks are recovered; spending reservations are never reset.
    await change(
      "UPDATE agents SET status='ready' WHERE owner=? AND status IN ('running','stopping') AND updated_at<?",
      owner,
      new Date(Date.now() - 600000).toISOString(),
    );
    const [
      agents,
      events,
      drafts,
      tracks,
      signals,
      connections,
      sessions,
      support,
    ] = await Promise.all([
      rows(
        "SELECT * FROM agents WHERE owner=? ORDER BY updated_at DESC",
        owner,
      ),
      rows(
        "SELECT * FROM events WHERE owner=? ORDER BY created_at DESC LIMIT 100",
        owner,
      ),
      rows(
        "SELECT id,agent_id,name,symbol,description,rationale,status,image_url,metadata_uri,mint,signature FROM drafts WHERE owner=? ORDER BY created_at DESC LIMIT 100",
        owner,
      ),
      rows("SELECT * FROM tracks WHERE owner=?", owner),
      rows(
        "SELECT * FROM signals WHERE owner=? ORDER BY created_at DESC LIMIT 100",
        owner,
      ),
      rows("SELECT provider FROM secrets WHERE owner=?", owner),
      rows(
        "SELECT agent_id,public_key,enabled,max_lamports,per_launch,max_launches,used_lamports,used_launches,expires_at,image_url,recipient FROM sessions WHERE owner=?",
        owner,
      ),
      setting(owner, "support", { mint: "", treasury: "", percentage: 20 }),
    ]);
    return Response.json(
      {
        agents,
        events,
        drafts,
        tracks: tracks.filter((t) => t.kind === "tweet"),
        wallets: tracks.filter((t) => t.kind === "wallet"),
        tweets: signals
          .filter((s) => s.kind === "tweet")
          .map((s) => ({ ...s, author: s.source })),
        walletSignals: signals.filter((s) => s.kind === "wallet"),
        connections: Object.fromEntries(
          connections.map((c) => [c.provider, true]),
        ),
        aiAccess: await aiAccessStatus(owner),
        twitterStatus: await readTwitterStatus(owner),
        sessions,
        support,
        supportStatus: await rows(
          "SELECT key,value FROM settings WHERE owner=? AND key LIKE 'support_%'",
          owner,
        ),
        sessionImage: await setting(owner, "session_image"),
        deployStudy: await setting(owner, "deploy_study"),
        feeReceipts: (await rows("SELECT value FROM settings WHERE owner=? AND key LIKE 'fee_receipt_%'", owner)).map(r => JSON.parse(r.value)),
        walletReadiness: Object.fromEntries((await rows(
          "SELECT key,value FROM settings WHERE owner=? AND key LIKE 'wallet_readiness_%'", owner,
        )).map((r) => [r.key.slice("wallet_readiness_".length), JSON.parse(r.value)])),

      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}
export async function POST(request: Request) {
  try {
    const owner = await userId(),
      b = await body(request);
    let result: any = { ok: true };
    switch (b.action) {
      case "check_ai": {
        const { aiConnectionCheck } = await import("../../server/ai-check");
        result = await aiConnectionCheck(
          owner,
          b.model ? textValue(b.model, 180) : undefined,
        );
        break;
      }
      case "import_thesis": {
        const discussionId = textValue(b.discussionId, 100);
        const discussion = await setting(owner, "thesis_latest");
        if (
          discussion?.id !== discussionId ||
          discussion.status !== "complete" ||
          !discussion.proposal
        )
          throw new AppError(
            "This completed thesis is no longer available.",
            409,
          );
        const proposal = discussion.proposal;
        const name = textValue(proposal.name, 32),
          symbol = textValue(proposal.symbol, 13).toUpperCase(),
          description = textValue(proposal.description, 2000),
          model = textValue(discussion.models?.at(-1), 150);
        if (!/^[A-Z0-9]+$/.test(symbol) || proposal.quoteAsset !== "SOL")
          throw new AppError(
            "This thesis is not a supported SOL coin proposal.",
          );
        const excerpt = (value: unknown, maximum: number) =>
          typeof value === "string" ? value.trim().slice(0, maximum) : "";
        let rationale = [
          "Dev thesis " + discussionId,
          "Thesis: " + excerpt(proposal.thesis, 800),
          "Differentiation: " + excerpt(proposal.differentiation, 650),
          "Novelty check: " + excerpt(proposal.novelty, 450),
          "Narrative pairing: " +
            excerpt(proposal.pairing?.candidate, 150) +
            ". " +
            excerpt(proposal.pairing?.reason, 350) +
            " Market quote: SOL; initial purchase: 0 SOL.",
        ].join("\n\n");
        const sourceUrls = new Set<string>();
        for (const source of Array.isArray(discussion.sources)
          ? discussion.sources
          : []) {
          if (typeof source?.url !== "string" || sourceUrls.has(source.url))
            continue;
          const line = "\nSource: " + source.url;
          if (rationale.length + line.length <= 4000) {
            rationale += line;
            sourceUrls.add(source.url);
          }
        }
        const digest = new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(JSON.stringify([owner, discussionId])),
          ),
        );
        const suffix = Array.from(digest, (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
        const agentId = "thesis-agent-" + suffix,
          draftId = "thesis-draft-" + suffix,
          createdAt = now();
        await db().batch([
          db()
            .prepare(
              "INSERT OR IGNORE INTO agents (id,owner,name,mission,model,status,updated_at) VALUES (?,?,?,?,?,?,?)",
            )
            .bind(
              agentId,
              owner,
              "Thesis studio",
              excerpt(discussion.topic, 3000) || "Manually imported Dev thesis",
              model,
              "ready",
              createdAt,
            ),
          db()
            .prepare(
              "INSERT OR IGNORE INTO drafts (id,owner,agent_id,name,symbol,description,rationale,status,created_at) SELECT ?,?,?,?,?,?,?,?,? FROM agents WHERE id=? AND owner=?",
            )
            .bind(
              draftId,
              owner,
              agentId,
              name,
              symbol,
              description,
              rationale,
              "draft",
              createdAt,
              agentId,
              owner,
            ),
        ]);
        result = await one(
          "SELECT id,agent_id,name,symbol,description,rationale,status,image_url FROM drafts WHERE id=? AND owner=? AND agent_id=?",
          draftId,
          owner,
          agentId,
        );
        if (!result)
          throw new AppError(
            "This thesis proposal could not be imported.",
            409,
          );
        break;
      }
      case "save_studio_draft": {
        const name = textValue(b.name, 32),
          symbol = textValue(b.symbol, 13).toUpperCase(),
          description = textValue(b.description, 2000);
        if (!/^[A-Z0-9]+$/.test(symbol))
          throw new AppError("Use an alphanumeric symbol.");
        const website = b.website ? httpsPublic(b.website) : "",
          twitter = b.twitter ? httpsPublic(b.twitter) : "";
        let d = b.id
          ? await one(
              "SELECT * FROM drafts WHERE id=? AND owner=?",
              b.id,
              owner,
            )
          : null;
        if (b.id && !d) throw new AppError("Proposal not found.");
        if (d?.signature || d?.status === "preparing")
          throw new AppError("This proposal is already being launched.");
        if (d) {
          await change(
            "UPDATE drafts SET name=?,symbol=?,description=?,metadata_uri=NULL WHERE id=? AND owner=?",
            name,
            symbol,
            description,
            d.id,
            owner,
          );
        } else {
          const aid = id();
          await change(
            "INSERT INTO agents (id,owner,name,mission,model,status,updated_at) VALUES (?,?,?,?,?,?,?)",
            aid,
            owner,
            "Token studio",
            "User-created token proposal",
            textValue(b.model, 150),
            "ready",
            now(),
          );
          const did = id();
          await change(
            "INSERT INTO drafts (id,owner,agent_id,name,symbol,description,rationale,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
            did,
            owner,
            aid,
            name,
            symbol,
            description,
            "Manually reviewed in Token Deploy.",
            "draft",
            now(),
          );
          d = { id: did };
        }
        await setSetting(owner, "links_" + d.id, { website, twitter });
        result = await one(
          "SELECT id,agent_id,name,symbol,description,rationale,status,image_url FROM drafts WHERE id=? AND owner=?",
          d.id,
          owner,
        );
        break;
      }
      case "create_agent_wallet": {
        const { createAgentWallet } = await import("../../server/agent-wallet");
        result = await createAgentWallet(owner, b);
        break;
      }
      case "check_session": {
        const { sessionReadiness } = await import("../../server/agent-wallet");
        result = await sessionReadiness(owner, textValue(b.agentId, 100));
        break;
      }
      case "study_deploys": {
        const { studyDeploys } = await import("../../server/deploy-study");
        result = await studyDeploys(owner);
        break;
      }
      case "configure_agent_wallet": {
        const { configureAgentWallet } = await import("../../server/agent-wallet");
        result = await configureAgentWallet(owner, textValue(b.agentId, 100), b);
        break;
      }
      case "create_agent": {
        const name = textValue(b.name, 60),
          mission = textValue(b.mission, 3000, 12),
          model = textValue(b.model, 150);
        if (
          (await rows("SELECT id FROM agents WHERE owner=?", owner)).length >=
          20
        )
          throw new AppError("This workspace supports up to 20 devs.");
        const agentId = id();
        await change(
          "INSERT INTO agents (id,owner,name,mission,model,status,updated_at) VALUES (?,?,?,?,?,?,?)",
          agentId,
          owner,
          name,
          mission,
          model,
          "ready",
          now(),
        );
        await event(
          owner,
          agentId,
          "created",
          name + " created with " + model + ".",
        );
        result = { id: agentId };
        break;
      }
      case "save_connection": {
        const p = b.provider;
        if (!["openrouter", "x", "twitterapi", "pinata", "rpc"].includes(p))
          throw new AppError("Unknown connection.");
        let value = textValue(b.value, 4096, 8);
          if (p === "x") value = normalizeTwitterToken(value);
          if (p === "twitterapi") value = normalizeTwitterApiKey(value);
        if (p === "rpc") {
          value = httpsPublic(value);
          const r = await external(
            value,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "getGenesisHash",
                params: [],
              }),
            },
            "RPC",
          );
          const d: any = await r.json();
          if (d.result !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp")
            throw new AppError("Use a Solana mainnet RPC endpoint.");
        }
        if (p === "openrouter")
          await external(
            "https://openrouter.ai/api/v1/key",
            { headers: { Authorization: "Bearer " + value } },
            "OpenRouter",
          );
        if (p === "pinata")
          await external(
            "https://api.pinata.cloud/data/testAuthentication",
            { headers: { Authorization: "Bearer " + value } },
            "Pinata",
          );
        await setSecret(owner, p, value);
          if (p === "x") await resetTwitterStatus(owner);
          if (p === "twitterapi") await resetTwitterApiStatus(owner);
          break;
        }
        case "set_twitter_provider": {
          if (!["x", "twitterapi"].includes(b.provider)) throw new AppError("Choose an available tweet provider.");
          if (!(await one("SELECT provider FROM secrets WHERE owner=? AND provider=?", owner, b.provider))) throw new AppError("Save this provider's key first.");
          await setSetting(owner, "twitter_provider", b.provider);
          break;
        }
        case "disconnect": {
          if (!["openrouter", "x", "twitterapi", "pinata", "rpc"].includes(b.provider))
          throw new AppError("Unknown connection.");
        await change(
          "DELETE FROM secrets WHERE owner=? AND provider=?",
          owner,
          b.provider,
        );
          if (b.provider === "x") await resetTwitterStatus(owner);
          if (b.provider === "twitterapi") await resetTwitterApiStatus(owner);
        break;
      }
      case "add_track":
      case "add_wallet": {
        const kind = b.action === "add_wallet" ? "wallet" : "tweet";
        let query = textValue(b.query, 400);
        if (kind === "wallet") query = pubkey(query).toBase58();
        if (query.startsWith("@") && !/^@[a-zA-Z0-9_]{1,15}$/.test(query))
          throw new AppError("Enter a valid X handle.");
        if (
          (
            await rows(
              "SELECT id FROM tracks WHERE owner=? AND kind=?",
              owner,
              kind,
            )
          ).length >= 5
        )
          throw new AppError("You can track up to 5 sources of this type.");
        if (
          await one(
            "SELECT id FROM tracks WHERE owner=? AND kind=? AND query=?",
            owner,
            kind,
            query,
          )
        )
          throw new AppError("This source is already tracked.");
        await change(
          "INSERT INTO tracks (id,owner,kind,query,label) VALUES (?,?,?,?,?)",
          id(),
          owner,
          kind,
          query,
          typeof b.label === "string"
            ? b.label.slice(0, 60)
            : "Developer wallet",
        );
        break;
      }
      case "remove_track":
        await change("DELETE FROM tracks WHERE id=? AND owner=?", b.id, owner);
        break;
      case "refresh_tweets":
        result = await refreshTweets(owner);
        break;
      case "refresh_wallets":
        result = await refreshWallets(owner);
        break;
      case "cancel_run": {
        await change(
          "UPDATE agents SET status='stopping' WHERE id=? AND owner=? AND status='running'",
          b.agentId,
          owner,
        );
        const { toggleAgentWallet } = await import("../../server/agent-wallet");
        if (await one("SELECT agent_id FROM sessions WHERE agent_id=? AND owner=?", b.agentId, owner))
          await toggleAgentWallet(owner, b.agentId, false);
        break;
      }
      case "edit_draft": {
        const d = await one(
          "SELECT * FROM drafts WHERE id=? AND owner=?",
          b.id,
          owner,
        );
        if (!d || d.signature || d.status === "preparing")
          throw new AppError(
            "Only unsubmitted, unprepared proposals can be edited.",
          );
        const name = textValue(b.name, 32),
          symbol = textValue(b.symbol, 13),
          description = textValue(b.description, 2000);
        if (!/^[A-Za-z0-9]+$/.test(symbol))
          throw new AppError("Symbol must contain only letters and numbers.");
        await change(
          "UPDATE drafts SET name=?,symbol=?,description=?,metadata_uri=NULL,prepared=NULL WHERE id=? AND owner=?",
          name,
          symbol.toUpperCase(),
          description,
          b.id,
          owner,
        );
        break;
      }
      case "prepare_launch": {
        const d = await one(
          "SELECT * FROM drafts WHERE id=? AND owner=?",
          b.draftId,
          owner,
        );
        if (!d || d.signature)
          throw new AppError(
            "This proposal is unavailable or already submitted.",
          );
        result = (await createTx(owner, d, b.wallet)).prepared;
        break;
      }
      case "record_submission": {
        const d = await one(
          "SELECT * FROM drafts WHERE id=? AND owner=?",
          b.draftId,
          owner,
        );
        if (!d?.prepared || d.signature)
          throw new AppError("Launch is unavailable or already submitted.");
        const p = JSON.parse(d.prepared);
        if (
          b.mint !== p.mint ||
          !/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(b.signature)
        )
          throw new AppError("Invalid launch submission.");
        await change(
          "UPDATE drafts SET signature=?,status='submitted' WHERE id=? AND owner=? AND signature IS NULL",
          b.signature,
          b.draftId,
          owner,
        );
        await event(
          owner,
          d.agent_id,
          "launch",
          "Wallet submitted " + d.name + ". Waiting for chain confirmation.",
        );
        break;
      }
      case "confirm_launch":
        result = await confirmLaunch(owner, b.draftId);
        break;
      case "create_session":
        result = await createSession(owner, b.agentId, b);
        break;
      case "toggle_session": {
        const { toggleAgentWallet } = await import("../../server/agent-wallet");
        result = await toggleAgentWallet(owner, textValue(b.agentId, 100), b.enabled);
        break;
      }
      case "withdraw_session":
        result = await withdrawSession(owner, b.agentId);
        break;
      case "prepare_support":
        result = await prepareSupport(owner, b.draftId);
        break;
      case "submit_support":
        result = await submitSupport(owner, b.draftId, b.signature);
        break;
      case "check_support":
        result = await checkSupport(owner, b.draftId);
        break;
      case "save_support": {
        const mint = b.mint ? pubkey(b.mint).toBase58() : "",
          treasury = b.treasury ? pubkey(b.treasury).toBase58() : "";
        const percentage = Number(b.percentage);
        if (!Number.isInteger(percentage) || percentage < 1 || percentage > 99)
          throw new AppError("Creator-fee share must be 1–99%.");
        await setSetting(owner, "support", { mint, treasury, percentage });
        break;
      }
      case "prepare_fee_distribution": {
        const { prepareFeeDistribution } = await import("../../server/support");
        result = await prepareFeeDistribution(
          owner,
          textValue(b.draftId, 100),
          pubkey(b.wallet).toBase58(),
        );
        break;
      }
      case "confirm_fee_distribution": {
        const { confirmFeeDistribution } = await import("../../server/support");
        result = await confirmFeeDistribution(
          owner,
          textValue(b.draftId, 100),
          textValue(b.signature, 100),
        );
        break;
      }
      default:
        throw new AppError("Unknown action.");
    }
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
