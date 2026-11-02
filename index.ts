// Fails an Anthropic stream that never starts, so pi's auto-retry resends it.
//
// Anthropic sometimes accepts a streaming request, sends headers and keepalive pings, and never
// sends message_start. The SDK timeout stops at headers and undici's idle timeout is reset by the
// pings, so the turn hangs until Esc. Once headers arrive, this errors the body if no
// message_start shows up within STALL_MS. "timed out" is what pi's retry classifier matches.
// A healthy request, even a 390k-token uncached one, gets message_start within seconds.

const STALL_MS = Number(process.env.PI_ANTHROPIC_STALL_MS) || 90_000;
// The unwrapped fetch, kept across /reload and in-process child sessions so the wrapper never nests.
const ORIGINAL = Symbol.for("anthropic-stall-guard.fetch");

export default function anthropicStallGuard() {
   const base = (globalThis[ORIGINAL] ??= globalThis.fetch);
   globalThis.fetch = async (input, init) => {
      const res = await base(input, init);
      const url = typeof input === "string" ? input : (input.href ?? input.url);
      if (!res.body || !/\/v1\/messages(\?|$)/.test(url) || !res.headers.get("content-type")?.includes("text/event-stream")) {
         return res;
      }
      return new Response(guard(res.body), { status: res.status, statusText: res.statusText, headers: res.headers });
   };
}

function guard(body) {
   const reader = body.getReader();
   const decoder = new TextDecoder();
   let tail = "";
   let timer;
   return new ReadableStream({
      start(controller) {
         timer = setTimeout(() => {
            timer = undefined;
            controller.error(new Error(`Anthropic stream stalled: no message_start after ${STALL_MS / 1000}s (timed out)`));
            reader.cancel().catch(() => {});
         }, STALL_MS);
      },
      async pull(controller) {
         try {
            const { value, done } = await reader.read();
            if (done) {
               clearTimeout(timer);
               controller.close();
               return;
            }
            if (timer) {
               // Keep a short tail so a name split across chunks still matches; stop decoding once found.
               const text = tail + decoder.decode(value, { stream: true });
               if (text.includes("message_start")) {
                  clearTimeout(timer);
                  timer = undefined;
               }
               tail = text.slice(-16);
            }
            controller.enqueue(value);
         } catch (error) {
            clearTimeout(timer);
            controller.error(error); // no-op if the stall timer already errored the stream
         }
      },
      cancel(reason) {
         clearTimeout(timer);
         return reader.cancel(reason);
      },
   });
}
