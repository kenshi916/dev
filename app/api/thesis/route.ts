import { AppError, body, fail, userId } from "../../server/core";
import {
  latestThesis,
  prepareThesis,
  type ThesisEvent,
} from "../../server/thesis";

export async function GET() {
  try {
    return Response.json(
      { discussion: await latestThesis(await userId()) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}

export async function POST(request: Request) {
  try {
    const owner = await userId();
    const session = await prepareThesis(
      owner,
      await body(request),
      request.signal,
    );
    if (!request.headers.get("accept")?.includes("application/x-ndjson")) {
      return Response.json(
        { discussion: await session.run() },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const encoder = new TextEncoder();
    const canceled = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (event: ThesisEvent) => {
          if (!canceled.signal.aborted)
            controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        };
        try {
          const discussion = await session.run(emit, canceled.signal);
          emit({ type: "result", discussion });
        } catch (e) {
          emit({
            type: "error",
            error:
              e instanceof AppError
                ? e.message
                : "The discussion could not finish. Your last completed discussion is still saved.",
          });
        } finally {
          if (!canceled.signal.aborted) controller.close();
        }
      },
      cancel() {
        canceled.abort();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    return fail(e);
  }
}
