import { AGENT_AVATARS, agentAvatarId } from "./agent-avatars";

export default function AgentAvatar({ avatar, name, size = 48, animate = false }: {
  avatar?: string; name?: string; size?: number; animate?: boolean;
}) {
  const id = agentAvatarId(avatar);
  const character = AGENT_AVATARS.find(a => a.id === id)!;
  return <span role="img" aria-label={(name || character.name) + " retro avatar"}
    className={"retro-avatar" + (animate ? " is-typing" : "")}
    style={{ width: size, height: size, backgroundImage: `url('/agent-avatars/${id}-typing.png')` }} />;
}
