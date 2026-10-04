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
const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];
const EXPERIENCE = ["Menos de 1 ano", "1 a 3 anos", "3 a 10 anos", "Mais de 10 anos"];
const clean = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");

// Proteção contra robôs (Cloudflare Turnstile). Só vale se o segredo TURNSTILE_SECRET existir; sem ele, o site funciona como antes.
async function turnstileOk(env, token, request) {
  if (!env.TURNSTILE_SECRET) return true;
  if (typeof token !== "string" || !token || token.length > 2048) return false;
  try {
    const form = new FormData();
    form.append("secret", env.TURNSTILE_SECRET);
    form.append("response", token);
    const ip = request.headers.get("CF-Connecting-IP");
    if (ip) form.append("remoteip", ip);
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    const d = await r.json();
    return d && d.success === true;
  } catch (e) {
    console.error("turnstile: falha ao verificar:", e && e.message);
    return false;
  }
}

async function leadPost({ request, env, ctx }) {
  if (!env.LEADS) return json(500, { error: "Servidor sem armazenamento configurado." });

  // Aceita só o próprio site (ou a prévia do Pages). Pedidos sem Origin (curl) passam; o resto dos filtros vale igual.
  const origin = request.headers.get("Origin");
  if (origin && env.ALLOWED_ORIGINS) {
    const ok = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
    const host = new URL(origin).host;
    if (!ok.includes(origin) && !host.endsWith(".pages.dev")) return json(403, { error: "Origem não permitida." });
  }

  const raw = await request.text();
  if (raw.length > 6000) return json(413, { error: "Pedido grande demais." });
  let b;
  try { b = JSON.parse(raw); } catch { return json(400, { error: "Pedido inválido." }); }
  if (!b || typeof b !== "object") return json(400, { error: "Pedido inválido." });

  // Campo-isca: pessoas não veem; robôs preenchem. Finge sucesso e não grava.
  if (typeof b.website === "string" && b.website !== "") return json(200, { ok: true });
  if (!(await turnstileOk(env, b.turnstile, request))) return json(400, { error: "Não foi possível confirmar que você não é um robô. Atualize a página e tente de novo." });

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

  const cidade = clean(b.cidade, 60);
  const uf = UFS.includes(b.uf) ? b.uf : "ES";
  if (!cidade) return json(400, { error: "Informe a sua cidade." });
  const categorias = Array.isArray(b.categorias) ? [...new Set(b.categorias.filter((c) => CATEGORIES.includes(c)))] : [];
  if (tipo === "pro" && categorias.length === 0) return json(400, { error: "Escolha pelo menos uma categoria." });

  const rec = {
    tipo, nome, whatsapp, bairro, cidade, uf, categorias,
    obs: clean(b.obs, 500),
    experiencia: tipo === "pro" && EXPERIENCE.includes(b.experiencia) ? b.experiencia : null,
    lgpdAceitoEm: new Date().toISOString(),
    criadoEm: new Date().toISOString(),
  };
  // A chave é o telefone: quem envia duas vezes atualiza o próprio cadastro, sem duplicar.
  const leadKey = `lead:${tipo}:${digits}`;
  const jaExistia = await env.LEADS.get(leadKey);
  await env.LEADS.put(leadKey, JSON.stringify(rec));
  if (!jaExistia) {
    notifyOwner(env, ctx, `Novo cadastro: ${tipo === "pro" ? "profissional" : "cliente"} - ${nome}`,
      `Tipo: ${tipo === "pro" ? "profissional" : "cliente"}\nNome: ${nome}\nWhatsApp: ${whatsapp}\nLocal: ${bairro}, ${cidade}/${uf}` +
      (categorias.length ? `\nCategorias: ${categorias.join(", ")}` : "") + (rec.obs ? `\nObs.: ${rec.obs}` : "") +
      "\n\nVeja todos em /admin.html");
  }
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
    const cols = ["criadoEm", "tipo", "nome", "whatsapp", "bairro", "cidade", "uf", "categorias", "experiencia", "obs"];
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

// ---- Avisos por e-mail (Resend) ----
// Secrets/variáveis opcionais: RESEND_API_KEY (Secret), NOTIFY_EMAIL (e-mail que recebe os avisos),
// MAIL_FROM (remetente de um domínio verificado no Resend; sem ele não enviamos confirmação ao comprador).
// Sem RESEND_API_KEY nada é enviado e o site funciona igual.
async function sendMail(env, { to, subject, text, from }) {
  if (!env.RESEND_API_KEY || !to) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: from || env.MAIL_FROM || "Resolvo Já <onboarding@resend.dev>", to: [to], subject, text }),
    });
    if (!r.ok) console.error("e-mail recusado pelo Resend:", r.status);
    return r.ok;
  } catch (e) {
    console.error("falha ao enviar e-mail:", e && e.message);
    return false;
  }
}
// Avisa a equipe sem atrasar a resposta ao visitante.
function notifyOwner(env, ctx, subject, text) {
  const p = sendMail(env, { to: env.NOTIFY_EMAIL, subject, text });
  if (ctx && ctx.waitUntil) ctx.waitUntil(p);
  return p;
}
const brl = (cents) => "R$ " + (cents / 100).toFixed(2).replace(".", ",");

// ---- Pagamentos (Mercado Pago, Checkout Pro) ----
// POST /api/checkout   cria o pedido no KV e uma preferência no Mercado Pago; devolve o link de pagamento.
// POST /api/mp-webhook recebe o aviso do Mercado Pago, confere a assinatura, consulta o pagamento e só então marca como pago.
// GET  /api/pedido?id= devolve só o status de um pedido (para a página de retorno).
// GET  /api/pedidos    lista os pedidos (equipe, com ADMIN_TOKEN).
// DELETE /api/pedidos?id= apaga um pedido (equipe).
// Segredos no Cloudflare: MP_ACCESS_TOKEN e MP_WEBHOOK_SECRET. O preço vem sempre daqui, nunca do navegador.
const CATALOGO = {
  "cadastro-pro": { titulo: "Verificação de profissional - Resolvo Já", cents: 2990 }, // EXEMPLO: R$ 29,90. Ajuste.
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
  if (raw.length > 4000) return json(413, { error: "Pedido grande demais." });
  let b;
  try { b = JSON.parse(raw); } catch { return json(400, { error: "Pedido inválido." }); }
  if (!b || typeof b !== "object") return json(400, { error: "Pedido inválido." });
  if (typeof b.website === "string" && b.website !== "") return json(200, { ok: true }); // isca de robô
  if (!(await turnstileOk(env, b.turnstile, request))) return json(400, { error: "Não foi possível confirmar que você não é um robô. Atualize a página e tente de novo." });

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

async function mpWebhook({ request, env, ctx }) {
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
  if (!valid) { console.error("webhook: assinatura inválida", JSON.stringify({ temAssinatura: !!request.headers.get("x-signature"), temRequestId: !!request.headers.get("x-request-id"), dataId: dataId ? String(dataId) : null, type })); return json(401, { error: "assinatura inválida" }); }
  if (type !== "payment") return json(200, { ok: true, ignorado: true });

  let payment;
  try {
    payment = await fetchPayment(env, dataId);
  } catch (e) {
    console.error("Falha ao consultar o pagamento:", e && e.message);
    return json(500, { error: "tente de novo" }); // 5xx: o Mercado Pago reenvia
  }
  const r2 = await applyPayment(env, payment, ctx);
  console.log("webhook", JSON.stringify({ dataId: String(dataId), mpStatus: payment.status, resultado: r2.reason }));
  return json(200, { ok: true });
}

// Confere um pagamento (já consultado na API do Mercado Pago) contra o pedido e atualiza o status. Nunca confia no navegador.
async function applyPayment(env, payment, ctx) {
  const ref = String(payment.external_reference || "");
  if (!UUID.test(ref)) return { reason: "sem-referencia" };
  const order = await env.LEADS.get(orderKey(ref), "json");
  if (!order) return { reason: "pedido-desconhecido" };

  let primeiraVez = false;
  if (payment.status === "approved") {
    const paidCents = Math.round(Number(payment.transaction_amount) * 100);
    if (payment.currency_id !== "BRL" || paidCents !== order.totalCents) {
      console.error(`Valor ou moeda não confere no pedido ${order.id}: pago ${paidCents} ${payment.currency_id}, esperado ${order.totalCents}`);
      return { reason: "valor-nao-confere" }; // não libera; conferir à mão
    }
    primeiraVez = order.status !== "paid";
    order.status = "paid";
    order.paidAt = order.paidAt || new Date().toISOString();
  } else if (order.status !== "paid") {
    order.status = String(payment.status || "pending"); // pending, rejected, cancelled, refunded...
    if (order.status === "refunded" || order.status === "charged_back") order.refundedAt = order.refundedAt || new Date().toISOString();
  } else if (payment.status === "refunded" || payment.status === "charged_back") {
    order.status = payment.status;
    order.refundedAt = order.refundedAt || new Date().toISOString();
  }
  order.paymentId = payment.id;
  // Registros financeiros (pagos, reembolsados, contestados) ficam guardados para relatórios e contabilidade; os demais expiram em 180 dias.
  const guardar = ["paid", "refunded", "charged_back"].includes(order.status);
  await env.LEADS.put(orderKey(order.id), JSON.stringify(order), guardar ? undefined : { expirationTtl: ORDER_TTL });
  if (primeiraVez) {
    const titulo = (CATALOGO[order.item] && CATALOGO[order.item].titulo) || order.item;
    notifyOwner(env, ctx, `Pagamento confirmado: ${brl(order.totalCents)} - ${order.nome}`,
      `${titulo}\nValor: ${brl(order.totalCents)}\nNome: ${order.nome}\nE-mail: ${order.email}\nPedido: ${order.id}\nPagamento no Mercado Pago: ${payment.id}`);
    // Confirmação ao comprador: só com remetente de domínio verificado (MAIL_FROM).
    if (env.MAIL_FROM) {
      const p = sendMail(env, { to: order.email, subject: "Pagamento confirmado - Resolvo Já",
        text: `Olá, ${order.nome}!\n\nRecebemos o seu pagamento de ${brl(order.totalCents)} (${titulo}).\nPedido: ${order.id}\n\n` +
              `Você tem 7 dias para desistir e pedir o reembolso integral, respondendo este e-mail. Mais detalhes em /termos.html.\n\nResolvo Já` });
      if (ctx && ctx.waitUntil) ctx.waitUntil(p);
    }
  }
  return { reason: "ok:" + order.status, order };
}

async function fetchPayment(env, paymentId) {
  const r = await fetch(`${MP_API}/v1/payments/${encodeURIComponent(String(paymentId))}`, { headers: { Authorization: "Bearer " + env.MP_ACCESS_TOKEN } });
  if (!r.ok) throw new Error("status " + r.status);
  return r.json();
}

async function pedidoGet({ request, env, ctx }) {
  if (!env.LEADS) return json(500, { error: "Servidor sem armazenamento configurado." });
  const q = new URL(request.url).searchParams;
  const id = q.get("id") || "";
  if (!UUID.test(id)) return json(400, { error: "Pedido inválido." });
  let o = await env.LEADS.get(orderKey(id), "json");
  if (!o) return json(404, { error: "Pedido não encontrado." });

  // Na volta do Mercado Pago a URL traz payment_id. Confirmamos esse pagamento direto na API (o navegador não decide nada):
  // só vale se a referência externa for este pedido e o valor bater.
  const pid = q.get("payment_id") || "";
  if (o.status !== "paid" && /^\d{5,20}$/.test(pid) && env.MP_ACCESS_TOKEN) {
    try {
      const payment = await fetchPayment(env, pid);
      if (String(payment.external_reference) === id) {
        const r = await applyPayment(env, payment, ctx);
        console.log("retorno", JSON.stringify({ mpStatus: payment.status, resultado: r.reason }));
        if (r.order) o = r.order;
      } else {
        console.error("retorno: pagamento de outro pedido", pid);
      }
    } catch (e) {
      console.error("retorno: falha ao consultar o pagamento:", e && e.message);
    }
  }
  return json(200, { status: o.status }); // só o status; nada de dados pessoais
}

async function pedidosDelete({ request, env }) {
  if (!env.LEADS) return json(500, { error: "Servidor sem armazenamento configurado." });
  const a = await authorized(request, env);
  if (a !== "ok") return deny(a);
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!UUID.test(id)) return json(400, { error: "Pedido inválido." });
  await env.LEADS.delete(orderKey(id));
  return json(200, { ok: true });
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


// ---- Aviso de negociação (vem do Supabase quando o cliente aceita uma proposta) ----
// POST /api/negociacao  cabeçalho x-rj-secret = Secret NOTIFY_SECRET. Manda um e-mail para a equipe (NOTIFY_EMAIL).
function waLink(phone, msg) {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.length < 10) return "(sem telefone)";
  if (!d.startsWith("55")) d = "55" + d;
  return "https://wa.me/" + d + "?text=" + encodeURIComponent(msg);
}
function sameSecret(a, b) {
  a = String(a || ""); b = String(b || "");
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
async function negociacaoPost({ request, env, ctx }) {
  if (!env.NOTIFY_SECRET || env.NOTIFY_SECRET.length < 16) return json(503, { error: "Aviso não configurado." });
  if (!sameSecret(request.headers.get("x-rj-secret"), env.NOTIFY_SECRET)) return json(401, { error: "Não autorizado." });
  let b;
  try { const raw = await request.text(); if (raw.length > 6000) return json(413, { error: "Grande demais." }); b = JSON.parse(raw); }
  catch { return json(400, { error: "Pedido inválido." }); }
  const t = (x, n) => String(x == null ? "" : x).replace(/[\r\n]+/g, " ").slice(0, n);
  const cents = Number(b.amount_cents);
  if (!Number.isInteger(cents) || cents <= 0) return json(400, { error: "Valor inválido." });
  const titulo = t(b.title, 120), valor = brl(cents), comissao = brl(Math.round(cents / 10));
  const msgCli = `Olá, ${t(b.client_name, 60)}! Aqui é do Resolvo Já. Você escolheu a proposta de ${t(b.pro_name, 60)} para "${titulo}" (${valor}). Vamos combinar o pagamento?`;
  const msgPro = `Olá, ${t(b.pro_name, 60)}! Aqui é do Resolvo Já. O cliente aceitou sua proposta para "${titulo}" (${valor}). Estamos combinando o pagamento e já te avisamos para seguir.`;
  const text = [
    `Um cliente aceitou uma proposta e o pedido está aguardando pagamento.`, ``,
    `Serviço: ${titulo} (${t(b.category, 40)}) - ${t(b.bairro, 60)}, ${t(b.city, 60)}`,
    `Valor: ${valor} (sua comissão de 10%: ${comissao})`,
    b.eta ? `Prazo combinado: ${t(b.eta, 80)}` : "", ``,
    `CLIENTE: ${t(b.client_name, 60)} - ${t(b.client_phone, 30)}`, `Chamar no WhatsApp: ${waLink(b.client_phone, msgCli)}`, ``,
    `PROFISSIONAL: ${t(b.pro_name, 60)} - ${t(b.pro_phone, 30)}`, `Chamar no WhatsApp: ${waLink(b.pro_phone, msgPro)}`, ``,
    `Quando receber o pagamento, abra https://resolvoja.app.br/equipe/ > Negociações e clique em "Marcar como pago".`,
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
  notifyOwner(env, ctx, `Nova negociação: ${titulo} - ${valor}`, text);
  return json(200, { ok: true });
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/lead") {
      return request.method === "POST" ? leadPost({ request, env, ctx }) : leadOther({ request, env });
    }
    if (pathname === "/api/leads") {
      if (request.method === "GET") return leadsGet({ request, env });
      if (request.method === "DELETE") return leadsDelete({ request, env });
      return leadsOther({ request, env });
    }
    if (pathname === "/api/negociacao") return request.method === "POST" ? negociacaoPost({ request, env, ctx }) : json(405, { error: "Método não permitido." }, { Allow: "POST" });
    if (pathname === "/api/checkout") return request.method === "POST" ? checkoutPost({ request, env }) : json(405, { error: "Método não permitido." }, { Allow: "POST" });
    if (pathname === "/api/mp-webhook") return request.method === "POST" ? mpWebhook({ request, env, ctx }) : json(405, { error: "Método não permitido." }, { Allow: "POST" });
    if (pathname === "/api/pedido") return request.method === "GET" ? pedidoGet({ request, env, ctx }) : json(405, { error: "Método não permitido." }, { Allow: "GET" });
    if (pathname === "/api/pedidos") {
      if (request.method === "GET") return pedidosGet({ request, env });
      if (request.method === "DELETE") return pedidosDelete({ request, env });
      return json(405, { error: "Método não permitido." }, { Allow: "GET, DELETE" });
    }
    if (pathname.startsWith("/api/")) return json(404, { error: "Não encontrado." });
    return env.ASSETS.fetch(request);
  },
};
