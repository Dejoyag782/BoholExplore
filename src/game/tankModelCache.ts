export const TANK_MODEL_URL = "/models/tank-v1.glb?v=1";

const TANK_MODEL_CACHE = "boholtrips-tank-model-v1";
let cachePromise: Promise<void> | null = null;

const fetchTankModel = async () => {
  if (!("caches" in window)) {
    const response = await fetch(TANK_MODEL_URL, { cache: "force-cache" });
    if (!response.ok) throw new Error(`Tank model request failed: ${response.status}`);
    await response.arrayBuffer();
    return;
  }

  const cache = await caches.open(TANK_MODEL_CACHE);
  if (await cache.match(TANK_MODEL_URL)) return;
  const response = await fetch(TANK_MODEL_URL);
  if (!response.ok) throw new Error(`Tank model request failed: ${response.status}`);
  await cache.put(TANK_MODEL_URL, response);
};

export const ensureTankModelCached = () => {
  if (!cachePromise) {
    cachePromise = fetchTankModel().catch((cause) => {
      cachePromise = null;
      throw cause;
    });
  }
  return cachePromise;
};

export const getTankModelLoadUrl = async () => {
  await ensureTankModelCached();
  if (!("caches" in window)) {
    return { url: TANK_MODEL_URL, revoke: () => undefined };
  }

  const cache = await caches.open(TANK_MODEL_CACHE);
  const response = await cache.match(TANK_MODEL_URL);
  if (!response) return { url: TANK_MODEL_URL, revoke: () => undefined };
  const objectUrl = URL.createObjectURL(await response.blob());
  return { url: objectUrl, revoke: () => URL.revokeObjectURL(objectUrl) };
};
