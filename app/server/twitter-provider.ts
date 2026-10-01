import { one, setting } from "./core";
import { readTwitterStatus as readXStatus, refreshTweets as refreshX } from "./twitter";
import { readTwitterApiStatus, refreshTwitterApi } from "./twitterapi";

export async function selectedTwitterProvider(owner: string): Promise<"x" | "twitterapi"> {
  return (await setting(owner, "twitter_provider", "x")) === "twitterapi" ? "twitterapi" : "x";
}
export async function readTwitterStatus(owner: string) {
  if (await selectedTwitterProvider(owner) === "twitterapi") return readTwitterApiStatus(owner);
  return { ...await readXStatus(owner), provider: "x", connected: Boolean(await one("SELECT provider FROM secrets WHERE owner=? AND provider='x'", owner)) };
}
export async function refreshTweets(owner: string) {
  return await selectedTwitterProvider(owner) === "twitterapi" ? refreshTwitterApi(owner) : refreshX(owner);
}
