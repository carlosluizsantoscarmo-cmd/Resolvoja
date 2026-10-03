// Site Resolvo Já — Worker único (tudo em um arquivo, para facilitar o envio ao GitHub).
// As páginas vêm da pasta public (binding ASSETS); só os endereços /api/* passam por aqui.
// Gerado a partir de functions/api/*.js; a pasta functions só é usada pelos testes.

// ---- utilidades ----
// Utilidades compartilhadas das funções do Cloudflare Pages (o arquivo começa com "_" e não vira rota).
function json(status, data, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra },
  });
}

// Comparação em tempo constante, para não vazar o token pelo tempo de resposta.
async function tokenMatches(given, expected) {
  if (!given || !expected) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// ---- POST /api/lead ----
// POST /api/lead — recebe o cadastro da lista de espera e grava no Workers KV (binding LEADS).

const CATEGORIES = ["Eletricista", "Encanador", "Montador", "Pintor", "Diarista", "Fretes"];
const CITIES = ["Serra", "Vitória", "Vila Velha", "Cariacica", "Outra"];
const EXPERIENCE = ["Menos de 1 ano", "1 a 3 anos", "3 a 10 anos", "Mais de 10 anos"];
const clean = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");

async function leadPost({ request, env }) {
  if (!env.LEADS) return json(500, { error: "Servidor sem armazenamento configurado." });

  // Aceita só o próprio site (ou a prévia do Pages). Pedidos sem Origin (curl) passam; o resto dos filtros vale igual.
  const origin = request.headers.get("Origin");
  if (origin && env.ALLOWED_ORIGINS) {
    const ok = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
    const host = new URL(origin).host;
    if (!ok.includes(origin) && !host.endsWith(".pages.dev")) return json(403, { error: "Origem não permitida." });
  }

  const raw = await request.text();
  if (raw.length > 5000) return json(413, { error: "Pedido grande demais." });
  let b;
  try { b = JSON.parse(raw); } catch { return json(400, { error: "Pedido inválido." }); }
  if (!b || typeof b !== "object") return json(400, { error: "Pedido inválido." });

  // Campo-isca: pessoas não veem; robôs preenchem. Finge sucesso e não grava.
  if (typeof b.website === "string" && b.website !== "") return json(200, { ok: true });

  const tipo = b.tipo === "pro" ? "pro" : b.tipo === "cliente" ? "cliente" : null;
  const nome = clean(b.nome, 100);
  const whatsapp = clean(b.whatsapp, 30);
  const digits = whatsapp.replace(/\D/g, "");
  const bairro = clean(b.bairro, 80);
  if (!tipo) return json(400, { error: "Escolha se você quer contratar ou é profissional." });
  if (!nome) return json(400, { error: "Informe seu nome." });
  if (digits.length < 10 || digits.length > 13) return json(400, { error: "Confira o WhatsApp. Use o DDD." });
  if (!bairro) return json(400, { error: "Informe o seu bairro." });
  if (b.lgpd !== true) return json(400, { error: "Marque a autorização para continuar." });

  const cidade = CITIES.includes(b.cidade) ? b.cidade : "Outra";
  const categorias = Array.isArray(b.categorias) ? [...new Set(b.categorias.filter((c) => CATEGORIES.includes(c)))] : [];
  if (tipo === "pro" && categorias.length === 0) return json(400, { error: "Escolha pelo menos uma categoria." });

  const rec = {
    tipo, nome, whatsapp, bairro, cidade, categorias,
    obs: clean(b.obs, 500),
    experiencia: tipo === "pro" && EXPERIENCE.includes(b.experiencia) ? b.experiencia : null,
    lgpdAceitoEm: new Date().toISOString(),
    criadoEm: new Date().toISOString(),
  };
  // A chave é o telefone: quem envia duas vezes atualiza o próprio cadastro, sem duplicar.
  await env.LEADS.put(`lead:${tipo}:${digits}`, JSON.stringify(rec));
  return json(200, { ok: true });
}

async function leadOther({ request }) {
  return json(405, { error: "Método não permitido." }, { Allow: "POST" });
}

// ---- GET/DELETE /api/leads ----
// GET /api/leads — lista os cadastros. Exige o cabeçalho "Authorization: Bearer <ADMIN_TOKEN>".
// ?format=csv devolve uma planilha. DELETE /api/leads?key=lead:... remove um cadastro (pedido de exclusão pela LGPD).

// Devolve "ok", "bad" (senha errada) ou um texto explicando por que o servidor não está configurado.
async function authorized(request, env) {
  if (!env.ADMIN_TOKEN) return { unconfigured: "A senha da equipe (ADMIN_TOKEN) não está configurada neste servidor." };
  if (env.ADMIN_TOKEN.length < 16) return { unconfigured: "A senha da equipe (ADMIN_TOKEN) tem menos de 16 caracteres. Crie uma maior." };
  const h = request.headers.get("Authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  return (await tokenMatches(token, env.ADMIN_TOKEN)) ? "ok" : "bad";
}
const deny = (a) => (a.unconfigured ? json(503, { error: a.unconfigured }) : json(401, { error: "Não autorizado." }));

// Evita que o Excel execute fórmulas colocadas num cadastro (=, +, -, @).
const csvCell = (v) => {
  let s = Array.isArray(v) ? v.join("; ") : v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
};

async function leadsGet({ request, env }) {
  if (!env.LEADS) return json(500, { error: "Servidor sem armazenamento configurado." });
  const a = await authorized(request, env);
  if (a !== "ok") return deny(a);

  const items = [];
  let cursor;
  do {
    const page = await env.LEADS.list({ prefix: "lead:", cursor });
    for (const k of page.keys) {
      const v = await env.LEADS.get(k.name, "json");
      if (v) items.push({ key: k.name, ...v });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  items.sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || ""));

  if (new URL(request.url).searchParams.get("format") === "csv") {
    const cols = ["criadoEm", "tipo", "nome", "whatsapp", "bairro", "cidade", "categorias", "experiencia", "obs"];
    const csv = [cols.join(","), ...items.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\r\n");
    return new Response("﻿" + csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="cadastros.csv"', "Cache-Control": "no-store" },
    });
  }
  return json(200, { total: items.length, items });
}

async function leadsDelete({ request, env }) {
  if (!env.LEADS) return json(500, { error: "Servidor sem armazenamento configurado." });
  const a = await authorized(request, env);
  if (a !== "ok") return deny(a);
  const key = new URL(request.url).searchParams.get("key") || "";
  if (!/^lead:(cliente|pro):\d{10,13}$/.test(key)) return json(400, { error: "Chave inválida." });
  await env.LEADS.delete(key);
  return json(200, { ok: true });
}

async function leadsOther() {
  return json(405, { error: "Método não permitido." }, { Allow: "GET, DELETE" });
}

// ---- Pagamentos (Mercado Pago, Checkout Pro) ----
// POST /api/checkout   cria o pedido no KV e uma preferência no Mercado Pago; devolve o link de pagamento.
// POST /api/mp-webhook recebe o aviso do Mercado Pago, confere a assinatura, consulta o pagamento e só então marca como pago.
// GET  /api/pedido?id= devolve só o status de um pedido (para a página de retorno).
// GET  /api/pedidos    lista os pedidos (equipe, com ADMIN_TOKEN).
// Segredos no Cloudflare: MP_ACCESS_TOKEN e MP_WEBHOOK_SECRET. O preço vem sempre daqui, nunca do navegador.
const CATALOGO = {
  "cadastro-pro": { titulo: "Taxa de cadastro de profissional - Resolvo Já", cents: 2990 }, // EXEMPLO: R$ 29,90. Ajuste.
};
const MP_API = "https://api.mercadopago.com";
const ORDER_TTL = 60 * 60 * 24 * 180;
const orderKey = (id) => "order:" + id;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function originAllowed(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin || !env.ALLOWED_ORIGINS) return true;
  const ok = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  let host = "";
  try { host = new URL(origin).host; } catch { return false; }
  return ok.includes(origin) || host.endsWith(".pages.dev");
}

async function checkoutPost({ request, env }) {
  if (!env.LEADS) return json(500, { error: "Servidor sem armazenamento configurado." });
  if (!env.MP_ACCESS_TOKEN) return json(503, { error: "O pagamento ainda não está configurado." });
  if (!originAllowed(request, env)) return json(403, { error: "Origem não permitida." });
  const raw = await request.text();
  if (raw.length > 2000) return json(413, { error: "Pedido grande demais." });
  let b;
  try { b = JSON.parse(raw); } catch { return json(400, { error: "Pedido inválido." }); }
  if (!b || typeof b !== "object") return json(400, { error: "Pedido inválido." });
  if (typeof b.website === "string" && b.website !== "") return json(200, { ok: true }); // isca de robô

  const item = Object.prototype.hasOwnProperty.call(CATALOGO, b.item) ? CATALOGO[b.item] : null;
  const nome = clean(b.nome, 100);
  const email = clean(b.email, 120);
  if (!item) return json(400, { error: "Item inválido." });
  if (!nome) return json(400, { error: "Informe seu nome." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json(400, { error: "Confira o e-mail." });

  const id = crypto.randomUUID();
  const order = { id, item: b.item, totalCents: item.cents, status: "pending", nome, email, criadoEm: new Date().toISOString() };
  await env.LEADS.put(orderKey(id), JSON.stringify(order), { expirationTtl: ORDER_TTL });

  const site = new URL(request.url).origin;
  const back = (s) => `${site}/pagamento.html?status=${s}&pedido=${id}`;
  let res, pref;
  try {
    res = await fetch(MP_API + "/checkout/preferences", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.MP_ACCESS_TOKEN, "Content-Type": "application/json", "X-Idempotency-Key": id },
      body: JSON.stringify({
        items: [{ id: b.item, title: item.titulo, quantity: 1, currency_id: "BRL", unit_price: item.cents / 100 }],
        payer: { name: nome, email },
        external_reference: id,
        back_urls: { success: back("ok"), pending: back("pendente"), failure: back("falhou") },
        auto_return: "approved",
        notification_url: site + "/api/mp-webhook",
        statement_descriptor: "RESOLVOJA",
      }),
    });
    pref = await res.json();
  } catch (e) {
    console.error("Falha ao falar com o Mercado Pago:", e && e.message);
    return json(502, { error: "Não consegui falar com o Mercado Pago. Tente de novo." });
  }
  if (!res.ok || !pref.init_point) {
    console.error("Mercado Pago recusou a preferência:", res.status, JSON.stringify(pref).slice(0, 300));
    return json(502, { error: "O Mercado Pago recusou o pedido. Tente de novo em instantes." });
  }
  return json(200, { id, url: pref.init_point });
}

// Cabeçalho x-signature: "ts=...,v1=<hmac>". Texto assinado: "id:<data.id minúsculo>;request-id:<x-request-id>;ts:<ts>;"
async function mpSignatureValid({ secret, signature, requestId, dataId, now = Date.now() }) {
  if (!secret || !signature || !requestId || !dataId) return false;
  const parts = Object.fromEntries(String(signature).split(",").map((p) => p.trim().split("=", 2)));
  if (!parts.ts || !parts.v1) return false;
  const ts = Number(parts.ts);
  const tsMs = ts < 1e12 ? ts * 1000 : ts;
  if (!Number.isFinite(tsMs) || Math.abs(now - tsMs) > 10 * 60 * 1000) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${parts.ts};`));
  const expected = [...new Uint8Array(mac)].map((x) => x.toString(16).padStart(2, "0")).join("");
  return tokenMatches(String(parts.v1), expected);
}

async function mpWebhook({ request, env }) {
  if (!env.LEADS || !env.MP_ACCESS_TOKEN || !env.MP_WEBHOOK_SECRET) return json(503, { error: "Webhook não configurado." });
  const url = new URL(request.url);
  let body = null;
  try { body = JSON.parse((await request.text()).slice(0, 20000)); } catch { /* o id também vem na URL */ }
  const dataId = url.searchParams.get("data.id") || (body && body.data && body.data.id);
  const type = url.searchParams.get("type") || (body && body.type);
  const valid = await mpSignatureValid({
    secret: env.MP_WEBHOOK_SECRET, signature: request.headers.get("x-signature"),
    requestId: request.headers.get("x-request-id"), dataId,
  });
  if (!valid) return json(401, { error: "assinatura inválida" });
  if (type !== "payment") return json(200, { ok: true, ignorado: true });

  let payment;
  try {
    const r = await fetch(`${MP_API}/v1/payments/${encodeURIComponent(String(dataId))}`, { headers: { Authorization: "Bearer " + env.MP_ACCESS_TOKEN } });
    if (!r.ok) throw new Error("status " + r.status);
    payment = await r.json();
  } catch (e) {
    console.error("Falha ao consultar o pagamento:", e && e.message);
    return json(500, { error: "tente de novo" }); // 5xx: o Mercado Pago reenvia
  }
  const ref = String(payment.external_reference || "");
  if (!UUID.test(ref)) return json(200, { ok: true, desconhecido: true });
  const order = await env.LEADS.get(orderKey(ref), "json");
  if (!order) return json(200, { ok: true, desconhecido: true });

  if (payment.status === "approved") {
    const paidCents = Math.round(Number(payment.transaction_amount) * 100);
    if (payment.currency_id !== "BRL" || paidCents !== order.totalCents) {
      console.error(`Valor ou moeda não confere no pedido ${order.id}: pago ${paidCents} ${payment.currency_id}, esperado ${order.totalCents}`);
      return json(200, { ok: true, valorNaoConfere: true }); // não libera; conferir à mão
    }
    order.status = "paid";
    order.paidAt = order.paidAt || new Date().toISOString();
  } else if (order.status !== "paid") {
    order.status = String(payment.status || "pending"); // pending, rejected, cancelled, refunded...
  } else if (payment.status === "refunded" || payment.status === "charged_back") {
    order.status = payment.status;
  }
  order.paymentId = payment.id;
  await env.LEADS.put(orderKey(order.id), JSON.stringify(order), { expirationTtl: ORDER_TTL });
  return json(200, { ok: true });
}

async function pedidoGet({ request, env }) {
  if (!env.LEADS) return json(500, { error: "Servidor sem armazenamento configurado." });
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!UUID.test(id)) return json(400, { error: "Pedido inválido." });
  const o = await env.LEADS.get(orderKey(id), "json");
  if (!o) return json(404, { error: "Pedido não encontrado." });
  return json(200, { status: o.status }); // só o status; nada de dados pessoais
}

async function pedidosGet({ request, env }) {
  if (!env.LEADS) return json(500, { error: "Servidor sem armazenamento configurado." });
  const a = await authorized(request, env);
  if (a !== "ok") return deny(a);
  const items = [];
  let cursor;
  do {
    const page = await env.LEADS.list({ prefix: "order:", cursor });
    for (const k of page.keys) {
      const v = await env.LEADS.get(k.name, "json");
      if (v) items.push(v);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  items.sort((x, y) => (y.criadoEm || "").localeCompare(x.criadoEm || ""));
  return json(200, { total: items.length, items });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/lead") {
      return request.method === "POST" ? leadPost({ request, env }) : leadOther({ request, env });
    }
    if (pathname === "/api/leads") {
      if (request.method === "GET") return leadsGet({ request, env });
      if (request.method === "DELETE") return leadsDelete({ request, env });
      return leadsOther({ request, env });
    }
    if (pathname === "/api/checkout") return request.method === "POST" ? checkoutPost({ request, env }) : json(405, { error: "Método não permitido." }, { Allow: "POST" });
    if (pathname === "/api/mp-webhook") return request.method === "POST" ? mpWebhook({ request, env }) : json(405, { error: "Método não permitido." }, { Allow: "POST" });
    if (pathname === "/api/pedido") return request.method === "GET" ? pedidoGet({ request, env }) : json(405, { error: "Método não permitido." }, { Allow: "GET" });
    if (pathname === "/api/pedidos") return request.method === "GET" ? pedidosGet({ request, env }) : json(405, { error: "Método não permitido." }, { Allow: "GET" });
    if (pathname.startsWith("/api/")) return json(404, { error: "Não encontrado." });
    return env.ASSETS.fetch(request);
  },
};
