import { getCurrentUser } from "@/server/auth";
import { getBotStatus, bus, listMessages, type ChatDto } from "@/server/services/chat";

export const dynamic = "force-dynamic";

/**
 * Server-Sent Events stream. Works on a long-running Node server; on pure
 * serverless hosts the client automatically falls back to /api/chat polling.
 */
export async function GET() {
  const user = await getCurrentUser();
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let onMessage: ((message: ChatDto) => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const [messages, bot] = await Promise.all([listMessages({ limit: 40 }), getBotStatus()]);
      send("snapshot", { messages, bot, authenticated: Boolean(user) });

      onMessage = (message: ChatDto) => send("message", message);
      bus.on("chat", onMessage);

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          /* stream already closed */
        }
      }, 20_000);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      if (onMessage) bus.off("chat", onMessage);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
