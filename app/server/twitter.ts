import { AppError, change, event, id, now, one, rows, secret, setSetting, setting } from "./core";

const POLL_MS = 120000;
const PREFIX = "twitter_track_";
type Cursor = { query?: string; sinceId?: string; nextToken?: string; newestId?: string; busyUntil?: number; nextPollAt?: number; lastSuccessAt?: string; lastError?: string | null };
type Tweet = { id: string; author_id?: string; text: string; created_at?: string; note_tweet?: { text?: string }; public_metrics?: { like_count?: number } };
type SearchPage = { data?: Tweet[]; includes?: { users?: { id: string; username: string }[] }; meta?: { newest_id?: string; next_token?: string; result_count?: number }; errors?: unknown[] };
class TwitterError extends AppError {
  constructor(message: string, public retryAt = Date.now() + 30000, public global = false, public resetPage = false) { super(message, 502); }
}
const tweetId = (value: unknown): value is string => typeof value === "string" && /^[0-9]{1,25}$/.test(value);
const timestamp = (value?: number) => value && value > Date.now() ? new Date(value).toISOString() : null;
const keyFor = (trackId: string) => PREFIX + trackId;

export function normalizeTwitterToken(value: string) {
  const token = value.trim().replace(/^Bearer\s+/i, "");
  if (token.length < 8 || token.length > 4096 || /\s/.test(token))
    throw new AppError("Paste the X app Bearer Token from its Keys and tokens page.");
  return token;
}

export async function resetTwitterStatus(owner: string) {
  await change("DELETE FROM settings WHERE owner=? AND key='twitter_status'", owner);
  // Preserve the polling checkpoint when credentials change; don't re-read history.
  await change("UPDATE settings SET value=json_set(value,'$.nextPollAt',0,'$.lastError',NULL) WHERE owner=? AND substr(key,1,?)=?", owner, PREFIX.length, PREFIX);
}

export async function readTwitterStatus(owner: string) {
  const connected = Boolean(await one("SELECT provider FROM secrets WHERE owner=? AND provider='x'", owner));
  const status = await setting(owner, "twitter_status", {});
  const tracks = await rows("SELECT id,query,last_checked FROM tracks WHERE owner=? AND kind='tweet'", owner);
  const trackers = await Promise.all(tracks.map(async (track) => {
    const cursor: Cursor = await setting(owner, keyFor(track.id), {});
    return { id: track.id, query: track.query, lastSuccessAt: cursor.lastSuccessAt || null, lastError: cursor.lastError || null, nextRetryAt: timestamp(cursor.nextPollAt), hasBacklog: Boolean(cursor.nextToken) };
  }));
  const next = trackers.map((track) => track.nextRetryAt).filter((value): value is string => Boolean(value)).sort()[0] || null;
  return {
    state: !connected ? "not_connected" : status.state || "configured",
    message: !connected ? "Connect your X app Bearer Token to read tracked posts." : status.message || "Token saved. Refresh a tracker to verify X access.",
    lastSuccessAt: status.lastSuccessAt || null,
    checkedAt: status.checkedAt || null,
    nextRetryAt: next,
    trackers,
  };
}

function retryAt(response: Response) {
  const reset = Number(response.headers.get("x-rate-limit-reset")) * 1000;
  const retry = response.headers.get("retry-after");
  const wait = retry && /^\d+$/.test(retry) ? Date.now() + Number(retry) * 1000 : retry ? Date.parse(retry) : 0;
  const future = [reset, wait].filter((value) => Number.isFinite(value) && value > Date.now());
  return Math.min(Date.now() + 86400000, Math.max(Date.now() + POLL_MS, ...future));
}

async function search(token: string, query: string, cursor: Cursor): Promise<SearchPage> {
  const url = new URL("https://api.x.com/2/tweets/search/recent");
  url.search = new URLSearchParams({
    query: /^@[a-zA-Z0-9_]{1,15}$/.test(query) ? "from:" + query.slice(1) + " -is:retweet" : query,
    "tweet.fields": "created_at,public_metrics,author_id,note_tweet",
    expansions: "author_id", "user.fields": "username", max_results: "10", sort_order: "recency",
    ...(cursor.sinceId ? { since_id: cursor.sinceId } : {}),
    ...(cursor.nextToken ? { next_token: cursor.nextToken } : {}),
  }).toString();
  let response: Response;
  // Workers supports manual/follow. Reject redirects instead of forwarding a bearer token.
  try { response = await fetch(url, { headers: { Authorization: "Bearer " + token }, signal: AbortSignal.timeout(20000), redirect: "manual" }); }
  catch { throw new TwitterError("X could not be reached. Your saved posts and polling position are preserved."); }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status >= 300 && response.status < 400) throw new TwitterError("X redirected the search request. Try again later; your polling position is preserved.", Date.now() + POLL_MS, true);
    if (response.status === 401) throw new TwitterError("X rejected the Bearer Token. Replace it with the token from your X developer app.", Date.now() + 60000, true);
    if (response.status === 402) throw new TwitterError("X API credits or the account spending limit blocked this read. Check billing in the X Developer Console.", Date.now() + POLL_MS, true);
    if (response.status === 403) throw new TwitterError("The X app does not have access to recent search. Check the app's API access and account status in the X Developer Console.", Date.now() + POLL_MS, true);
    if (response.status === 429) throw new TwitterError("X rate limit or usage allowance reached. The tracker will wait for the provider's retry window.", retryAt(response), true);
    if (response.status === 400) throw new TwitterError(cursor.nextToken ? "X rejected this saved pagination request. Its page token was cleared; retry to resume from the last completed checkpoint." : "X rejected this search query. Check its operators, spelling, and supported query syntax.", Date.now() + 30000, false, Boolean(cursor.nextToken));
    throw new TwitterError("X search is temporarily unavailable (" + response.status + "). Try again shortly.");
  }
  if (!response.body) throw new TwitterError("X returned an empty response. Try again shortly.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "", length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 1500000) { await reader.cancel(); throw new Error("Oversized response"); }
      text += decoder.decode(part.value, { stream: true });
    }
    const page = JSON.parse(text + decoder.decode()) as SearchPage;
    if (!page || (page.data !== undefined && !Array.isArray(page.data)) || (page.data === undefined && page.meta?.result_count !== 0)) throw new Error("Invalid result");
    if ((page.data?.length || 0) > 10 || page.data?.some((tweet) => !tweet || !tweetId(tweet.id) || typeof tweet.text !== "string")) throw new Error("Invalid post");
    if (page.meta?.next_token && (typeof page.meta.next_token !== "string" || page.meta.next_token.length > 4096)) throw new Error("Invalid cursor");
    return page;
  } catch { throw new TwitterError("X returned an invalid or incomplete search response. Your polling position is preserved."); }
  finally { reader.releaseLock(); }
}

// X polling requires the original since_id throughout pagination, then the first
// page's newest_id for the next cycle: https://docs.x.com/x-api/posts/search/integrate/paginate
export async function refreshTweets(owner: string) {
  const tracks = await rows("SELECT * FROM tracks WHERE owner=? AND kind='tweet' ORDER BY id LIMIT 5", owner);
  if (!tracks.length) throw new AppError("Add a tweet tracker first.");
  const token = normalizeTwitterToken(await secret(owner, "x"));
  const previousStatus = await setting(owner, "twitter_status", {});
  if (previousStatus.retryAt > Date.now()) throw new AppError(previousStatus.message, 429);
  const errors: { trackId: string; query: string; message: string }[] = [];
  let checked = 0, saved = 0, skipped = 0, hasBacklog = false, globalRetry = 0;
  for (const [trackIndex, track] of tracks.entries()) {
    const old: Cursor = await setting(owner, keyFor(track.id), {});
    const cursor: Cursor = old.query === track.query ? old : { query: track.query };
    const started = Date.now();
    const lease = JSON.stringify({ ...cursor, token: id(), busyUntil: started + 60000 });
    const claim = await change("INSERT INTO settings (owner,key,value) VALUES (?,?,?) ON CONFLICT(owner,key) DO UPDATE SET value=excluded.value WHERE COALESCE(json_extract(settings.value,'$.busyUntil'),0)<=? AND COALESCE(json_extract(settings.value,'$.nextPollAt'),0)<=?", owner, keyFor(track.id), lease, started, started);
    if (!claim.meta.changes) { skipped++; hasBacklog ||= Boolean(cursor.nextToken); continue; }
    try {
      const page = await search(token, track.query, cursor);
      const users = new Map((Array.isArray(page.includes?.users) ? page.includes.users : []).filter((user) => user && typeof user.id === "string" && /^[a-zA-Z0-9_]{1,15}$/.test(user.username)).map((user) => [user.id, user.username]));
      const posts = page.data || [];
      for (const tweet of posts) {
        const author = users.get(tweet.author_id || "") || (tweetId(tweet.author_id) ? tweet.author_id : "unknown");
        const publishedAt = tweet.created_at && Number.isFinite(Date.parse(tweet.created_at)) ? new Date(tweet.created_at).toISOString() : now();
        await change("INSERT INTO signals (id,owner,kind,source,text,created_at,url,likes) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id,owner) DO UPDATE SET source=excluded.source,text=excluded.text,url=excluded.url,likes=excluded.likes", tweet.id, owner, "tweet", author, (typeof tweet.note_tweet?.text === "string" ? tweet.note_tweet.text : tweet.text).slice(0,30000), publishedAt, "https://x.com/i/web/status/" + tweet.id, Number.isSafeInteger(tweet.public_metrics?.like_count) && tweet.public_metrics!.like_count! >= 0 ? tweet.public_metrics!.like_count : 0);
      }
      const newest = cursor.newestId || (tweetId(page.meta?.newest_id) ? page.meta.newest_id : posts.map((post) => post.id).sort((a,b) => BigInt(a) > BigInt(b) ? -1 : 1)[0]) || cursor.sinceId;
      const next: Cursor = { query: track.query, sinceId: page.meta?.next_token ? cursor.sinceId : newest, nextToken: page.meta?.next_token, newestId: page.meta?.next_token ? newest : undefined, busyUntil: 0, nextPollAt: Date.now() + POLL_MS, lastSuccessAt: now(), lastError: page.errors?.length ? "X returned partial results; some expansions may be unavailable." : null };
      const committed = await change("UPDATE settings SET value=? WHERE owner=? AND key=? AND value=?", JSON.stringify(next), owner, keyFor(track.id), lease);
      if (!committed.meta.changes) throw new TwitterError("This tracker refresh was superseded. Its newer polling position is preserved.");
      await change("UPDATE tracks SET last_checked=? WHERE id=? AND owner=?", next.lastSuccessAt, track.id, owner);
      checked++; saved += posts.length; hasBacklog ||= Boolean(next.nextToken);
      if (next.lastError) errors.push({ trackId: track.id, query: track.query, message: next.lastError });
    } catch (error) {
      const failure = error instanceof TwitterError ? error : new TwitterError("This tracker could not save its results. Try again shortly.");
      await change("UPDATE settings SET value=? WHERE owner=? AND key=? AND value=?", JSON.stringify({ ...cursor, ...(failure.resetPage ? {nextToken:undefined,newestId:undefined} : {}), busyUntil:0,nextPollAt:failure.retryAt,lastError:failure.message }), owner, keyFor(track.id), lease);
      errors.push({ trackId: track.id, query: track.query, message: failure.message });
      if (failure.global) { globalRetry = failure.retryAt; skipped += tracks.length - trackIndex - 1; break; }
    }
  }
  const message = checked ? `Checked ${checked} tracker${checked === 1 ? "" : "s"}; received ${saved} post${saved === 1 ? "" : "s"}.` + (hasBacklog ? " Older matching posts remain queued for the next refresh." : "") + (errors.length ? " Some tracker results need attention." : "") : errors.length ? errors[0].message : "No trackers are due yet. The two-minute polling interval avoids repeated reads.";
  if (checked || errors.length) {
    await setSetting(owner, "twitter_status", { state: errors.length ? checked ? "partial" : "error" : "ready", message, checkedAt:now(), lastSuccessAt: checked ? now() : previousStatus.lastSuccessAt || null, retryAt:globalRetry });
    await event(owner,"","signals",message);
  }
  if (!checked && errors.length) throw new AppError(message, globalRetry ? 429 : 502);
  return { checked, saved, skipped, hasBacklog, errors, message };
}
