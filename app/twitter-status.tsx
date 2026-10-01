export type TwitterStatusData = {
  provider?: "x" | "twitterapi";
  connected?: boolean;
  state: "not_connected" | "configured" | "ready" | "partial" | "error";
  message: string;
  lastSuccessAt: string | null;
  nextRetryAt: string | null;
  trackers: {
    id: string;
    query: string;
    lastError: string | null;
    hasBacklog: boolean;
  }[];
};

export function twitterLabel(status?: TwitterStatusData, configured = false) {
  if (!(status?.connected ?? configured)) return "CONNECT FEED";
  if (status?.state === "ready") return status.provider === "twitterapi" ? "TWITTERAPI.IO READY" : "X READY";
  if (status?.state === "partial") return "PARTIAL FEED";
  if (status?.state === "error") return "CHECK FEED ACCESS";
  return "FEED KEY SAVED";
}

export default function TwitterStatus({
  status,
}: {
  status?: TwitterStatusData;
}) {
  if (!status || status.state === "not_connected") return null;
  return (
    <div
      className={"note " + (status.state === "error" ? "error" : "")}
      style={{ margin: "12px 16px" }}
      role="status"
    >
      <p>{status.message}</p>
      {status.lastSuccessAt && (
        <p className="tiny muted">
          Last successful sync:{" "}
          {new Date(status.lastSuccessAt).toLocaleString()}
        </p>
      )}
      {status.nextRetryAt && (
        <p className="tiny muted">
          Next refresh available:{" "}
          {new Date(status.nextRetryAt).toLocaleTimeString()}
        </p>
      )}
      {status.trackers
        .filter((tracker) => tracker.lastError)
        .map((tracker) => (
          <p className="tiny" key={tracker.id}>
            {tracker.query}: {tracker.lastError}
          </p>
        ))}
    </div>
  );
}
