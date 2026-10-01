import { AppError, change, event, id, now, one, rows, secret, setSetting, setting } from "./core";

const PREFIX = "twitterapi_track_";
const POLL_MS = 120000;
type Cursor = { query?: string; completedUntil?: number; start?: number; end?: number; nextToken?: string; seenCursors?: string[]; busyUntil?: number; nextPollAt?: number; lastSuccessAt?: string; lastError?: string | null };
type Post = { id: string; text: string; createdAt: string; likeCount?: number; author?: { userName?: string } };
type Page = { tweets: Post[]; has_next_page: boolean; next_cursor?: string };
const tweetId = (value: unknown): value is string => typeof value === "string" && /^\d{1,25}$/.test(value);
const keyFor = (track: string) => PREFIX + track;
class ProviderError extends AppError {
  constructor(message: string, public retryMs = POLL_MS, public global = false, public resetPage = false) { super(message, 502); }
}

export function normalizeTwitterApiKey(value: string) {
  const key = value.trim();
  if (key.length < 8 || key.length > 4096 || /\s/.test(key)) throw new AppError("Enter your TwitterAPI.io API key.");
  return key;
}
export async function resetTwitterApiStatus(owner: string) {
  await change("DELETE FROM settings WHERE owner=? AND key='twitterapi_status'", owner);
  await change("UPDATE settings SET value=json_set(value,'$.nextPollAt',0,'$.lastError',NULL) WHERE owner=? AND substr(key,1,?)=?", owner, PREFIX.length, PREFIX);
}
export async function readTwitterApiStatus(owner: string) {
  const connected = Boolean(await one("SELECT provider FROM secrets WHERE owner=? AND provider='twitterapi'", owner));
  const status = await setting(owner, "twitterapi_status", {});
  const tracks = await rows("SELECT id,query FROM tracks WHERE owner=? AND kind='tweet'", owner);
  const trackers = await Promise.all(tracks.map(async (track) => {
    const cursor: Cursor = await setting(owner, keyFor(track.id), {});
    return { id: track.id, query: track.query, lastSuccessAt: cursor.lastSuccessAt || null, lastError: cursor.lastError || null, hasBacklog: Boolean(cursor.nextToken), nextRetryAt: (cursor.nextPollAt || 0) > Date.now() ? new Date(cursor.nextPollAt!).toISOString() : null };
  }));
  const hasErrors = trackers.some(track => track.lastError);
  return { connected, provider: "twitterapi", state: !connected ? "not_connected" : hasErrors ? status.lastSuccessAt ? "partial" : "error" : status.state || "configured", message: !connected ? "Connect your TwitterAPI.io key to read tracked posts." : status.message || "Key saved. Refresh to verify TwitterAPI.io access.", lastSuccessAt: status.lastSuccessAt || null, checkedAt: status.checkedAt || null, nextRetryAt: trackers.map(t => t.nextRetryAt).filter(Boolean).sort()[0] || null, trackers };
}

async function requestPage(token: string, query: string, cursor: Cursor): Promise<Page> {
  const base = /^@[a-zA-Z0-9_]{1,15}$/.test(query) ? "from:" + query.slice(1) + " -filter:retweets" : query.replace(/(^|\s)-is:retweet(?=\s|$)/g, "$1-filter:retweets");
  if (/\b(?:since|until|since_time|until_time|since_id|max_id):/i.test(base)) throw new ProviderError("Use an account or topic without date or ID operators; Dev manages the polling window.");
  const url = new URL("https://api.twitterapi.io/twitter/tweet/advanced_search");
  url.search = new URLSearchParams({ query: `(${base}) since_time:${cursor.start} until_time:${cursor.end}`, queryType: "Latest", cursor: cursor.nextToken || "" }).toString();
  let response: Response;
  try { response = await fetch(url, { headers: { "X-API-Key": token }, redirect: "manual", signal: AbortSignal.timeout(20000) }); }
  catch { throw new ProviderError("TwitterAPI.io could not be reached. The saved polling position is preserved."); }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 429) {
      const header = response.headers.get("retry-after") || "";
      const retry = /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
      throw new ProviderError("TwitterAPI.io rate limit reached. Wait before refreshing again.", Math.min(86400000, Math.max(POLL_MS, Number.isFinite(retry) ? retry : 0)), true);
    }
    if ([401,403].includes(response.status)) throw new ProviderError("TwitterAPI.io rejected this key or its access. Check the provider dashboard.", POLL_MS, true);
    if (response.status === 402) throw new ProviderError("TwitterAPI.io requires more credits. No additional request was made.", POLL_MS, true);
    if (response.status === 400 && cursor.nextToken) throw new ProviderError("TwitterAPI.io rejected a saved page cursor. The same time window will restart on the next refresh.", POLL_MS, false, true);
    if (response.status >= 300 && response.status < 400) throw new ProviderError("TwitterAPI.io redirected the request. Credentials were not forwarded.");
    throw new ProviderError("TwitterAPI.io could not complete this search. Check the query and provider account.");
  }
  if (!response.body) throw new ProviderError("TwitterAPI.io returned an empty response.");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let text = "", length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 1500000) { await reader.cancel(); throw new Error(); }
      text += decoder.decode(part.value, { stream: true });
    }
    const body = JSON.parse(text + decoder.decode());
    if (body?.status === "error" || body?.error || body?.detail || !Array.isArray(body?.tweets) || typeof body.has_next_page !== "boolean") throw new Error();
    if (body.tweets.length > 20 || body.tweets.some((post: Post) => !post || !tweetId(post.id) || typeof post.text !== "string" || typeof post.createdAt !== "string" || !Number.isFinite(Date.parse(post.createdAt)))) throw new Error();
    if (body.has_next_page && (typeof body.next_cursor !== "string" || !body.next_cursor || body.next_cursor.length > 4096 || (cursor.seenCursors || []).includes(body.next_cursor) || body.next_cursor === cursor.nextToken)) throw new ProviderError("TwitterAPI.io returned an invalid page cursor. The same time window will restart without advancing its checkpoint.", POLL_MS, false, true);
    return body as Page;
  } catch (error) { if (error instanceof ProviderError) throw error; throw new ProviderError("TwitterAPI.io returned an error or incomplete results. Check credits, access, and query syntax. The polling checkpoint is unchanged."); }
  finally { reader.releaseLock(); }
}

// One bounded page per refresh; separate provider checkpoints prevent mixing X cursors.
// Official time operators: docs.twitterapi.io/api-reference/endpoint/tweet_advanced_search
export async function refreshTwitterApi(owner: string) {
  const tracks = await rows("SELECT t.* FROM tracks t LEFT JOIN settings s ON s.owner=t.owner AND s.key='twitterapi_track_'||t.id WHERE t.owner=? AND t.kind='tweet' ORDER BY COALESCE(json_extract(s.value,'$.nextPollAt'),0),t.id LIMIT 5", owner);
  if (!tracks.length) throw new AppError("Add a tweet tracker first.");
  const token = normalizeTwitterApiKey(await secret(owner, "twitterapi"));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,"0")).join("");
  const previousStatus = await setting(owner, "twitterapi_status", {});
  if (previousStatus.retryAt > Date.now()) throw new AppError(previousStatus.message, 429);
  let skipped = 0;
  for (const track of tracks) {
    const old: Cursor = await setting(owner, keyFor(track.id), {});
    const cursor: Cursor = old.query === track.query ? old : { query: track.query };
    const started = Date.now();
    if ((cursor.nextPollAt || 0) > started || (cursor.busyUntil || 0) > started) { skipped++; continue; }
    const end = cursor.end || Math.floor(started / 1000) - 2;
    const window: Cursor = { ...cursor, start: cursor.start ?? Math.max(0, (cursor.completedUntil || end - 3600) - 60), end };
    const lease = JSON.stringify({ ...window, token: id(), busyUntil: started + 60000 });
    const claim = await change("INSERT INTO settings (owner,key,value) VALUES (?,?,?) ON CONFLICT(owner,key) DO UPDATE SET value=excluded.value WHERE COALESCE(json_extract(settings.value,'$.busyUntil'),0)<=? AND COALESCE(json_extract(settings.value,'$.nextPollAt'),0)<=?", owner, keyFor(track.id), lease, started, started);
    if (!claim.meta.changes) { skipped++; continue; }
    try {
      const gate = await change("INSERT INTO settings (owner,key,value) VALUES (?,?,?) ON CONFLICT(owner,key) DO UPDATE SET value=excluded.value WHERE CAST(settings.value AS INTEGER)<=?", "__twitterapi_rate_limit__", fingerprint, String(started + 5100), started);
      if (!gate.meta.changes) {
        const reserved = await one("SELECT value FROM settings WHERE owner=? AND key=?", "__twitterapi_rate_limit__", fingerprint);
        throw new ProviderError("TwitterAPI.io is waiting for its shared request limit. Try again after the displayed retry time.", Math.max(5100, Number(reserved?.value || 0) - started));
      }
      const page = await requestPage(token, track.query, window);
      for (const post of page.tweets) {
        const author = typeof post.author?.userName === "string" && /^[a-zA-Z0-9_]{1,15}$/.test(post.author.userName) ? post.author.userName : "unknown";
        await change("INSERT INTO signals (id,owner,kind,source,text,created_at,url,likes) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id,owner) DO UPDATE SET source=excluded.source,text=excluded.text,url=excluded.url,likes=excluded.likes", post.id, owner, "tweet", author, post.text.slice(0,30000), new Date(post.createdAt).toISOString(), "https://x.com/i/web/status/" + post.id, Number.isSafeInteger(post.likeCount) && post.likeCount! >= 0 ? post.likeCount : 0);
      }
      const next: Cursor = { query: track.query, completedUntil: page.has_next_page ? cursor.completedUntil : end, start: page.has_next_page ? window.start : undefined, end: page.has_next_page ? end : undefined, nextToken: page.has_next_page ? page.next_cursor : undefined, seenCursors: page.has_next_page ? [...(cursor.seenCursors || []), page.next_cursor!].slice(-100) : undefined, busyUntil: 0, nextPollAt: Date.now() + POLL_MS, lastSuccessAt: now(), lastError: null };
      const committed = await change("UPDATE settings SET value=? WHERE owner=? AND key=? AND value=?", JSON.stringify(next), owner, keyFor(track.id), lease);
      if (!committed.meta.changes) throw new ProviderError("A newer refresh replaced this one. Its checkpoint is preserved.");
      await change("UPDATE tracks SET last_checked=? WHERE id=? AND owner=?", next.lastSuccessAt, track.id, owner);
      const message = `TwitterAPI.io checked one tracker and received ${page.tweets.length} posts.` + (page.has_next_page ? " More pages remain in this fixed search window." : "") + " Search coverage depends on the provider index.";
      await setSetting(owner, "twitterapi_status", { state: "ready", message, checkedAt: now(), lastSuccessAt: now(), retryAt: 0 });
      await event(owner, "", "signals", message);
      return { checked: 1, saved: page.tweets.length, skipped: tracks.length - 1, hasBacklog: page.has_next_page, errors: [], message };
    } catch (error) {
      const failure = error instanceof ProviderError ? error : new ProviderError("This tracker could not save its results. Its checkpoint is preserved.");
      if (failure.global) await change("UPDATE settings SET value=CAST(MAX(CAST(value AS INTEGER),?) AS TEXT) WHERE owner=? AND key=?", Date.now() + failure.retryMs, "__twitterapi_rate_limit__", fingerprint);
      await change("UPDATE settings SET value=? WHERE owner=? AND key=? AND value=?", JSON.stringify({ ...window, ...(failure.resetPage ? { nextToken: undefined, seenCursors: undefined } : {}), busyUntil: 0, nextPollAt: Date.now() + failure.retryMs, lastError: failure.message }), owner, keyFor(track.id), lease);
      await setSetting(owner, "twitterapi_status", { state: "error", message: failure.message, checkedAt: now(), lastSuccessAt: previousStatus.lastSuccessAt || null, retryAt: failure.global ? Date.now() + failure.retryMs : 0 });
      throw failure;
    }
  }
  return { checked: 0, saved: 0, skipped, hasBacklog: false, errors: [], message: "No trackers are due yet. Each tracker waits two minutes between reads." };
}
