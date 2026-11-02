# pi-anthropic-stall-guard

A [pi](https://github.com/earendil-works/pi) extension. If an Anthropic stream never starts, it errors the stream so pi's automatic retry sends the request again. Without it, the turn hangs until you press Esc.

## The problem

Sometimes Anthropic accepts a streaming request, sends response headers and keepalive `ping` events, and never sends `message_start`. Pi shows no tokens and no error, and it waits until you press Esc. Pi's timeouts do not catch this:

- The Anthropic SDK timeout stops when the response headers arrive.
- Pi's HTTP idle timeout (`httpIdleTimeoutMs`, default 300 s) restarts each time a byte arrives, and the pings keep it alive.
- Pi drops `ping` events before they reach the agent, so nothing on screen changes.

When you press Esc and resend, the request usually completes in seconds.

## What it does

The extension wraps `globalThis.fetch`. It acts only on responses to `/v1/messages` with `content-type: text/event-stream`. After the headers arrive, it waits for `message_start`. If `message_start` does not arrive within the limit, the extension errors the stream with:

```
Anthropic stream stalled: no message_start after 90s (timed out)
```

Pi classifies "timed out" errors as retryable. Pi then resends the request with its normal retry policy (`retry` settings, 3 attempts by default) and shows its normal retry notice.

After `message_start` arrives, the extension stops checking and passes the stream through unchanged. Long thinking and slow output are never cut off. Esc still cancels the request.

## Install

```bash
pi install git:github.com/ssweens/pi-anthropic-stall-guard
```

## Configure

| Environment variable | Default | Meaning |
|---|---|---|
| `PI_ANTHROPIC_STALL_MS` | `90000` | Time to wait after the headers arrive for `message_start`, in milliseconds |

A healthy request gets `message_start` within seconds, including a 390k-token request with no cache hits.

## Limits

- The extension does not cover a stall before the headers arrive. The SDK's own timeout (300 s by default) already handles that case, and pi retries it.
- The extension acts on every `/v1/messages` event stream, so it also covers Anthropic-compatible proxies.
- The extension replaces the global `fetch`. It keeps a reference to the original `fetch`, so a `/reload` or an in-process child session does not wrap it twice.

## License

MIT
