/**
 * Vercel edge of the split deployment: proxy /api/* to the gateway.
 *
 * WHY A FUNCTION AND NOT A REWRITE. vercel.json rewrites cannot read
 * environment variables, so a rewrite would have to hard-code the gateway URL
 * into a file in this repository. A function reads GATEWAY_ORIGIN at runtime,
 * which keeps the gateway's address out of git and lets preview and production
 * point at different gateways.
 *
 * WHY A PROXY AND NOT CORS. The console calls /api and expects same-origin;
 * vite.config.ts does the same thing with a dev-server proxy, and its comment
 * says why — adding CORS would mean changing the gateway. This preserves that.
 * The dev proxy and this function must stay in step: both strip /api and
 * forward the rest unchanged.
 *
 * WHAT THIS DOES NOT DO. It is not an authentication boundary. It forwards the
 * persona headers the console sends, exactly as the gateway's non-production
 * header-identity shim expects. Anyone who can reach this URL can claim any
 * MSP and any role, because that is what the shim is: a POC stand-in for mTLS.
 * Put Vercel's Deployment Protection in front of it, and never point it at a
 * gateway holding real customer data.
 */

/**
 * Forwarded verbatim. An allow-list rather than a copy of everything: passing
 * the inbound Host through breaks virtual hosting on the gateway side, and
 * forwarding cookies or authorization to a service that ignores them only
 * widens what a mistake could leak.
 */
const FORWARD_REQUEST_HEADERS = [
  'content-type',
  'idempotency-key',
  'x-abhi-msp',
  'x-abhi-role',
  'x-abhi-employer',
  'x-abhi-nonce',
  'x-abhi-timestamp',
];

/** The console reads x-correlation-id off every response; x-age off some. */
const FORWARD_RESPONSE_HEADERS = [
  'content-type',
  'x-correlation-id',
  'x-age',
  'x-content-type-options',
];

const UPSTREAM_TIMEOUT_MS = 30_000;

export default async function handler(req, res) {
  const configured = process.env.GATEWAY_ORIGIN;

  if (!configured) {
    res.status(503).json({
      code: 'ERR_GATEWAY_NOT_CONFIGURED',
      message:
        'GATEWAY_ORIGIN is not set on this deployment. The console is static; ' +
        'it has no gateway to talk to until that variable points at one.',
    });
    return;
  }

  let base;
  try {
    base = new URL(configured);
  } catch {
    res.status(503).json({
      code: 'ERR_GATEWAY_NOT_CONFIGURED',
      message: `GATEWAY_ORIGIN is not a valid URL: ${configured}`,
    });
    return;
  }

  // req.url arrives as /api/<rest>?<query>. The gateway serves its routes at
  // the root, so /api comes off and everything after it goes through as-is.
  const suffix = req.url.slice('/api'.length) || '/';

  let target;
  try {
    target = new URL(suffix, base);
  } catch {
    res.status(400).json({ code: 'ERR_BAD_PATH', message: 'unroutable request path' });
    return;
  }

  // SSRF guard. A request to /api//example.com/x makes `suffix` protocol-
  // relative, and new URL() would resolve it against example.com rather than
  // the configured gateway. Refuse anything that left the configured origin.
  if (target.origin !== base.origin) {
    res.status(400).json({
      code: 'ERR_BAD_PATH',
      message: 'request path resolves outside the configured gateway',
    });
    return;
  }

  const headers = {};
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = req.headers[name];
    if (typeof value === 'string') headers[name] = value;
  }

  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined) {
    // Vercel has already parsed a JSON body into an object by the time this
    // runs, so it is re-serialised rather than streamed.
    body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  }

  let upstream;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (cause) {
    // The console distinguishes "gateway did not answer" from "gateway said
    // no" and has separate copy for each, so this must not become a 500.
    res.status(502).json({
      code: 'ERR_GATEWAY_UNREACHABLE',
      message: `gateway at ${base.origin} did not answer: ${String(cause)}`,
    });
    return;
  }

  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) res.setHeader(name, value);
  }

  const payload = Buffer.from(await upstream.arrayBuffer());
  res.status(upstream.status).send(payload);
}
