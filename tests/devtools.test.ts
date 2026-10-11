import { expect, test } from "bun:test";
import { z } from "zod";
import { browserCommand } from "../src/utils/devtools.ts";

const commandSchema = z.object({ id: z.number(), method: z.string() });

async function withBrowserSocket(
  respond: (message: string, send: (reply: string) => void) => void,
  action: (url: string, closed: Promise<void>) => Promise<void>,
): Promise<void> {
  const closed = Promise.withResolvers<void>();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return;
      return new Response("WebSocket expected", { status: 400 });
    },
    websocket: {
      message(socket, message) {
        respond(String(message), (reply) => { socket.send(reply); });
      },
      close() { closed.resolve(); },
    },
  });
  try {
    await action(`ws://127.0.0.1:${server.port}`, closed.promise);
  } finally {
    // Bun 1.3 needs a loop turn to finish WebSocket close bookkeeping before shutdown.
    await Bun.sleep(0);
    await server.stop(true);
  }
}

test("cookie capture uses browser-level commands and ignores unrelated protocol events", async () => {
  await withBrowserSocket((message, send) => {
    const data: unknown = JSON.parse(message);
    const command = commandSchema.parse(data);
    expect(command.method).toBe("Storage.getCookies");
    send(JSON.stringify({ method: "some.browser.event", params: {} }));
    send(JSON.stringify({ id: 99, result: { cookies: ["unrelated"] } }));
    send(JSON.stringify({ id: command.id, result: { cookies: [] } }));
  }, async (url, closed) => {
    expect(await browserCommand(url, "Storage.getCookies")).toEqual({ cookies: [] });
    await closed;
  });
});

test("a malformed browser response fails without leaving the connection open", async () => {
  await withBrowserSocket((_message, send) => send("invalid JSON"), async (url, closed) => {
    await expect(browserCommand(url, "Storage.getCookies")).rejects.toThrow();
    await closed;
  });
});

test("browser protocol errors are reported instead of accepting a missing cookie result", async () => {
  await withBrowserSocket((_message, send) => {
    send(JSON.stringify({ id: 1, error: { code: -32601, message: "Unknown browser method" } }));
  }, async (url, closed) => {
    await expect(browserCommand(url, "Storage.getCookies")).rejects.toThrow("Unknown browser method");
    await closed;
  });
});

test("cancelling an unresponsive cookie capture closes the owned connection immediately", async () => {
  const received = Promise.withResolvers<void>();
  await withBrowserSocket(() => received.resolve(), async (url, closed) => {
    const controller = new AbortController();
    const pending = browserCommand(url, "Storage.getCookies", controller.signal);
    await received.promise;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await closed;
  });
});
