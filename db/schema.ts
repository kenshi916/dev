import {
  sqliteTable,
  text,
  integer,
  index,
  primaryKey,
} from "drizzle-orm/sqlite-core";
export const agents = sqliteTable(
  "agents",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    mission: text("mission").notNull(),
    model: text("model").notNull(),
    status: text("status").notNull().default("ready"),
    updated_at: text("updated_at").notNull(),
  },
  (t) => [index("idx_agents_owner").on(t.owner)],
);
export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    agent_id: text("agent_id").notNull(),
    kind: text("kind").notNull(),
    message: text("message").notNull(),
    created_at: text("created_at").notNull(),
  },
  (t) => [index("idx_events_owner_time").on(t.owner, t.created_at)],
);
export const drafts = sqliteTable(
  "drafts",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    agent_id: text("agent_id").notNull(),
    name: text("name").notNull(),
    symbol: text("symbol").notNull(),
    description: text("description").notNull(),
    rationale: text("rationale").notNull(),
    status: text("status").notNull().default("draft"),
    image_url: text("image_url"),
    metadata_uri: text("metadata_uri"),
    mint: text("mint"),
    signature: text("signature"),
    prepared: text("prepared"),
    created_at: text("created_at").notNull(),
  },
  (t) => [index("idx_drafts_owner").on(t.owner)],
);
export const tracks = sqliteTable(
  "tracks",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    kind: text("kind").notNull(),
    query: text("query").notNull(),
    label: text("label").notNull().default(""),
    last_checked: text("last_checked"),
  },
  (t) => [index("idx_tracks_owner").on(t.owner)],
);
export const signals = sqliteTable(
  "signals",
  {
    id: text("id").notNull(),
    owner: text("owner").notNull(),
    kind: text("kind").notNull(),
    source: text("source").notNull(),
    text: text("text").notNull(),
    created_at: text("created_at").notNull(),
    url: text("url").notNull(),
    likes: integer("likes").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.owner] }),
    index("idx_signals_owner_kind").on(t.owner, t.kind),
  ],
);
export const secrets = sqliteTable(
  "secrets",
  {
    owner: text("owner").notNull(),
    provider: text("provider").notNull(),
    value: text("value").notNull(),
  },
  (t) => [primaryKey({ columns: [t.owner, t.provider] })],
);
export const settings = sqliteTable(
  "settings",
  {
    owner: text("owner").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
  },
  (t) => [primaryKey({ columns: [t.owner, t.key] })],
);
export const sessions = sqliteTable(
  "sessions",
  {
    owner: text("owner").notNull(),
    agent_id: text("agent_id").primaryKey(),
    public_key: text("public_key").notNull(),
    private_key: text("private_key").notNull(),
    enabled: integer("enabled").notNull().default(0),
    max_lamports: integer("max_lamports").notNull(),
    per_launch: integer("per_launch").notNull(),
    max_launches: integer("max_launches").notNull(),
    used_lamports: integer("used_lamports").notNull().default(0),
    used_launches: integer("used_launches").notNull().default(0),
    expires_at: text("expires_at").notNull(),
    image_url: text("image_url"),
    recipient: text("recipient").notNull(),
    support_json: text("support_json").notNull().default("{}"),
  },
  (t) => [index("idx_sessions_owner").on(t.owner)],
);
