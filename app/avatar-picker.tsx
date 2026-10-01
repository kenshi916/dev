"use client";
import { useState } from "react";
import { Check, Pause, Play } from "lucide-react";
import AgentAvatar from "./agent-avatar";
import { AGENT_AVATARS, agentAvatarId, type AgentAvatarId } from "./agent-avatars";

export default function AvatarPicker({ value, onChange, disabled }: {
  value: AgentAvatarId; onChange: (value: AgentAvatarId) => void; disabled?: boolean;
}) {
  const [animated, setAnimated] = useState(true);
  const selected = AGENT_AVATARS.find(a => a.id === agentAvatarId(value))!;
  return <fieldset className="avatar-picker" disabled={disabled}>
    <legend>Choose your nerd</legend>
    <div className="avatar-preview">
      <AgentAvatar avatar={selected.id} size={126} animate={animated} />
      <div><span className="eyebrow">YOUR DEV, IN PIXELS</span><h3 style={{ color: selected.color }}>{selected.name}<span>_</span></h3><p>{selected.description}</p><button className="avatar-motion" type="button" aria-pressed={animated} onClick={() => setAnimated(!animated)}>{animated ? <Pause size={11} /> : <Play size={11} />}{animated ? "Pause preview" : "Play preview"}</button></div>
    </div>
    <div className="avatar-options">
      {AGENT_AVATARS.map(a => <label key={a.id} className={"avatar-option" + (a.id === value ? " selected" : "")}>
        <input type="radio" name="agent-avatar" value={a.id} checked={a.id === value} onChange={() => onChange(a.id)} aria-label={a.name + " avatar"} />
        <AgentAvatar avatar={a.id} size={80} animate={animated && a.id === value} />
        <span>{a.name}{a.id === value && <Check size={11} />}</span>
      </label>)}
    </div>
    <p className="avatar-help">Your character follows your agent into the feed. It doesn’t change its model or strategy.</p>
  </fieldset>;
}
