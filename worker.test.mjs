import assert from "node:assert/strict";
import worker from "../worker.js";
const kv = new Map();
const env = { LEADS: { put: async (k, v) => kv.set(k, v), get: async (k, t) => { const v = kv.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; }, delete: async (k) => kv.delete(k), list: async () => ({ keys: [...kv.keys()].map((name) => ({ name })), list_complete: true }) },
  ADMIN_TOKEN: "token-de-teste-bem-longo", ASSETS: { fetch: async () => new Response("<html>página</html>") } };
const body = JSON.stringify({ tipo: "cliente", nome: "Ana", whatsapp: "27988887777", bairro: "Centro", cidade: "Serra", categorias: [], lgpd: true, website: "" });
let r = await worker.fetch(new Request("https://x/api/lead", { method: "POST", body }), env); assert.equal(r.status, 200);
r = await worker.fetch(new Request("https://x/api/lead"), env); assert.equal(r.status, 405);
r = await worker.fetch(new Request("https://x/api/leads"), env); assert.equal(r.status, 401);
r = await worker.fetch(new Request("https://x/api/leads", { headers: { Authorization: "Bearer " + env.ADMIN_TOKEN } }), env); assert.equal((await r.json()).total, 1);
r = await worker.fetch(new Request("https://x/api/nada"), env); assert.equal(r.status, 404);
r = await worker.fetch(new Request("https://x/"), env); assert.match(await r.text(), /página/);
console.log("worker ok");
