const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const express = require("express");
const { createBareServer } = require("@tomphttp/bare-server-node");
const { server: wispServer, logging: wispLogging } = require("@mercuryworkshop/wisp-js/server");
const { baremuxPath } = require("@mercuryworkshop/bare-mux/node");
const { bareModulePath } = require("@mercuryworkshop/bare-as-module3");

function resolvePackageDist(packageName, distDir = "dist") {
  try {
    let packageRoot;
    try {
      const pkgPath = require.resolve(`${packageName}/package.json`);
      packageRoot = path.dirname(pkgPath);
    } catch {
      const entryPath = require.resolve(packageName);
      packageRoot = path.resolve(path.dirname(entryPath), "..");
    }

    const resolved = path.join(packageRoot, distDir);
    if (fs.existsSync(resolved)) return resolved;
    return undefined;
  } catch {
    return undefined;
  }
}

const epoxyPath = resolvePackageDist("@mercuryworkshop/epoxy-transport");
const libcurlPath = resolvePackageDist("@mercuryworkshop/libcurl-transport");
if (!libcurlPath) {
  console.warn("libcurl transport not available, skipping.");
}

const uvDist = path.dirname(require.resolve("@titaniumnetwork-dev/ultraviolet/dist/uv.bundle.js"));
const scramjetDist = path.dirname(require.resolve("@mercuryworkshop/scramjet/dist/scramjet.bundle.js"));
const uvSwPath = path.join(uvDist, "sw.js");
const controllerPath = path.join(process.cwd(), "assets", "sc", "scramjet.controller.js");
const root = path.resolve(process.cwd());

const bare = createBareServer("/bare/", {
  logErrors: true,
  blockLocal: false,
});

wispServer.options.allow_loopback_ips = true;
wispServer.options.allow_private_ips = true;
wispServer.options.allow_direct_ip = true;
wispLogging.set_level(wispLogging.INFO);

console.log("Ultraviolet path:", uvDist);
console.log("Ultraviolet service worker path:", uvSwPath);
console.log("Scramjet path:", scramjetDist);
console.log("UV sw exists:", fs.existsSync(uvSwPath));
console.log("Epoxy path:", epoxyPath || "missing");

const uvConfigScript = `(() => {
  self.__uv$config = {
    prefix: "/service/",
    encodeUrl: Ultraviolet.codec.xor.encode,
    decodeUrl: Ultraviolet.codec.xor.decode,
    handler: "/uv.handler.js",
    client: "/uv.client.js",
    bundle: "/uv.bundle.js",
    config: "/uv.config.js",
    sw: "/uv.sw.js",
  };
})();`;

const scramjetConfigScript = `(() => {
  const codec =
    (self.__scramjet$codecs && self.__scramjet$codecs.plain) ||
    {
      encode: (value) => encodeURIComponent(value),
      decode: (value) => decodeURIComponent(value),
    };

  self.__scramjet$config = {
    prefix: "/sc/",
    codec,
    config: "/sc/scramjet.config.js",
    bundle: "/sc/scramjet.bundle.js",
    worker: "/sc/scramjet.worker.js",
    client: "/sc/scramjet.client.js",
    codecs: "/sc/scramjet.codecs.js",
  };
})();`;

const app = express();
const rawProxyLogger = express.raw({ type: "*/*", limit: "1mb" });
app.post("/__proxy-state", rawProxyLogger, (req, res) => {
  const body = req.body?.toString?.("utf8") || "";
  if (body) {
    console.log("[proxy-state]", body);
  }
  res.sendStatus(204);
});

app.use((req, res, next) => {
  const hostHeader = req.headers.host || "";
  if (hostHeader.startsWith("0.0.0.0")) {
    const parts = hostHeader.split(":");
    const redirectPort = parts[1] ? `:${parts[1]}` : "";
    res.redirect(302, `http://localhost${redirectPort}${req.originalUrl || req.url}`);
    return;
  }
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  next();
});

app.use((req, res, next) => {
  if (req.url && (req.url.startsWith("/service/") || req.url.startsWith("/sc/") || req.url.startsWith("/uv/"))) {
    console.log(`[proxy request] ${req.method} ${req.url}`);
  }
  next();
});

app.get(["/uv/uv.config.js", "/service/uv.config.js"], (req, res) => {
  res.type("application/javascript").send(uvConfigScript);
});

app.get("/sc/scramjet.config.js", (req, res) => {
  res.type("application/javascript").send(scramjetConfigScript);
});

app.get("/sc/scramjet.controller.js", (req, res) => {
  res.sendFile(controllerPath, (err) => {
    if (err) {
      console.error("Failed to send Scramjet controller", err);
      res.status(err.status || 500).send("controller error");
    }
  });
});

app.get("/service/sw.js", (req, res) => {
  res.sendFile(uvSwPath, (err) => {
    if (err) {
      console.error("Failed to send UV service worker", err);
      res.status(err.status || 500).send("service worker error");
    }
  });
});

const registerStatic = (prefix, distPath) => {
  if (!distPath) {
    console.warn(`Skipping ${prefix}: dist path missing`);
    return;
  }
  app.use(prefix, express.static(distPath));
};

registerStatic("/uv", uvDist);
registerStatic("/service", uvDist);
registerStatic("/", uvDist);
registerStatic("/sc", scramjetDist);
registerStatic("/baremux", baremuxPath);
registerStatic("/epoxy", epoxyPath);
registerStatic("/baremod", bareModulePath);
registerStatic("/libcurl", libcurlPath);

app.get("/service/__uv_boot", (req, res) => {
  const target = typeof req.query.target === "string" ? req.query.target : "";
  if (!target || !target.startsWith("/service/")) {
    res.status(400).type("text/plain").send("Invalid UV target");
    return;
  }

  const safeTarget = JSON.stringify(target);
  res.type("text/html").send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Starting proxy...</title>
  <style>
    html,body{height:100%;margin:0;background:#06080f;color:#dfe7ff;font-family:Arial,sans-serif;display:grid;place-items:center}
    .wrap{opacity:.9;text-align:center}
  </style>
</head>
<body>
  <div class="wrap">Initializing proxy...</div>
  <script>
    (async () => {
      try {
        const target = ${safeTarget};
        const key = "__uv_boot_retry_" + btoa(target).replace(/=/g, "");
        const tries = Number(sessionStorage.getItem(key) || "0");
        if (tries > 2) throw new Error("Service worker did not take control");
        if (!("serviceWorker" in navigator)) throw new Error("Service workers unavailable");
        await navigator.serviceWorker.register("/service/sw.js", { scope: "/service/" }).catch(() => null);
        const ready = await navigator.serviceWorker.ready;

        if (!navigator.serviceWorker.controller) {
          await new Promise((resolve) => {
            const timeout = setTimeout(resolve, 1800);
            navigator.serviceWorker.addEventListener("controllerchange", () => {
              clearTimeout(timeout);
              resolve();
            }, { once: true });
          });
        }

        if (navigator.serviceWorker.controller || ready?.active || ready?.waiting || ready?.installing) {
          sessionStorage.removeItem(key);
          location.replace(target);
          return;
        }

        sessionStorage.setItem(key, String(tries + 1));
        location.reload();
      } catch (error) {
        sessionStorage.removeItem(key);
        document.querySelector(".wrap").textContent = "Proxy startup failed: " + (error && error.message ? error.message : error);
      }
    })();
  </script>
</body>
</html>`);
});

app.use(express.static(root));

app.use((req, res) => {
  res.sendFile(path.join(root, "index.html"));
});

const server = http.createServer((req, res) => {
  if (req.url && req.url.startsWith("/wisp")) {
    console.log(`[wisp request] ${req.method} ${req.url}`);
    wispServer.routeRequest(req, res);
    return;
  }

  if (bare.shouldRoute(req)) {
    console.log(`[bare request] ${req.method} ${req.url}`);
    bare.routeRequest(req, res);
    return;
  }

  app(req, res);
});

server.on("upgrade", (req, socket, head) => {
  if (req.url && req.url.startsWith("/wisp")) {
    console.log(`[wisp upgrade] ${req.method} ${req.url}`);
    wispServer.routeRequest(req, socket, head, { logLevel: wispLogging.INFO });
    return;
  }

  if (bare.shouldRoute(req)) {
    console.log(`[bare upgrade] ${req.method} ${req.url}`);
    bare.routeUpgrade(req, socket, head);
    return;
  }

  socket.end();
});

server.on("clientError", (err, socket) => {
  if (err && err.code !== "ERR_HTTP_REQUEST_TIMEOUT") {
    console.error("HTTP client error", err.message);
  }
  socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

const requestedPort = Number.parseInt(process.env.PORT, 10) || 8080;
const host = "0.0.0.0";

function listenWithFallback(port, retriesLeft = 5) {
  server.once("error", (error) => {
    if (error && error.code === "EADDRINUSE" && retriesLeft > 0) {
      const nextPort = port + 1;
      console.warn(`Port ${port} is in use, retrying on ${nextPort}...`);
      setTimeout(() => listenWithFallback(nextPort, retriesLeft - 1), 150);
      return;
    }

    console.error("Server failed to start:", error);
    process.exit(1);
  });

  server.listen(port, host, () => {
    console.log(`Listening on http://localhost:${port}`);
    console.log(`Listening on http://${host}:${port}`);
  });
}

listenWithFallback(requestedPort);

function shutdown() {
  console.log("Shutting down servers...");
  server.close();
  bare.close();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
