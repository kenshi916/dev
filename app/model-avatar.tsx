"use client";

import { useState } from "react";
import {
  modelLogoUrl,
  modelProvider,
  OPENROUTER_LOGO_URL,
} from "./model-catalog";

export { modelLogoUrl } from "./model-catalog";

type ModelAvatarProps = {
  model: string;
  name?: string;
  size?: number;
};

export default function ModelAvatar({
  model,
  name,
  size = 32,
}: ModelAvatarProps) {
  const source = modelLogoUrl(model);
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const url = failedSources.includes(source) ? OPENROUTER_LOGO_URL : source;
  const unavailable = failedSources.includes(url);
  const label =
    url === OPENROUTER_LOGO_URL ? "OpenRouter" : name || modelProvider(model);

  return (
    <span
      className="model-avatar"
      title={`${label} logo`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        minWidth: size,
        flexShrink: 0,
        overflow: "hidden",
        borderRadius: Math.max(5, Math.round(size * 0.18)),
        background: "#fff",
        border: "1px solid rgba(255,255,255,.15)",
        verticalAlign: "middle",
      }}
    >
      {unavailable ? (
        <svg
          width={size * 0.62}
          height={size * 0.62}
          viewBox="0 0 24 24"
          role="img"
          aria-label="AI model"
        >
          <rect
            x="5"
            y="5"
            width="14"
            height="14"
            rx="3"
            fill="none"
            stroke="#14151c"
            strokeWidth="1.5"
          />
          <path
            d="M9 1v4m6-4v4M9 19v4m6-4v4M1 9h4m-4 6h4m14-6h4m-4 6h4"
            fill="none"
            stroke="#14151c"
            strokeWidth="1.5"
          />
        </svg>
      ) : (
        // The provider assets are already local and intentionally retain their original artwork.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={url}
          src={url}
          alt={`${label} logo`}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onError={() => setFailedSources((previous) => [...previous, url])}
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            objectFit: "contain",
            padding: Math.max(2, Math.round(size * 0.09)),
          }}
        />
      )}
    </span>
  );
}
