import DevApp from "./dev-app";
import { getChatGPTUser } from "./chatgpt-auth";
export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await getChatGPTUser();
  return <DevApp user={user ? { name: user.displayName } : null} />;
}
