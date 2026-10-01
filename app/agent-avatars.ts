export const AGENT_AVATARS = [
  { id: "byte", name: "Byte", description: "The original keyboard nerd", color: "#86efac" },
  { id: "patch", name: "Patch", description: "Purple hair. Fresh ideas.", color: "#c4a4ff" },
  { id: "glitch", name: "Glitch", description: "Late nights. Loud keys.", color: "#ffbb70" },
  { id: "kernel", name: "Kernel", description: "Old school. Always building.", color: "#a6d9ff" },
] as const;

export type AgentAvatarId = typeof AGENT_AVATARS[number]["id"];
export function isAgentAvatar(value: unknown): value is AgentAvatarId {
  return AGENT_AVATARS.some(avatar => avatar.id === value);
}
export function agentAvatarId(value: unknown): AgentAvatarId {
  return isAgentAvatar(value) ? value : "byte";
}
