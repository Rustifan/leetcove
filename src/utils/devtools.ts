import { z } from "zod";
import { abortError } from "./errors.ts";

const replySchema = z.object({
  id: z.number().optional(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string() }).optional(),
});

function readReply(message: unknown): { matched: false } | { matched: true; result: unknown } {
  const data: unknown = JSON.parse(z.string().parse(message));
  const reply = replySchema.parse(data);
  if (reply.id !== 1) return { matched: false };
  if (reply.error) throw new Error(`Browser connection: ${reply.error.message}`);
  return { matched: true, result: reply.result };
}

export async function browserCommand(url: string, method: string, signal?: AbortSignal): Promise<unknown> {
  signal?.throwIfAborted();
  const socket = new WebSocket(url);
  const { promise, resolve, reject } = Promise.withResolvers<unknown>();
  const cancel = () => reject(abortError());
  const timer = setTimeout(() => reject(new Error("Timed out communicating with the login browser.")), 10_000);
  signal?.addEventListener("abort", cancel, { once: true });
  socket.addEventListener("open", () => socket.send(JSON.stringify({ id: 1, method })));
  socket.addEventListener("error", () => reject(new Error("Could not connect to the login browser.")));
  socket.addEventListener("close", () => reject(new Error("Login window was closed before sign-in completed.")));
  socket.addEventListener("message", (event) => {
    const data: unknown = event.data;
    void Promise.resolve(data).then(readReply).then((reply) => {
      if (reply.matched) resolve(reply.result);
    }, reject);
  });
  try {
    if (signal?.aborted) cancel();
    return await promise;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
    socket.close();
  }
}
