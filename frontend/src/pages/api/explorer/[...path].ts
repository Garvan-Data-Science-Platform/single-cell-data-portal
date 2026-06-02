import type { NextApiRequest, NextApiResponse } from "next";
import https from "https";
// import fs from "fs";
import { URL } from "url";
import configs from "../../../configs/configs";

// Determine if we are running locally or in the cloud
const deploymentStage = process.env.DEPLOYMENT_STAGE;
const isLocalDev = deploymentStage !== 'prod';

// Only create the insecure agent if we are working on our local laptop
const agent = isLocalDev 
  ? new https.Agent({ rejectUnauthorized: false }) 
  : undefined; // In the cloud, 'undefined' tells Node to use its native secure agent

export const config = { api: { bodyParser: false, responseLimit: false } };

export default function handler(req: NextApiRequest, res: NextApiResponse) {

  if (!configs.EXPLORER_URL) {
     res.status(500).end("Explorer URL is not configured");
     return;
   }
   if (!req.query.path) {
     res.status(400).end("Missing explorer path");
     return;
   }
  
  // 1. Get the actual path from Next.js query array
  // e.g., 37196609-7a29-4ec2-af60-08b4316e235a.cxg/static/main-af4202593ec3072535c6.css
  // req.query.path segments are decoded once by Next.js routing (e.g. %25 → %)
  const parts = (Array.isArray(req.query.path) ? req.query.path : [req.query.path as string])
    .map((segment) => encodeURIComponent(segment));
  const joinedPath = parts.join("/");

  // 2. Safely capture any query strings (?foo=bar) to pass along
  // just for safety, may not be needed for our case
  const queryString = req.url?.includes("?") ? req.url.substring(req.url.indexOf("?")) : "";

  // 3. Prepare upstream routing boundaries
  // only trailing slash on .cxg dataset, not on static assets
  const needsTrailingSlash = joinedPath.endsWith(".cxg");
  const pathWithSlash = needsTrailingSlash ? `${joinedPath}/` : joinedPath;

  // 4. Construct final target destination
  // e.g., https://explorer.corporanet.local:5000/e/37196609-7a29-4ec2-af60-08b4316e235a.cxg/
  // https://explorer.corporanet.local:5000/e/37196609-7a29-4ec2-af60-08b4316e235a.cxg/static/main-54a1b36a81eb3a4cb9a6.js
  // https://explorer.corporanet.local:5000/s3_uri/s3%253A%252F%252Fcorpora-data-dev%252F37196609-7a29-4ec2-af60-08b4316e235a.cxg/api/v0.3/config
  // => https://explorer.corporanet.local:5000/s3_uri/s3://corpora-data-dev/37196609-7a29-4ec2-af60-08b4316e235a.cxg/api/v0.3/config
  // /s3_uri/<encoded-s3-uri>/api/v0.3/... paths are Flask routes registered at
  // the root (not under /e/), so they must not get the /e/ prefix
  const isS3UriPath = joinedPath.startsWith("s3_uri/");
  const upstreamPath = isS3UriPath ? `/${pathWithSlash}` : `/e/${pathWithSlash}`;
  const upstream = `${configs.EXPLORER_URL}${upstreamPath}${queryString}`;
  const url = new URL(upstream);

  //-------------------------------------
  // Get the response

  // Strip hop-by-hop and sensitive request headers that must not be forwarded to the upstream
  const reqHeaders = { ...req.headers } as Record<string, string | string[] | undefined>;
  delete reqHeaders["connection"];
  delete reqHeaders["transfer-encoding"];
  delete reqHeaders["cookie"];
  delete reqHeaders["authorization"];
  reqHeaders["host"] = url.host;

  // For .cxg dataset pages we buffer and patch the HTML response body
  // Ask the upstream for uncompressed content so the buffer contains plain
  // UTF-8 text, not gzip/brotli bytes (which would cause ERR_CONTENT_DECODING_FAILED)
  if (needsTrailingSlash) {
    reqHeaders["accept-encoding"] = "identity";
  }

  const proxyReq = https.request(
    {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: req.method,
      headers: reqHeaders,
      ...(agent && { agent }),
    },
    (proxyRes) => {
      // Node.js already de-chunks Transfer-Encoding:chunked internally when reading
      // proxyRes, so forwarding that header would corrupt the response in the browser
      // Also strip other hop-by-hop headers
      const HOP_BY_HOP = new Set(["transfer-encoding", "connection", "keep-alive", "trailer"]);
      const headers: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(proxyRes.headers)) {
        if (!HOP_BY_HOP.has(k.toLowerCase()) && v !== undefined) {
          headers[k] = v as string | string[];
        }
      }

      // Override the portal's strict CSP for all explorer responses
      // res.writeHead() takes precedence over res.setHeader() (used by Next.js's
      // headers() config), so this replaces the portal CSP rather than adding a
      // second header that browsers would add together
      // Key relaxations needed by the explorer:
      //   - base-uri 'self'        → allows the <base> tag we inject
      //   - 'unsafe-inline'        → allows window.CELLXGENE inline scripts
      //   - browser.sentry-cdn.com → explorer's error tracking CDN
      headers["content-security-policy"] = [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://plausible.io https://browser.sentry-cdn.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "img-src 'self' data: blob:",
        "connect-src 'self' https://sentry.prod.si.czi.technology https://plausible.io https://browser.sentry-cdn.com",
        "base-uri 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'",
      ].join("; ");

      const contentType = (proxyRes.headers["content-type"] as string) || "";

      // ── HTML PATCHING for .cxg dataset pages ──────────────────────────────
      // The explorer HTML is served without a trailing slash in the browser URL
      // (/e/dataset.cxg instead of /e/dataset.cxg/).  This breaks two things:
      //
      //  1. Relative asset paths (src="static/main.js") resolve relative to /e/
      //     instead of /e/dataset.cxg/  →  404 with wrong MIME type.
      //     Fix: inject <base href="/e/dataset.cxg/"> so every relative URL in
      //     HTML attributes is resolved against the correct directory.
      //     Also replace any explorer-origin <base> the server may have set,
      //     so assets are fetched through the frontend proxy instead of directly.
      //
      //  2. window.CELLXGENE.API.prefix uses `${location.pathname}api/` which
      //     becomes /e/dataset.cxgapi/ (missing slash).
      //     Fix: replace that template expression with a hardcoded path.
      if (needsTrailingSlash && contentType.includes("text/html")) {
        // Drop content-length — it will change after patching.
        delete headers["content-length"];

        const chunks: Buffer[] = [];
        proxyRes.on("data", (chunk: Buffer) => chunks.push(chunk));
        proxyRes.on("end", () => {
          let html = Buffer.concat(chunks).toString("utf8");

          // 1. Replace any upstream <base> (e.g. pointing to explorer.corporanet.local)
          //    or inject one at the start of <head>.
          // e.g., change base to /e/37196609-7a29-4ec2-af60-08b4316e235a.cxg/
          const baseTag = `<base href="/e/${joinedPath}/">`;
          if (/<base\s/i.test(html)) {
            html = html.replace(/<base\s[^>]*>/i, baseTag);
          } else {
            html = html.replace("<head>", `<head>\n  ${baseTag}`);
          }

          // 2. Fix the initial CELLXGENE.API.prefix object literal so it uses a
          //    slash-terminated path instead of location.pathname (which has no trailing
          //    slash in the browser URL).
          // from https://frontend.corporanet.local:3000/e/37196609-7a29-4ec2-af60-08b4316e235a.cxgapi/
          // to https://frontend.corporanet.local:3000/e/37196609-7a29-4ec2-af60-08b4316e235a.cxg/api/
          // Note: this is for stopping the application from breaking the moment it is born.
          html = html.replace(
            "${location.origin}${location.pathname}api/",
            `\${location.origin}/e/${joinedPath}/api/`
          );

          // 3. Fix the api_base_url inline script that overwrites window.CELLXGENE.API.prefix.
          //    When api_base_url is configured in the explorer server (e.g.
          //    https://explorer.corporanet.local:5500/cellxgene/), Flask injects:
          //      window.CELLXGENE.API.prefix = `<explorer-url>/${location.pathname}api/`;
          //    This fires AFTER the object literal above, overwriting our fix, and it
          //    also points directly to the explorer origin (bypassing the proxy).
          //    Replace the entire assignment with the hardcoded frontend-proxy path.
          // e.g., from prefix: `${location.origin}${location.pathname}api/`,
          // to window.CELLXGENE.API.prefix = `${location.origin}/e/37196609-7a29-4ec2-af60-08b4316e235a.cxg/api/`,
          // Note: this is for stopping Flask from hijacking and breaking the application a moment later.
          html = html.replace(
            /window\.CELLXGENE\.API\.prefix\s*=\s*`[^`]+`/,
            `window.CELLXGENE.API.prefix = \`\${location.origin}/e/${joinedPath}/api/\``
          );

          res.writeHead(proxyRes.statusCode!, headers);
          res.end(html);
        });
        return;
      }
      // ── end HTML patching ─────────────────────────────────────────────────

      res.writeHead(proxyRes.statusCode!, headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on("error", (err) => {
    console.error("Proxy error:", err);
    res.status(502).end("Bad Gateway");
  });

  req.pipe(proxyReq);
}
