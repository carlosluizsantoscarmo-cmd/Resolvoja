// Teste das funções com um KV de mentira. Rode: node test/functions.test.mjs
import assert from "node:assert/strict";
import * as lead from "../functions/api/lead.js";
import * as leads from "../functions/api/leads.js";

class FakeKV {
  m = new Map();
  async put(k, v) { this.m.set(k, v); }
  async get(k, t) { const v = this.m.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; }
  async delete(k) { this.m.delete(k); }
  async list({ prefix = "", cursor } = {}) {
    const all = [...this.m.keys()].filter((k) => k.startsWith(prefix)).sort();
    const start = cursor ? Number(cursor) : 0, page = all.slice(start, start + 2);   // páginas de 2 para testar o cursor
    const done = start + 2 >= all.length;
    return { keys: page.map((name) => ({ name })), list_complete: done, cursor: done ? undefined : String(start + 2) };
  }
}
const env = () => ({ LEADS: new FakeKV(), ADMIN_TOKEN: "token-de-teste-bem-longo", ALLOWED_ORIGINS: "https://www.resolvoja.app.br,https://resolvoja.app.br" });
const post = (body, headers = {}) => new Request("https://x/api/lead", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const ok = { tipo: "cliente", nome: "Maria", whatsapp: "(27) 9 8888-7777", bairro: "Laranjeiras", cidade: "Serra", categorias: ["Eletricista"], obs: "oi", lgpd: true, website: "" };
const call = (fn, request, e) => fn({ request, env: e });
let n = 0; const t = async (name, f) => { await f(); n++; console.log("ok -", name); };

await t("cadastro válido grava", async () => {
  const e = env(); const r = await call(lead.onRequestPost, post(ok), e);
  assert.equal(r.status, 200); assert.equal(e.LEADS.m.size, 1);
  const rec = JSON.parse([...e.LEADS.m.values()][0]); assert.equal(rec.nome, "Maria"); assert.ok(rec.lgpdAceitoEm);
});
await t("mesmo telefone não duplica", async () => {
  const e = env(); await call(lead.onRequestPost, post(ok), e); await call(lead.onRequestPost, post({ ...ok, nome: "Maria 2" }), e);
  assert.equal(e.LEADS.m.size, 1); assert.equal(JSON.parse([...e.LEADS.m.values()][0]).nome, "Maria 2");
});
await t("campo-isca preenchido não grava mas responde 200", async () => {
  const e = env(); const r = await call(lead.onRequestPost, post({ ...ok, website: "http://spam" }), e);
  assert.equal(r.status, 200); assert.equal(e.LEADS.m.size, 0);
});
await t("validações", async () => {
  const e = env();
  for (const bad of [{ nome: "" }, { whatsapp: "123" }, { bairro: "" }, { lgpd: false }, { tipo: "x" }, { tipo: "pro", categorias: [] }, { tipo: "pro", categorias: ["Hacker"] }]) {
    const r = await call(lead.onRequestPost, post({ ...ok, ...bad }), e); assert.equal(r.status, 400, JSON.stringify(bad));
  }
  assert.equal(e.LEADS.m.size, 0);
});
await t("JSON inválido e corpo grande", async () => {
  const e = env();
  assert.equal((await call(lead.onRequestPost, post("{nope"), e)).status, 400);
  assert.equal((await call(lead.onRequestPost, post({ ...ok, obs: "a".repeat(6000) }), e)).status, 413);
});
await t("origem de outro site é recusada; a do site e a prévia passam", async () => {
  const e = env();
  assert.equal((await call(lead.onRequestPost, post(ok, { Origin: "https://evil.com" }), e)).status, 403);
  assert.equal((await call(lead.onRequestPost, post(ok, { Origin: "https://www.resolvoja.app.br" }), e)).status, 200);
  assert.equal((await call(lead.onRequestPost, post(ok, { Origin: "https://abc.resolvoja.pages.dev" }), e)).status, 200);
});
await t("sem KV configurado dá erro claro", async () => {
  const r = await call(lead.onRequestPost, post(ok), { }); assert.equal(r.status, 500);
});
await t("pro grava experiência e categorias sem duplicar", async () => {
  const e = env(); await call(lead.onRequestPost, post({ ...ok, tipo: "pro", categorias: ["Encanador", "Encanador", "Pintor"], experiencia: "1 a 3 anos" }), e);
  const rec = JSON.parse([...e.LEADS.m.values()][0]); assert.deepEqual(rec.categorias, ["Encanador", "Pintor"]); assert.equal(rec.experiencia, "1 a 3 anos");
});

const get = (url, token) => new Request(url, { headers: token ? { Authorization: "Bearer " + token } : {} });
await t("lista exige token certo", async () => {
  const e = env(); await call(lead.onRequestPost, post(ok), e);
  assert.equal((await call(leads.onRequestGet, get("https://x/api/leads"), e)).status, 401);
  assert.equal((await call(leads.onRequestGet, get("https://x/api/leads", "errado"), e)).status, 401);
  const r = await call(leads.onRequestGet, get("https://x/api/leads", e.ADMIN_TOKEN), e);
  assert.equal(r.status, 200); const d = await r.json(); assert.equal(d.total, 1); assert.equal(d.items[0].nome, "Maria");
});
await t("token de administração curto demais é recusado", async () => {
  const e = { ...env(), ADMIN_TOKEN: "curto" };
  assert.equal((await call(leads.onRequestGet, get("https://x/api/leads", "curto"), e)).status, 401);
  assert.equal((await call(leads.onRequestGet, get("https://x/api/leads", ""), { ...e, ADMIN_TOKEN: "" })).status, 401);
});
await t("lista percorre várias páginas do KV", async () => {
  const e = env(); for (let i = 0; i < 5; i++) await call(lead.onRequestPost, post({ ...ok, whatsapp: "2798888777" + i }), e);
  const d = await (await call(leads.onRequestGet, get("https://x/api/leads", e.ADMIN_TOKEN), e)).json(); assert.equal(d.total, 5);
});
await t("CSV neutraliza fórmulas e escapa aspas", async () => {
  const e = env(); await call(lead.onRequestPost, post({ ...ok, nome: '=HYPERLINK("http://x")', obs: 'disse "oi"' }), e);
  const r = await call(leads.onRequestGet, get("https://x/api/leads?format=csv", e.ADMIN_TOKEN), e);
  const txt = await r.text(); assert.match(r.headers.get("Content-Type"), /text\/csv/);
  assert.ok(txt.includes(`"'=HYPERLINK(""http://x"")"`), txt); assert.ok(txt.includes('"disse ""oi"""'));
});
await t("exclusão por chave válida, e chave inválida recusada", async () => {
  const e = env(); await call(lead.onRequestPost, post(ok), e); const key = [...e.LEADS.m.keys()][0];
  const del = (k, tk) => new Request("https://x/api/leads?key=" + encodeURIComponent(k), { method: "DELETE", headers: tk ? { Authorization: "Bearer " + tk } : {} });
  assert.equal((await call(leads.onRequestDelete, del(key), e)).status, 401);
  assert.equal((await call(leads.onRequestDelete, del("outra:chave", e.ADMIN_TOKEN), e)).status, 400);
  assert.equal((await call(leads.onRequestDelete, del(key, e.ADMIN_TOKEN), e)).status, 200); assert.equal(e.LEADS.m.size, 0);
});
console.log(`\n${n} testes passaram`);
