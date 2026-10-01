import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  type AccountInfo,
} from "@solana/web3.js";
import {
  PUMP_SDK,
  PUMP_PROGRAM_ID,
  PUMP_FEE_PROGRAM_ID,
  PUMP_AMM_PROGRAM_ID,
  ammCreatorVaultPda,
  bondingCurvePda,
  canonicalPumpPoolPda,
  creatorVaultPda,
  feeSharingConfigPda,
  pumpPoolAuthorityPda,
} from "@pump-fun/pump-sdk";
import { PUMP_AMM_SDK } from "@pump-fun/pump-swap-sdk";
import { NATIVE_MINT, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, unpackAccount } from "@solana/spl-token";
import bs58 from "bs58";
import { simulatedDebit } from "./limits";
import {
  AppError,
  change,
  decrypt,
  event,
  id,
  now,
  one,
  rpc,
  setting,
  setSetting,
} from "./core";
const encode = (v: Uint8Array) => Buffer.from(v).toString("base64");
export async function prepareSupport(owner: string, draftId: string) {
  const d = await one(
    "SELECT * FROM drafts WHERE id=? AND owner=?",
    draftId,
    owner,
  );
  if (d?.status !== "launched")
    throw new AppError("Confirm this coin launch first.");
  const existing = await setting(owner, "support_" + draftId);
  if (existing?.signature)
    throw new AppError(
      "Fee setup was already submitted. Check its on-chain status.",
    );
  const config = await setting(owner, "support");
  if (!config?.treasury)
    throw new AppError("Set your operations treasury wallet first.");
  const mint = new PublicKey(d.mint),
    creator = new PublicKey(JSON.parse(d.prepared).wallet),
    treasury = new PublicKey(config.treasury);
  if (creator.equals(treasury))
    throw new AppError("The treasury must differ from this coin creator.");
  const info = (
    await rpc(owner, "getAccountInfo", [
      feeSharingConfigPda(mint).toBase58(),
      { encoding: "base64", commitment: "confirmed" },
    ])
  ).value;
  let current = [creator];
  const ixs = [];
  if (info) {
    const decoded = PUMP_SDK.decodeSharingConfig({
      ...info,
      data: Buffer.from(info.data[0], "base64"),
      owner: new PublicKey(info.owner),
    });
    if (decoded.adminRevoked)
      throw new AppError("This coin already has a permanent fee split.");
    if (!decoded.admin.equals(creator))
      throw new AppError("The creator is not the sharing administrator.");
    current = decoded.shareholders.map((s) => s.address);
  } else
    ixs.push(
      await PUMP_SDK.createFeeSharingConfig({ creator, mint, pool: null }),
    );
  ixs.push(
    await PUMP_SDK.updateFeeSharesV2({
      authority: creator,
      mint,
      currentShareholders: current,
      newShareholders: [
        { address: creator, shareBps: (100 - config.percentage) * 100 },
        { address: treasury, shareBps: config.percentage * 100 },
      ],
      quoteMint: NATIVE_MINT,
      quoteTokenProgram: TOKEN_PROGRAM_ID,
    }),
  );
  const block = (
    await rpc(owner, "getLatestBlockhash", [{ commitment: "confirmed" }])
  ).value;
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: creator,
      recentBlockhash: block.blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }),
        ...ixs,
      ],
    }).compileToV0Message(),
  );
  if (tx.serialize().length > 1232)
    throw new AppError(
      "Fee setup exceeds transaction size. Use pump.fun fee sharing for this coin.",
    );
  const sim = (
    await rpc(owner, "simulateTransaction", [
      encode(tx.serialize()),
      { encoding: "base64", sigVerify: false, commitment: "confirmed" },
    ])
  ).value;
  const before = sim.preBalances?.[0],
    after = sim.postBalances?.[0];
  if (
    sim.err ||
    !Number.isSafeInteger(before) ||
    !Number.isSafeInteger(after) ||
    before < after
  )
    throw new AppError(
      "Fee setup simulation failed or cost data is unavailable. Check funding and whether this coin has graduated.",
    );
  const cost = simulatedDebit(sim);
  const session = await one(
    "SELECT public_key FROM sessions WHERE owner=? AND agent_id=?",
    owner,
    d.agent_id,
  );
  const result = {
    transaction: encode(tx.serialize()),
    wallet: creator.toBase58(),
    treasury: config.treasury,
    percentage: config.percentage,
    mainCoin: config.mint || "",
    estimatedSol: (cost / 1e9).toFixed(6),
    estimatedLamports: cost,
    sessionSigner: session?.public_key === creator.toBase58(),
    createdAt: now(),
    status: "prepared",
  };
  await setSetting(owner, "support_" + draftId, result);
  return result;
}
export async function submitSupport(
  owner: string,
  draftId: string,
  signature?: string,
) {
  const d = await one(
    "SELECT * FROM drafts WHERE id=? AND owner=?",
    draftId,
    owner,
  );
  if (!d) throw new AppError("Coin not found.");
  const p = await setting(owner, "support_" + draftId);
  if (!p || p.status !== "prepared")
    throw new AppError("Prepare fee sharing first.");
  const claim = await change(
    "UPDATE settings SET value=? WHERE owner=? AND key=? AND value=?",
    JSON.stringify({ ...p, status: "signing" }),
    owner,
    "support_" + draftId,
    JSON.stringify(p),
  );
  if (!claim.meta.changes)
    throw new AppError("Fee setup is already being submitted.");
  try {
    if (p.sessionSigner) {
      const s = await one(
        "SELECT * FROM sessions WHERE owner=? AND agent_id=?",
        owner,
        d.agent_id,
      );
      if (!s || s.public_key !== p.wallet)
        throw new AppError("Launch wallet mismatch.");
      const budget = await change(
        "UPDATE sessions SET used_lamports=used_lamports+? WHERE owner=? AND agent_id=? AND used_lamports+?<=max_lamports",
        p.estimatedLamports,
        owner,
        d.agent_id,
        p.estimatedLamports,
      );
      if (!budget.meta.changes)
        throw new AppError("Fee setup exceeds the remaining session budget.");
      const tx = VersionedTransaction.deserialize(
        Buffer.from(p.transaction, "base64"),
      );
      tx.sign([
        Keypair.fromSecretKey(
          Buffer.from(
            await decrypt(s.private_key, owner + ":session:" + d.agent_id),
            "base64",
          ),
        ),
      ]);
      signature = bs58.encode(tx.signatures[0]);
      await setSetting(owner, "support_" + draftId, {
        ...p,
        status: "submitted",
        signature,
      });
      await rpc(owner, "sendTransaction", [
        encode(tx.serialize()),
        {
          encoding: "base64",
          skipPreflight: false,
          preflightCommitment: "confirmed",
        },
      ]);
    } else {
      if (!signature || !/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(signature))
        throw new AppError("A valid wallet signature is required.");
      await setSetting(owner, "support_" + draftId, {
        ...p,
        status: "submitted",
        signature,
      });
    }
    await event(
      owner,
      d.agent_id,
      "support",
      "Creator-fee sharing submitted. " +
        p.percentage +
        "% designated for the treasury; confirmation pending.",
    );
    return { signature };
  } catch (e) {
    if (!signature) await setSetting(owner, "support_" + draftId, p);
    throw e;
  }
}
export async function checkSupport(owner: string, draftId: string) {
  const d = await one(
      "SELECT * FROM drafts WHERE id=? AND owner=?",
      draftId,
      owner,
    ),
    p = await setting(owner, "support_" + draftId);
  if (!d || !p?.signature) throw new AppError("No fee setup to check.");
  const info = (
    await rpc(owner, "getAccountInfo", [
      feeSharingConfigPda(new PublicKey(d.mint)).toBase58(),
      { encoding: "base64", commitment: "confirmed" },
    ])
  ).value;
  if (!info) return { status: "pending" };
  const config = PUMP_SDK.decodeSharingConfig({
    ...info,
    data: Buffer.from(info.data[0], "base64"),
    owner: new PublicKey(info.owner),
  });
  const recipient = config.shareholders.find(
    (s) => s.address.toBase58() === p.treasury,
  );
  if (!config.adminRevoked || recipient?.shareBps !== p.percentage * 100)
    return { status: "pending" };
  await setSetting(owner, "support_" + draftId, { ...p, status: "active" });
  return { status: "active" };
}

type DistributionRecipient = {
  wallet: string;
  shareBps: number;
  estimatedLamports: number;
};
export type PreparedFeeDistribution = {
  id: string;
  status: "prepared" | "submitted" | "confirmed" | "failed" | "expired";
  transaction: string;
  wallet: string;
  mint: string;
  treasury: string;
  recipients: DistributionRecipient[];
  estimatedDistributionLamports: number;
  estimatedTreasuryLamports: number;
  estimatedFeeLamports: number;
  estimatedLamports: number;
  estimatedSol: string;
  lastValidBlockHeight: number;
  graduated: boolean;
  sweepsAmm: boolean;
  createdAt: string;
  signature?: string;
  receivedLamports?: number;
  receivedSol?: string;
  feeLamports?: number;
  confirmedAt?: string;
  actualRecipients?: { wallet: string; shareBps: number; receivedLamports: number }[];
};

function distributionKey(value: string) {
  if (typeof value !== "string" || !value || value.length > 100)
    throw new AppError("Choose a valid launched coin.");
  return "fee_distribution_" + value;
}
function checkedKey(value: unknown, label: string) {
  try {
    if (typeof value !== "string" || value.length > 50) throw new Error();
    const result = new PublicKey(value);
    if (result.equals(PublicKey.default)) throw new Error();
    return result;
  } catch {
    throw new AppError("Enter a valid " + label + " address.");
  }
}
function checkedLamports(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new AppError("Reliable " + label + " data is unavailable from the RPC.", 502);
  return value;
}
function checkedAccount(value: unknown, expectedOwner: PublicKey, label: string): AccountInfo<Buffer> {
  const account = value as { owner?: unknown; data?: unknown; executable?: unknown; lamports?: unknown } | null;
  if (!account || account.owner !== expectedOwner.toBase58() || account.executable !== false ||
    !Array.isArray(account.data) || account.data[1] !== "base64" ||
    typeof account.data[0] !== "string" || account.data[0].length > 8192 ||
    account.data[0].length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(account.data[0]))
    throw new AppError("The on-chain " + label + " account is missing or does not match the expected program.", 409);
  return {
    owner: expectedOwner,
    executable: false,
    lamports: checkedLamports(account.lamports, label + " balance"),
    data: Buffer.from(account.data[0], "base64"),
  };
}

/**
 * Builds a permissionless SOL creator-fee distribution for a connected wallet
 * to review and sign. Never signs, broadcasts, exchanges funds or buys credits.
 * Official lifecycle: pump-public-docs/docs/instructions/CREATOR_FEE_SHARING.md.
 */
export async function prepareFeeDistribution(owner: string, draftId: string, payerWallet: string) {
  const key = distributionKey(draftId);
  const draft = await one("SELECT * FROM drafts WHERE id=? AND owner=?", draftId, owner);
  if (draft?.status !== "launched") throw new AppError("Confirm this coin launch before collecting creator fees.");
  const mint = checkedKey(draft.mint, "coin mint");
  let creator: PublicKey;
  try { creator = checkedKey(JSON.parse(draft.prepared).wallet, "coin creator"); }
  catch { throw new AppError("This coin has no valid recorded launch wallet.", 409); }

  const previous: PreparedFeeDistribution | null = await setting(owner, key);
  // Restore a recorded submission even after its blockhash expires or the
  // connected wallet changes. The signature keeps the UI in confirmation-only
  // mode; only confirmFeeDistribution decides whether it landed or expired.
  if (previous?.status === "submitted" && previous.signature) return previous;
  const payer = checkedKey(payerWallet, "payer wallet");
  if (previous && ["prepared", "submitted"].includes(previous.status)) {
    const height = checkedLamports(await rpc(owner, "getBlockHeight", [{ commitment: "confirmed" }]), "block height");
    if (height <= previous.lastValidBlockHeight) {
      if (previous.wallet !== payer.toBase58())
        throw new AppError("This collection is already prepared for another wallet. Wait for it to expire or confirm it.", 409);
      return previous;
    }
    if (previous.signature)
      throw new AppError("Check the submitted fee collection before preparing another transaction.", 409);
  }

  const split = await setting(owner, "support_" + draftId);
  const preferences = await setting(owner, "support");
  const treasury = checkedKey(split?.treasury || preferences?.treasury, "operations treasury");
  const sharingAddress = feeSharingConfigPda(mint);
  const curveAddress = bondingCurvePda(mint);
  const poolAddress = canonicalPumpPoolPda(mint);
  const vaultAddress = creatorVaultPda(sharingAddress);
  const ammAuthority = ammCreatorVaultPda(sharingAddress);
  const ammVaultAddress = getAssociatedTokenAddressSync(NATIVE_MINT, ammAuthority, true, TOKEN_PROGRAM_ID);
  const state = await rpc(owner, "getMultipleAccounts", [
    [sharingAddress, curveAddress, poolAddress, vaultAddress, ammVaultAddress].map((p) => p.toBase58()),
    { encoding: "base64", commitment: "confirmed" },
  ]);
  if (!state || !Array.isArray(state.value) || state.value.length !== 5)
    throw new AppError("The RPC did not return the requested fee accounts.", 502);
  const [sharingRaw, curveRaw, poolRaw, vaultRaw, ammVaultRaw] = state.value;
  const sharingAccount = checkedAccount(sharingRaw, PUMP_FEE_PROGRAM_ID, "fee-sharing");
  const curveAccount = checkedAccount(curveRaw, PUMP_PROGRAM_ID, "bonding curve");
  let sharing: ReturnType<typeof PUMP_SDK.decodeSharingConfig>;
  let curve: ReturnType<typeof PUMP_SDK.decodeBondingCurve>;
  try {
    sharing = PUMP_SDK.decodeSharingConfig(sharingAccount);
    curve = PUMP_SDK.decodeBondingCurve(curveAccount);
  } catch {
    throw new AppError("The on-chain fee accounts could not be decoded with the supported Pump SDK.", 409);
  }
  const sharingStatus = (sharing as typeof sharing & { status?: Record<string, unknown> }).status;
  if (sharing.version !== 2 || !sharingStatus || !("active" in sharingStatus) ||
    !sharing.mint.equals(mint) || !sharing.admin.equals(creator) || !sharing.adminRevoked ||
    !curve.creator.equals(sharingAddress))
    throw new AppError("Confirm an active, permanent fee split for this coin before collecting fees.", 409);
  if (curve.isHolderReward || (!curve.quoteMint.equals(PublicKey.default) && !curve.quoteMint.equals(NATIVE_MINT)))
    throw new AppError("This collector currently supports regular SOL-paired creator-fee coins only.");
  const shareholderKeys = sharing.shareholders.map((s) => s.address.toBase58());
  if (!sharing.shareholders.length || sharing.shareholders.length > 10 ||
    new Set(shareholderKeys).size !== shareholderKeys.length ||
    sharing.shareholders.some((s) => !Number.isInteger(s.shareBps) || s.shareBps <= 0) ||
    sharing.shareholders.reduce((sum, s) => sum + s.shareBps, 0) !== 10000 ||
    !shareholderKeys.includes(treasury.toBase58()))
    throw new AppError("The on-chain recipients do not include the configured treasury in a valid fee split.", 409);

  const graduated = poolRaw !== null;
  if (graduated) {
    const poolAccount = checkedAccount(poolRaw, PUMP_AMM_PROGRAM_ID, "canonical pool");
    let pool: ReturnType<typeof PUMP_AMM_SDK.decodePool>;
    try { pool = PUMP_AMM_SDK.decodePool(poolAccount); }
    catch { throw new AppError("The canonical PumpSwap pool could not be decoded.", 409); }
    if (!curve.complete || !pool.baseMint.equals(mint) || !pool.quoteMint.equals(NATIVE_MINT) ||
      !pool.creator.equals(pumpPoolAuthorityPda(mint)) || !pool.coinCreator.equals(sharingAddress) || (pool as typeof pool & { isHolderReward?: boolean }).isHolderReward)
      throw new AppError("The graduated pool does not match this coin's SOL creator-fee split.", 409);
  }
  let curveLamports = 0;
  if (vaultRaw !== null) {
    const vault = checkedAccount(vaultRaw, SystemProgram.programId, "creator vault");
    if (vault.data.length !== 0) throw new AppError("The creator vault has an unexpected account layout.", 409);
    curveLamports = vault.lamports;
  }
  let ammLamports = BigInt(0);
  const sweepsAmm = graduated && ammVaultRaw !== null;
  if (sweepsAmm) {
    const ammAccount = checkedAccount(ammVaultRaw, TOKEN_PROGRAM_ID, "AMM creator-fee token vault");
    const vault = unpackAccount(ammVaultAddress, ammAccount, TOKEN_PROGRAM_ID);
    if (!vault.mint.equals(NATIVE_MINT) || !vault.owner.equals(ammAuthority) || !vault.isInitialized || !vault.isNative || vault.isFrozen)
      throw new AppError("The AMM fee vault does not hold the expected native SOL fees.", 409);
    ammLamports = vault.amount;
  }
  const reserve = checkedLamports(await rpc(owner, "getMinimumBalanceForRentExemption", [0, { commitment: "confirmed" }]), "vault rent reserve");
  const available = BigInt(curveLamports) + ammLamports - BigInt(reserve);
  if (available <= BigInt(0)) throw new AppError("No distributable creator fees were found in this snapshot.");
  if (available > BigInt(Number.MAX_SAFE_INTEGER)) throw new AppError("The fee balance exceeds the supported accounting range.");
  const estimatedDistributionLamports = Number(available);
  const recipients = sharing.shareholders.map((s) => ({
    wallet: s.address.toBase58(),
    shareBps: s.shareBps,
    estimatedLamports: Number(available * BigInt(s.shareBps) / BigInt(10000)),
  }));
  const instructions = [ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 })];
  if (sweepsAmm) {
    const sweep = await PUMP_SDK.transferCreatorFeesToPumpV2({ payer, mint, quoteMint: NATIVE_MINT, quoteTokenProgram: TOKEN_PROGRAM_ID });
    if (!sweep.programId.equals(PUMP_AMM_PROGRAM_ID)) throw new AppError("Unexpected fee-sweep program.", 503);
    instructions.push(sweep);
  }
  const distribution = await PUMP_SDK.distributeCreatorFeesV2({
    mint, sharingConfig: sharing, sharingConfigAddress: sharingAddress,
    quoteMint: NATIVE_MINT, payer, shouldInitializeAta: false, quoteTokenProgram: TOKEN_PROGRAM_ID,
  });
  if (!distribution.programId.equals(PUMP_PROGRAM_ID) ||
    distribution.keys.slice(-recipients.length).some((account, i) => account.pubkey.toBase58() !== recipients[i].wallet || !account.isWritable || account.isSigner))
    throw new AppError("The SDK distribution recipients do not match the verified on-chain split.", 503);
  instructions.push(distribution);
  const block = (await rpc(owner, "getLatestBlockhash", [{ commitment: "confirmed" }])).value;
  const lastValidBlockHeight = checkedLamports(block?.lastValidBlockHeight, "block expiry");
  const transaction = new VersionedTransaction(new TransactionMessage({
    payerKey: payer, recentBlockhash: block.blockhash, instructions,
  }).compileToV0Message());
  if (transaction.serialize().length > 1232)
    throw new AppError("This fee split exceeds the supported transaction size. Collect it through pump.fun.");
  if (transaction.message.header.numRequiredSignatures !== 1 ||
    !transaction.message.staticAccountKeys[0].equals(payer))
    throw new AppError("The collection has an unexpected signing requirement.", 503);
  const fee = checkedLamports((await rpc(owner, "getFeeForMessage", [encode(transaction.message.serialize()), { commitment: "confirmed" }])).value, "network fee");
  const simulation = (await rpc(owner, "simulateTransaction", [encode(transaction.serialize()), {
    encoding: "base64", sigVerify: false, commitment: "confirmed",
  }])).value;
  if (!simulation || simulation.err !== null)
    throw new AppError("Fee collection simulation failed. Check the payer's SOL balance and refresh the fee state. No transaction was sent.");
  const prepared: PreparedFeeDistribution = {
    id: id(), status: "prepared", transaction: encode(transaction.serialize()),
    wallet: payer.toBase58(), mint: mint.toBase58(), treasury: treasury.toBase58(), recipients,
    estimatedDistributionLamports,
    estimatedTreasuryLamports: recipients.find((r) => r.wallet === treasury.toBase58())!.estimatedLamports,
    estimatedFeeLamports: fee, estimatedLamports: fee, estimatedSol: (fee / 1e9).toFixed(9),
    lastValidBlockHeight, graduated, sweepsAmm, createdAt: now(),
  };
  // Only one still-current preparation may win. A second tab cannot silently
  // replace the exact message the first wallet is reviewing.
  const stored = previous
    ? await change("UPDATE settings SET value=? WHERE owner=? AND key=? AND value=?", JSON.stringify(prepared), owner, key, JSON.stringify(previous))
    : await change("INSERT INTO settings (owner,key,value) VALUES (?,?,?) ON CONFLICT(owner,key) DO NOTHING", owner, key, JSON.stringify(prepared));
  if (stored.meta.changes !== 1) throw new AppError("Another fee collection was prepared. Reload its details before signing.", 409);
  return prepared;
}

export async function confirmFeeDistribution(owner: string, draftId: string, signature: string) {
  const key = distributionKey(draftId);
  try { if (typeof signature !== "string" || signature.length > 90 || bs58.decode(signature).length !== 64) throw new Error(); }
  catch { throw new AppError("Enter a valid transaction signature."); }
  const draft = await one("SELECT * FROM drafts WHERE id=? AND owner=?", draftId, owner);
  const prepared: PreparedFeeDistribution | null = await setting(owner, key);
  if (draft?.status !== "launched" || !prepared || prepared.mint !== draft.mint)
    throw new AppError("Prepare a fee collection for this coin first.", 404);
  if (prepared.signature && prepared.signature !== signature)
    throw new AppError("This collection is associated with a different transaction.", 409);
  const recordReceipt = async (record: PreparedFeeDistribution) => {
    if (record.status !== "confirmed") return;
    await change("INSERT INTO settings (owner,key,value) VALUES (?,?,?) ON CONFLICT(owner,key) DO NOTHING", owner,
      "fee_receipt_" + signature, JSON.stringify({ signature, draftId, agentId: draft.agent_id,
        treasury: record.treasury, receivedLamports: record.receivedLamports, confirmedAt: record.confirmedAt }));
  };
  if (prepared.status === "confirmed" || prepared.status === "failed") {
    await recordReceipt(prepared);
    return prepared;
  }
  const observed = await rpc(owner, "getTransaction", [signature, {
    encoding: "base64", maxSupportedTransactionVersion: 0, commitment: "confirmed",
  }]);
  if (!observed) {
    const finalizedHeight = checkedLamports(await rpc(owner, "getBlockHeight", [{ commitment: "finalized" }]), "finalized block height");
    if (finalizedHeight > prepared.lastValidBlockHeight) {
      const statuses = await rpc(owner, "getSignatureStatuses", [[signature], { searchTransactionHistory: true }]);
      if (!statuses || !Array.isArray(statuses.value) || statuses.value.length !== 1)
        throw new AppError("The RPC could not verify the expired transaction's history.", 502);
      if (statuses.value[0] === null) {
        const expired = { ...prepared, status: "expired" as const, signature };
        const saved = await change("UPDATE settings SET value=? WHERE owner=? AND key=? AND value=?", JSON.stringify(expired), owner, key, JSON.stringify(prepared));
        if (saved.meta.changes !== 1) throw new AppError("Collection state changed. Reload its status.", 409);
        return expired;
      }
    }
    // A supplied signature is not confirmation. Keep the message for an exact
    // comparison once the chain can return the transaction.
    if (prepared.status !== "submitted") {
      const updated = { ...prepared, status: "submitted" as const, signature };
      await change("UPDATE settings SET value=? WHERE owner=? AND key=? AND value=?", JSON.stringify(updated), owner, key, JSON.stringify(prepared));
    }
    return { status: "pending" as const, signature, mint: prepared.mint };
  }
  let actual: VersionedTransaction;
  const expected = VersionedTransaction.deserialize(Buffer.from(prepared.transaction, "base64"));
  try {
    if (!Array.isArray(observed.transaction) || observed.transaction[1] !== "base64" ||
      typeof observed.transaction[0] !== "string" || observed.transaction[0].length > 4096) throw new Error();
    actual = VersionedTransaction.deserialize(Buffer.from(observed.transaction[0], "base64"));
    if (encode(actual.message.serialize()) !== encode(expected.message.serialize()) ||
      bs58.encode(actual.signatures[0]) !== signature) throw new Error();
  } catch {
    throw new AppError("This transaction does not exactly match the prepared fee distribution.", 409);
  }
  if (!observed.meta || !("err" in observed.meta)) throw new AppError("The confirmed transaction has no accounting metadata.", 502);
  let completed: PreparedFeeDistribution;
  if (observed.meta.err !== null) {
    completed = { ...prepared, status: "failed", signature };
  } else {
    const feeLamports = checkedLamports(observed.meta.fee, "confirmed transaction fee");
    const before = observed.meta.preBalances;
    const after = observed.meta.postBalances;
    const keys = actual.message.staticAccountKeys;
    if (!Array.isArray(before) || !Array.isArray(after) || before.length !== keys.length || after.length !== keys.length)
      throw new AppError("The confirmed transaction has incomplete recipient balances.", 502);
    const actualRecipients = prepared.recipients.map((recipient) => {
      const index = keys.findIndex((account) => account.toBase58() === recipient.wallet);
      if (index < 0) throw new AppError("A prepared fee recipient is absent from the confirmed transaction.", 409);
      const received = checkedLamports(after[index], "recipient closing balance") - checkedLamports(before[index], "recipient opening balance") +
        (recipient.wallet === prepared.wallet ? feeLamports : 0);
      return { wallet: recipient.wallet, shareBps: recipient.shareBps, receivedLamports: checkedLamports(received, "recipient received amount") };
    });
    const receivedLamports = actualRecipients.find((r) => r.wallet === prepared.treasury)!.receivedLamports;
    completed = {
      ...prepared, status: "confirmed", signature, actualRecipients, receivedLamports,
      receivedSol: (receivedLamports / 1e9).toFixed(9), feeLamports, confirmedAt: now(),
    };
  }
  const updated = await change("UPDATE settings SET value=? WHERE owner=? AND key=? AND value=?", JSON.stringify(completed), owner, key, JSON.stringify(prepared));
  if (updated.meta.changes !== 1) {
    const current: PreparedFeeDistribution | null = await setting(owner, key);
    if (current?.signature === signature && ["confirmed", "failed"].includes(current.status)) {
      await recordReceipt(current);
      return current;
    }
    throw new AppError("Fee collection state changed. Reload before checking confirmation again.", 409);
  }
  await recordReceipt(completed);
  await event(owner, draft.agent_id, "fees", completed.status === "confirmed"
    ? "Creator-fee distribution confirmed. Treasury received " + completed.receivedSol + " SOL. No OpenRouter credits were purchased."
    : "Creator-fee distribution failed on chain. No payout was confirmed.");
  return completed;
}
