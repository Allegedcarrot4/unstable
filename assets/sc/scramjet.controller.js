(() => {
  const prefix = "/sc/";
  const fallbackCodec = {
    encode: (value) => encodeURIComponent(value),
    decode: (value) => decodeURIComponent(value),
  };

  function resolveCodec() {
    return (
      (window.__scramjet$config && window.__scramjet$config.codec) ||
      fallbackCodec
    );
  }

  function encode(value) {
    const codec = resolveCodec();
    const raw = typeof value === "string" ? value : value?.toString?.() ?? "";
    const enc = typeof codec.encode === "function" ? codec.encode : fallbackCodec.encode;
    return prefix + enc(raw);
  }

  async function registerWorker() {
    if (!("serviceWorker" in navigator)) return;
    try {
      const registration = await navigator.serviceWorker.register(
        prefix + "scramjet.worker.js",
        { scope: prefix }
      );

      const activeWorker = registration.active || registration.installing || registration.waiting;
      if (activeWorker) {
        activeWorker.postMessage({
          scramjet$type: "loadConfig",
          config: window.__scramjet$config,
        });
      }

      navigator.serviceWorker.addEventListener("controllerchange", () => {
        const controller = navigator.serviceWorker.controller;
        if (controller) {
          controller.postMessage({
            scramjet$type: "loadConfig",
            config: window.__scramjet$config,
          });
        }
      });
    } catch (error) {
      console.error("Failed to register Scramjet service worker", error);
    }
  }

  function resolveReady() {
    if (window.scramjetControllerReadyResolve) {
      window.scramjetControllerReadyResolve();
      delete window.scramjetControllerReadyResolve;
    }
  }

  window.scramjetController = {
    prefix,
    encode,
    register: registerWorker,
  };

  Promise.resolve()
    .then(registerWorker)
    .catch(() => {})
    .finally(resolveReady);
})();
