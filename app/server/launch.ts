import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { PUMP_SDK } from "@pump-fun/pump-sdk";
import { simulatedDebit } from "./limits";
import { verifiedDebit } from "./coin-accounting";
import {
  AppError,
  change,
  db,
  decrypt,
  encrypt,
  event,
  id,
  now,
  one,
  publicLaunchTransaction,
  rows,
  rpc,
  setting,
  uploadPinata,
} from "./core";
const encode = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
export function pubkey(value: string) {
  try {
    return new PublicKey(value);
  } catch {
    throw new AppError("Enter a valid Solana public wallet address.");
  }
}
export async function createTx(owner: string, draft: any, wallet: string) {
  const current = await one(
    "SELECT status,prepared,signature FROM drafts WHERE id=? AND owner=?",
    draft.id,
    owner,
  );
  if (
    current?.status === "preparing" &&
    !current.signature &&
    current.prepared
  ) {
    const saved = JSON.parse(current.prepared);
    if (saved.wallet !== wallet)
      throw new AppError(
        "This proposal is already prepared for another wallet.",
      );
    const height = await rpc(owner, "getBlockHeight", [
      { commitment: "confirmed" },
    ]);
    if (height <= saved.lastValidBlockHeight)
      return {
        prepared: saved,
        tx: VersionedTransaction.deserialize(
          Buffer.from(saved.transaction, "base64"),
        ),
      };
    await change(
      "UPDATE drafts SET status='draft',prepared=NULL WHERE id=? AND owner=? AND signature IS NULL AND prepared=?",
      draft.id,
      owner,
      current.prepared,
    );
  }
  const lock = await change(
    "UPDATE drafts SET status='preparing' WHERE id=? AND owner=? AND signature IS NULL AND status='draft'",
    draft.id,
    owner,
  );
  if (!lock.meta.changes)
    throw new AppError("This proposal is already being prepared or submitted.");
  try {
    const user = pubkey(wallet),
      mint = Keypair.generate();
    if (!draft.image_url)
      throw new AppError("Upload coin artwork before launching.");
    const links = await setting(owner, "links_" + draft.id, {});
    const uri =
      draft.metadata_uri ||
      (await uploadPinata(
        owner,
        new File(
          [
            JSON.stringify({
              name: draft.name,
              symbol: draft.symbol,
              description: draft.description,
              image: draft.image_url,
              showName: true,
              createdOn: "https://pump.fun",
              ...(links.website ? { website: links.website } : {}),
              ...(links.twitter ? { twitter: links.twitter } : {}),
            }),
          ],
          "metadata.json",
          { type: "application/json" },
        ),
      ));
    if (uri.length > 200) throw new AppError("Metadata URI is too long.");
    await change(
      "UPDATE drafts SET metadata_uri=? WHERE id=? AND owner=?",
      uri,
      draft.id,
      owner,
    );
    const ix = await PUMP_SDK.createV2Instruction({
      mint: mint.publicKey,
      name: draft.name,
      symbol: draft.symbol,
      uri,
      creator: user,
      user,
      mayhemMode: false,
      cashback: false,
      holderReward: false,
    });
    const block = (
      await rpc(owner, "getLatestBlockhash", [{ commitment: "confirmed" }])
    ).value;
    const tx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: user,
        recentBlockhash: block.blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 350000 }),
          ix,
        ],
      }).compileToV0Message(),
    );
    tx.sign([mint]);
    const fee = (
      await rpc(owner, "getFeeForMessage", [
        encode(tx.message.serialize()),
        { commitment: "confirmed" },
      ])
    ).value;
    if (fee === null)
      throw new AppError("Blockhash expired. Prepare the launch again.");
    const simulation = (
      await rpc(owner, "simulateTransaction", [
        encode(tx.serialize()),
        {
          encoding: "base64",
          sigVerify: false,
          commitment: "confirmed",
          accounts: { encoding: "base64", addresses: [wallet] },
        },
      ])
    ).value;
    if (simulation.err)
      throw new AppError(
        "Launch simulation failed. Check the wallet has enough SOL for account rent and fees. No transaction was sent.",
      );
    const before = simulation.preBalances?.[0],
      after = simulation.postBalances?.[0];
    if (
      !Number.isSafeInteger(before) ||
      !Number.isSafeInteger(after) ||
      before < after
    )
      throw new AppError(
        "Your RPC must support simulation preBalances and postBalances for a reliable spending cap. No transaction was sent.",
      );
    const estimatedLamports = Math.max(fee, simulatedDebit(simulation));
    const prepared = {
      wallet,
      mint: mint.publicKey.toBase58(),
      transaction: encode(tx.serialize()),
      estimatedLamports,
      estimatedSol: (estimatedLamports / 1e9).toFixed(6),
      lastValidBlockHeight: block.lastValidBlockHeight,
      createdAt: now(),
    };
    await change(
      "UPDATE drafts SET prepared=?,mint=? WHERE id=? AND owner=?",
      JSON.stringify(prepared),
      prepared.mint,
      draft.id,
      owner,
    );
    return { prepared, tx };
  } catch (e) {
    await change(
      "UPDATE drafts SET status='draft' WHERE id=? AND owner=? AND status='preparing' AND signature IS NULL",
      draft.id,
      owner,
    );
    throw e;
  }
}
export async function confirmLaunch(owner: string, draftId: string) {
  const d = await one(
    "SELECT * FROM drafts WHERE id=? AND owner=?",
    draftId,
    owner,
  );
  if (!d?.signature) throw new AppError("No submitted transaction to confirm.");
  const isPublic = (await setting(owner, "public_agent_" + d.agent_id))?.visible === true;
  const tx = isPublic ? await publicLaunchTransaction(d.signature) : await rpc(owner, "getTransaction", [
    d.signature,
    {
      encoding: "jsonParsed",
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    },
  ]);
  if (!tx) return { status: "submitted" };
  if (tx.meta?.err) {
    await change(
      "UPDATE drafts SET status='failed' WHERE id=? AND owner=?",
      draftId,
      owner,
    );
    return { status: "failed" };
  }
  if (tx.meta?.err !== null) throw new AppError("Transaction execution could not be verified.");
  const prepared = JSON.parse(d.prepared || "{}");
  const ix = tx.transaction?.message?.instructions?.find(
    (i: any) =>
      i.programId === "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P" &&
      i.accounts?.[0] === d.mint,
  );
  if (
    !ix ||
    !tx.meta?.logMessages?.some((s: string) =>
      /Instruction: Create(V2)?$/.test(s),
    ) ||
    !tx.transaction.message.accountKeys.some(
      (k: any) => k.pubkey === prepared.wallet && k.signer,
    )
  )
    throw new AppError(
      "This transaction does not match the prepared coin launch.",
    );
  const confirmedAt = Number.isFinite(tx.blockTime) ? new Date(tx.blockTime * 1000).toISOString() : now();
  let launchDebitLamports: number | null = null;
  if (isPublic) {
    try { launchDebitLamports = verifiedDebit(await publicLaunchTransaction(d.signature, "base64"), prepared.transaction, d.signature, prepared.wallet); }
    catch { /* A verified launch may have unavailable cost accounting; never substitute simulation estimates. */ }
  }
  await db().batch([
    db().prepare("UPDATE drafts SET status='launched' WHERE id=? AND owner=?").bind(draftId, owner),
    db().prepare("INSERT INTO settings(owner,key,value) VALUES (?,?,?) ON CONFLICT(owner,key) DO UPDATE SET value=CASE WHEN json_extract(settings.value,'$.version') IS NULL THEN excluded.value ELSE json_set(settings.value,'$.launchDebitLamports',COALESCE(json_extract(settings.value,'$.launchDebitLamports'),json_extract(excluded.value,'$.launchDebitLamports'))) END WHERE json_extract(excluded.value,'$.verification')='server-rpc' AND COALESCE(json_extract(settings.value,'$.signature'),json_extract(excluded.value,'$.signature'))=json_extract(excluded.value,'$.signature') AND COALESCE(json_extract(settings.value,'$.mint'),json_extract(excluded.value,'$.mint'))=json_extract(excluded.value,'$.mint')")
      .bind(owner, "public_launch_" + draftId, JSON.stringify({ version: 2, confirmedAt, verification: isPublic ? "server-rpc" : "owner-rpc",
        signature: d.signature, mint: d.mint, creator: prepared.wallet, launchDebitLamports,
        name: d.name, symbol: d.symbol, imageUrl: d.image_url || null })),
  ]);
  if (d.status !== "launched") {
    await event(
      owner,
      d.agent_id,
      "launch",
      d.name + " confirmed on Solana: " + d.mint,
    );
  }
  return { status: "launched", mint: d.mint };
}
export async function createSession(
  owner: string,
  agentId: string,
  input: any,
) {
  if (
    !(await one("SELECT id FROM agents WHERE id=? AND owner=?", agentId, owner))
  )
    throw new AppError("Dev not found.", 404);
  if (await one("SELECT agent_id FROM sessions WHERE agent_id=?", agentId))
    throw new AppError(
      "A launch wallet already exists for this dev. Reuse it and its fixed budget.",
    );
  const { walletInsert } = await import("./agent-wallet");
  const wallet = await walletInsert(owner, agentId, input);
  await wallet.statement.run();
  await event(owner, agentId, "session", "Dedicated wallet created. Fund and activate it to authorize launches.");
  return { publicKey: wallet.publicKey };
}
export async function autoLaunch(owner: string, draftId: string) {
  const draft = await one(
    "SELECT * FROM drafts WHERE id=? AND owner=?",
    draftId,
    owner,
  );
  if (!draft || draft.signature) return;
  const s = await one(
    "SELECT * FROM sessions WHERE agent_id=? AND owner=?",
    draft.agent_id,
    owner,
  );
  if (!s?.enabled) return;
  if (
    s.expires_at < now() ||
    s.used_launches >= s.max_launches ||
    s.used_lamports >= s.max_lamports
  ) {
    await change(
      "UPDATE sessions SET enabled=0 WHERE agent_id=? AND owner=?",
      s.agent_id,
      owner,
    );
    throw new AppError("Instant-launch session reached its limit or expired.");
  }
  await change(
    "UPDATE drafts SET image_url=? WHERE id=? AND owner=?",
    s.image_url,
    draft.id,
    owner,
  );
  draft.image_url = s.image_url;
  const { prepared, tx } = await createTx(owner, draft, s.public_key);
  if (prepared.estimatedLamports > s.per_launch)
    throw new AppError(
      "Estimated launch cost exceeds the per-launch cap. Proposal saved without launching.",
    );
  // Atomic, irreversible reservation: network ambiguity never refunds a budget slot automatically.
  const claim = await change(
    "UPDATE sessions SET used_lamports=used_lamports+?,used_launches=used_launches+1 WHERE agent_id=? AND owner=? AND enabled=1 AND expires_at>? AND used_launches<max_launches AND used_lamports+?<=max_lamports",
    prepared.estimatedLamports,
    s.agent_id,
    owner,
    now(),
    prepared.estimatedLamports,
  );
  if (!claim.meta.changes)
    throw new AppError("Session stopped or its launch budget is exhausted.");
  const latest = await one(
    "SELECT enabled FROM sessions WHERE agent_id=? AND owner=?",
    s.agent_id,
    owner,
  );
  if (!latest?.enabled) throw new AppError("Session stopped before signing.");
  const kp = Keypair.fromSecretKey(
    Buffer.from(
      await decrypt(s.private_key, owner + ":session:" + s.agent_id),
      "base64",
    ),
  );
  tx.sign([kp]);
  // Store the deterministic signature before send, so ambiguous RPC outcomes cannot cause duplicate launches.
  const { default: bs58 } = await import("bs58");
  const signature = bs58.encode(tx.signatures[0]);
  const submission = await change(
    "UPDATE drafts SET signature=?,status='submitted' WHERE id=? AND owner=? AND signature IS NULL AND status='preparing'",
    signature,
    draft.id,
    owner,
  );
  if (!submission.meta.changes)
    throw new AppError(
      "This proposal was claimed by another launch. No duplicate transaction was sent.",
    );
  await rpc(owner, "sendTransaction", [
    encode(tx.serialize()),
    {
      encoding: "base64",
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 2,
    },
  ]);
  await event(
    owner,
    draft.agent_id,
    "launch",
    "Instant launch submitted for " + draft.name + ". Confirmation is pending.",
  );
  return { signature, mint: prepared.mint };
}
export async function withdrawSession(owner: string, agentId: string) {
  const s = await one(
    "SELECT * FROM sessions WHERE agent_id=? AND owner=?",
    agentId,
    owner,
  );
  if (!s) throw new AppError("Launch wallet not found.");
  if (!s.recipient) throw new AppError("Save a return address before retiring this wallet.");
  const recipient = pubkey(s.recipient);
  await change(
    "UPDATE sessions SET enabled=0,expires_at=? WHERE agent_id=? AND owner=?",
    now(),
    agentId,
    owner,
  );
  const a = await one(
    "SELECT status FROM agents WHERE id=? AND owner=?",
    agentId,
    owner,
  );
  if (["running", "stopping"].includes(a?.status))
    throw new AppError(
      "Instant mode is stopped. Wait for the current dev run to finish before withdrawing.",
    );
  const kp = Keypair.fromSecretKey(
    Buffer.from(
      await decrypt(s.private_key, owner + ":session:" + agentId),
      "base64",
    ),
  );
  const balance = (
    await rpc(owner, "getBalance", [s.public_key, { commitment: "confirmed" }])
  ).value;
  const block = (
    await rpc(owner, "getLatestBlockhash", [{ commitment: "confirmed" }])
  ).value;
  const message = (lamports: number) =>
    new TransactionMessage({
      payerKey: kp.publicKey,
      recentBlockhash: block.blockhash,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: kp.publicKey,
          toPubkey: recipient,
          lamports,
        }),
      ],
    }).compileToV0Message();
  const fee = (
    await rpc(owner, "getFeeForMessage", [
      encode(message(1).serialize()),
      { commitment: "confirmed" },
    ])
  ).value;
  if (fee === null || balance <= fee)
    throw new AppError(
      "No withdrawable SOL is available after the network fee.",
    );
  const tx = new VersionedTransaction(message(balance - fee));
  tx.sign([kp]);
  const signature = await rpc(owner, "sendTransaction", [
    encode(tx.serialize()),
    {
      encoding: "base64",
      skipPreflight: false,
      preflightCommitment: "confirmed",
    },
  ]);
  await event(
    owner,
    agentId,
    "withdrawal",
    "Return of remaining session SOL submitted to the fixed recipient " +
      s.recipient +
      ". Transaction: " +
      signature,
  );
  return { signature };
}
