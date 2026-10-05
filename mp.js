// Pagamento com Split do Mercado Pago (Checkout Transparente, API de Payments).
// O profissional recebe direto na conta dele; o Resolvo Já fica com a comissão (application_fee).
//
// Rotas (todas tratadas aqui, ligadas em worker.js):
//   GET  /api/mp/config            chave pública para o formulário de cartão
//   POST /api/mp/connect           profissional logado: devolve o link para conectar a conta Mercado Pago (OAuth)
//   GET  /api/mp-oauth/callback    o Mercado Pago devolve o profissional aqui; guardamos o token cifrado
//   POST /api/mp/pay               cliente logado: cria a cobrança (Pix ou cartão reservado)
//   POST /api/mp/confirm           cliente logado: confirma o serviço; cobra o cartão reservado e conclui
//   POST /api/mp-split-webhook     aviso do Mercado Pago (assinatura conferida)
//   POST /api/mp/cron              rotina do Supabase (x-rj-secret): cobra cartões reservados que venceram o prazo
//   POST /api/mp/refund            equipe logada: devolve o pagamento (total ou parcial)
//
// Segredos no Cloudflare: MP_CLIENT_ID, MP_CLIENT_SECRET, MP_PUBLIC_KEY, MP_SPLIT_WEBHOOK_SECRET, MP_TOKEN_KEY,
// SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY e o NOTIFY_SECRET que já existe.

const MP_API = "https://api.mercadopago.com";
const MP_AUTH = "https://auth.mercadopago.com.br/authorization";
const COMMISSION_BPS = 1000; // 10%
const REFRESH_BEFORE_MS = 15 * 24 * 3600 * 1000;
const enc = new TextEncoder();
const dec = new TextDecoder();

function json(status, data, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });
}
const origin = (env) => (env.PUBLIC_URL || "https://resolvoja.app.br").replace(/\/$/, "");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- criptografia ----------
const b64 = (buf) => { let s = ""; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64u = (buf) => b64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => unb64(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
async function hmac(secret, data) {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}
const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
function sameStr(a, b) {
  a = String(a || ""); b = String(b || "");
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
async function aesKey(env) {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(env.MP_TOKEN_KEY));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function seal(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(env), enc.encode(text));
  return "v1." + b64(iv) + "." + b64(ct);
}
async function unseal(env, s) {
  const [v, iv, ct] = String(s).split(".");
  if (v !== "v1" || !iv || !ct) throw new Error("token cifrado inválido");
  return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aesKey(env), unb64(ct)));
}
// "state" do OAuth: assinado e com validade, para ninguém conectar a conta no nome de outro usuário.
async function makeState(env, userId) {
  const body = b64u(enc.encode(JSON.stringify({ u: userId, e: Date.now() + 15 * 60 * 1000 })));
  return body + "." + b64u(await hmac(env.MP_TOKEN_KEY, "state." + body));
}
async function readState(env, state) {
  const [body, sig] = String(state || "").split(".");
  if (!body || !sig) return null;
  if (!sameStr(sig, b64u(await hmac(env.MP_TOKEN_KEY, "state." + body)))) return null;
  try { const o = JSON.parse(dec.decode(unb64u(body))); return o.e > Date.now() && UUID.test(o.u) ? o.u : null; } catch { return null; }
}

// ---------- Supabase ----------
function configured(env) {
  return !!(env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.SUPABASE_SERVICE_ROLE_KEY && env.MP_TOKEN_KEY && String(env.MP_TOKEN_KEY).length >= 24);
}
async function sb(env, path, { method = "GET", body, headers = {} } = {}) {
  const r = await fetch(env.SUPABASE_URL.replace(/\/$/, "") + path, {
    method,
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY, "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) { const e = new Error("supabase " + r.status + " " + path.split("?")[0] + ": " + (data && data.message ? data.message : text).toString().slice(0, 200)); e.status = r.status; throw e; }
  return data;
}
const rpc = (env, fn, args) => sb(env, "/rest/v1/rpc/" + fn, { method: "POST", body: args || {} });
async function userFrom(request, env) {
  const m = /^Bearer (.+)$/.exec(request.headers.get("authorization") || "");
  if (!m) return null;
  try {
    const r = await fetch(env.SUPABASE_URL.replace(/\/$/, "") + "/auth/v1/user", { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + m[1] } });
    if (!r.ok) return null;
    const u = await r.json();
    return u && UUID.test(u.id || "") ? { id: u.id, email: u.email || "" } : null;
  } catch { return null; }
}

// ---------- Mercado Pago ----------
async function mp(path, token, { method = "GET", body, idem, headers } = {}) {
  const r = await fetch(MP_API + path, {
    method,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...(idem ? { "X-Idempotency-Key": idem } : {}), ...(headers || {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { ok: r.ok, status: r.status, data, reqId: r.headers.get("x-request-id") || null };
}
async function oauthToken(env, params) {
  const r = await fetch(MP_API + "/oauth/token", {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: env.MP_CLIENT_ID, client_secret: env.MP_CLIENT_SECRET, ...params }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) throw new Error("oauth " + r.status + " " + String(data.message || data.error || "").slice(0, 120));
  return data;
}
// Token do vendedor, renovado quando falta pouco para vencer.
async function sellerToken(env, proId) {
  const rows = await sb(env, `/rest/v1/pro_mp_accounts?user_id=eq.${proId}&select=*`);
  const acc = rows && rows[0];
  if (!acc) return null;
  let token = await unseal(env, acc.access_token);
  const exp = acc.expires_at ? Date.parse(acc.expires_at) : 0;
  if (acc.refresh_token && exp && exp - Date.now() < REFRESH_BEFORE_MS) {
    try {
      const d = await oauthToken(env, { grant_type: "refresh_token", refresh_token: await unseal(env, acc.refresh_token) });
      token = d.access_token;
      await sb(env, `/rest/v1/pro_mp_accounts?user_id=eq.${proId}`, { method: "PATCH", body: {
        access_token: await seal(env, d.access_token), refresh_token: d.refresh_token ? await seal(env, d.refresh_token) : acc.refresh_token,
        expires_at: new Date(Date.now() + (d.expires_in || 15552000) * 1000).toISOString(), updated_at: new Date().toISOString() } });
    } catch (e) { console.error("falha ao renovar token do vendedor:", e.message); }
  }
  return token;
}
const MOTIVOS = {
  cc_rejected_insufficient_amount: "Limite ou saldo insuficiente no cartão.",
  cc_rejected_bad_filled_card_number: "Confira o número do cartão.",
  cc_rejected_bad_filled_date: "Confira a validade do cartão.",
  cc_rejected_bad_filled_security_code: "Confira o código de segurança.",
  cc_rejected_bad_filled_other: "Confira os dados do cartão.",
  cc_rejected_call_for_authorize: "O banco pediu autorização. Fale com o banco ou use outro cartão.",
  cc_rejected_card_disabled: "Cartão desativado. Use outro cartão.",
  cc_rejected_blacklist: "Não foi possível usar este cartão. Tente outro.",
  cc_rejected_high_risk: "Pagamento recusado por segurança. Tente outro cartão ou pague por Pix.",
};
const motivo = (d) => MOTIVOS[d] || "O pagamento não foi aprovado. Tente outro cartão ou pague por Pix.";
const money = (cents) => Math.round(cents) / 100;

// Dados do pedido que está aguardando pagamento ou em andamento.
async function loadRequest(env, requestId) {
  const reqs = await sb(env, `/rest/v1/service_requests?id=eq.${requestId}&select=id,client_id,status,title,accepted_proposal_id`);
  const r = reqs && reqs[0];
  if (!r || !r.accepted_proposal_id) return null;
  const props = await sb(env, `/rest/v1/proposals?id=eq.${r.accepted_proposal_id}&select=id,pro_id,amount_cents`);
  const p = props && props[0];
  if (!p) return null;
  const pays = await sb(env, `/rest/v1/payments?request_id=eq.${requestId}&select=*`);
  return { r, p, pay: (pays && pays[0]) || null };
}

// ---------- rotas ----------
async function connect(request, env) {
  const u = await userFrom(request, env);
  if (!u) return json(401, { error: "Faça login." });
  const prof = await sb(env, `/rest/v1/profiles?id=eq.${u.id}&select=role`);
  if (!prof || !prof[0] || prof[0].role !== "pro") return json(403, { error: "Só profissionais conectam a conta." });
  const url = new URL(MP_AUTH);
  url.searchParams.set("client_id", env.MP_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("platform_id", "mp");
  url.searchParams.set("state", await makeState(env, u.id));
  url.searchParams.set("redirect_uri", origin(env) + "/api/mp-oauth/callback");
  return json(200, { url: url.toString() });
}

async function oauthCallback(request, env) {
  const q = new URL(request.url).searchParams;
  const back = (ok) => new Response(null, { status: 302, headers: { Location: origin(env) + "/app/?mp=" + (ok ? "ok" : "erro"), "cache-control": "no-store" } });
  const userId = await readState(env, q.get("state"));
  if (!userId || !q.get("code")) return back(false);
  try {
    const d = await oauthToken(env, { grant_type: "authorization_code", code: q.get("code"), redirect_uri: origin(env) + "/api/mp-oauth/callback" });
    await sb(env, "/rest/v1/pro_mp_accounts?on_conflict=user_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: {
      user_id: userId, mp_user_id: String(d.user_id), access_token: await seal(env, d.access_token),
      refresh_token: d.refresh_token ? await seal(env, d.refresh_token) : null,
      expires_at: new Date(Date.now() + (d.expires_in || 15552000) * 1000).toISOString(), connected_at: new Date().toISOString(), updated_at: new Date().toISOString() } });
    return back(true);
  } catch (e) { console.error("callback OAuth falhou:", e.message); return back(false); }
}

async function pay(request, env) {
  const u = await userFrom(request, env);
  if (!u) return json(401, { error: "Faça login para pagar." });
  let b; try { b = JSON.parse(await request.text()); } catch { return json(400, { error: "Pedido inválido." }); }
  const requestId = String(b.request_id || ""), method = b.method;
  if (!UUID.test(requestId) || (method !== "pix" && method !== "card")) return json(400, { error: "Pedido inválido." });
  if (!u.email) return json(422, { error: "A conta precisa ter e-mail para pagar." });
  let card = null;
  if (method === "card") {
    const inst = Number(b.installments || 1);
    if (typeof b.token !== "string" || b.token.length < 8 || b.token.length > 200 || typeof b.payment_method_id !== "string" || !/^[a-z0-9_]{2,30}$/i.test(b.payment_method_id) || !Number.isInteger(inst) || inst < 1 || inst > 12)
      return json(400, { error: "Dados do cartão inválidos." });
    const dev = typeof b.device_id === "string" && /^[A-Za-z0-9_.:-]{8,200}$/.test(b.device_id) ? b.device_id : null;
    card = { device: dev, token: b.token, payment_method_id: b.payment_method_id, installments: inst, issuer_id: b.issuer_id ? String(b.issuer_id).slice(0, 20) : undefined,
      ident: b.identification && typeof b.identification === "object" ? { type: String(b.identification.type || "").slice(0, 10), number: String(b.identification.number || "").replace(/\D/g, "").slice(0, 20) } : null };
  }
  const d = await loadRequest(env, requestId);
  if (!d || d.r.client_id !== u.id) return json(404, { error: "Pedido não encontrado." });
  if (d.r.status !== "awaiting_payment") return json(409, { error: "Este pedido não está aguardando pagamento." });
  const token = await sellerToken(env, d.p.pro_id);
  if (!token) return json(409, { error: "O profissional ainda não conectou a conta do Mercado Pago.", code: "pro_not_connected" });

  // Pix pendente e ainda válido: devolve o mesmo código em vez de criar outro.
  if (d.pay && d.pay.status === "pending" && d.pay.method === "pix" && method === "pix" && d.pay.pix_code && (!d.pay.expires_at || Date.parse(d.pay.expires_at) > Date.now() + 60000))
    return json(200, { ok: true, status: "pending", pix: { code: d.pay.pix_code, qr_base64: d.pay.pix_qr, expires_at: d.pay.expires_at } });
  if (d.pay && !["pending", "failed"].includes(d.pay.status)) return json(409, { error: "Este pedido já tem pagamento." });
  // Cobrança anterior ainda aberta (por exemplo um Pix que o cliente trocou por cartão): cancela antes de criar a nova.
  if (d.pay && d.pay.status === "pending" && d.pay.provider === "mercadopago" && /^\d+$/.test(d.pay.provider_ref || "")) {
    const c = await mp("/v1/payments/" + d.pay.provider_ref, token, { method: "PUT", body: { status: "cancelled" } });
    if (!c.ok) console.error("não foi possível cancelar a cobrança anterior", c.status);
  }

  const cents = d.p.amount_cents, fee = Math.round(cents * COMMISSION_BPS / 10000);
  const base = {
    transaction_amount: money(cents), application_fee: money(fee), description: ("Resolvo Já: " + d.r.title).slice(0, 200),
    external_reference: requestId, statement_descriptor: "RESOLVOJA", notification_url: origin(env) + "/api/mp-split-webhook",
    payer: { email: u.email },
    additional_info: { items: [{ id: requestId, title: String(d.r.title || "Serviço").slice(0, 100), description: ("Resolvo Já: " + (d.r.title || "serviço")).slice(0, 200), category_id: "services", quantity: 1, unit_price: money(cents) }] },
  };
  if (env.MP_DIAG_SEM_COMISSAO === "1") delete base.application_fee; // SÓ PARA DIAGNÓSTICO: remover o secret depois do teste
  let body, idem;
  if (method === "pix") {
    body = { ...base, payment_method_id: "pix", date_of_expiration: new Date(Date.now() + 3600 * 1000).toISOString().replace("Z", "+00:00") };
    idem = `rj-${requestId}-pix-${Math.floor(Date.now() / 60000)}`;
  } else {
    body = { ...base, token: card.token, installments: card.installments, payment_method_id: card.payment_method_id, capture: false };
    if (card.issuer_id) body.issuer_id = card.issuer_id;
    if (card.ident && card.ident.number) body.payer = { email: u.email, identification: card.ident };
    idem = `rj-${requestId}-card-${card.token}`;
  }
  const res = await mp("/v1/payments", token, { method: "POST", body, idem, headers: card && card.device ? { "X-meli-session-id": card.device } : undefined });
  if (!res.ok || !res.data || !res.data.id) {
    console.error("Mercado Pago recusou a criação do pagamento:", res.status, JSON.stringify(res.data && (res.data.message || res.data.error)).slice(0, 200), "| request-id:", res.reqId, "| método:", method, "| campos enviados:", Object.keys(body).join(","), "| causas:", JSON.stringify(res.data && res.data.cause).slice(0, 300));
    return json(502, { error: "Não foi possível processar o pagamento agora. Tente de novo em instantes." });
  }
  const m = res.data, ref = String(m.id), td = m.point_of_interaction && m.point_of_interaction.transaction_data;
  const expires = method === "pix" ? (m.date_of_expiration ? new Date(m.date_of_expiration).toISOString() : null) : null;
  try {
    await rpc(env, "server_create_payment", { p_request: requestId, p_client: u.id, p_method: method, p_ref: ref, p_mp_status: m.status || "pending",
      p_pix_code: td ? td.qr_code || null : null, p_pix_qr: td ? td.qr_code_base64 || null : null, p_expires: expires });
  } catch (e) {
    console.error("pagamento criado no Mercado Pago mas o banco recusou; cancelando:", e.message);
    await mp("/v1/payments/" + ref, token, { method: "PUT", body: { status: "cancelled" } });
    return json(409, { error: "Não foi possível registrar o pagamento. Nada foi cobrado." });
  }
  const applied = await rpc(env, "server_apply_payment", { p_ref: ref, p_mp_status: m.status || "pending" });
  if (m.status === "rejected") console.error("Pagamento recusado pelo Mercado Pago:", m.status_detail, "| request-id:", res.reqId, "| método:", method, "| device-id:", card && card.device ? "enviado" : "ausente");
  if (m.status === "rejected") return json(200, { ok: false, status: "rejected", error: motivo(m.status_detail) });
  return json(200, { ok: true, status: m.status, request_status: applied && applied.request_status,
    ...(method === "pix" ? { pix: { code: td ? td.qr_code : null, qr_base64: td ? td.qr_code_base64 : null, expires_at: expires } } : {}) });
}

// Cobra o cartão reservado. Aceita "já cobrado" como sucesso, para poder repetir sem medo.
async function capture(env, ref, proId, cents) {
  const token = await sellerToken(env, proId);
  if (!token) return { ok: false, reason: "sem token do vendedor" };
  const cur = await mp("/v1/payments/" + ref, token);
  if (cur.ok && cur.data && cur.data.status === "approved") return { ok: true, status: "approved" };
  if (cur.ok && cur.data && cur.data.status !== "authorized") return { ok: false, reason: "status " + cur.data.status, status: cur.data.status };
  const res = await mp("/v1/payments/" + ref, token, { method: "PUT", body: { capture: true, transaction_amount: money(cents) }, idem: `rj-capture-${ref}` });
  if (!res.ok) return { ok: false, reason: "mp " + res.status };
  return { ok: true, status: res.data && res.data.status };
}
async function finish(env, requestId, ref, cents, proId) {
  const c = await capture(env, ref, proId, cents);
  if (!c.ok) return c;
  await rpc(env, "server_apply_payment", { p_ref: ref, p_mp_status: "approved" });
  await rpc(env, "server_complete_request", { p_request: requestId });
  return { ok: true };
}

async function confirm(request, env) {
  const u = await userFrom(request, env);
  if (!u) return json(401, { error: "Faça login." });
  let b; try { b = JSON.parse(await request.text()); } catch { return json(400, { error: "Pedido inválido." }); }
  const requestId = String(b.request_id || "");
  if (!UUID.test(requestId)) return json(400, { error: "Pedido inválido." });
  const d = await loadRequest(env, requestId);
  if (!d || d.r.client_id !== u.id) return json(404, { error: "Pedido não encontrado." });
  if (!d.pay || d.pay.provider !== "mercadopago") return json(409, { error: "Este pedido não foi pago pelo aplicativo." });
  if (d.r.status === "completed") return json(200, { ok: true, already: true });
  if (d.r.status !== "hired") return json(409, { error: "Este pedido não está em andamento." });
  if (d.pay.method === "card" && d.pay.status === "held") {
    const f = await finish(env, requestId, d.pay.provider_ref, d.pay.amount_cents, d.p.pro_id);
    if (!f.ok) { console.error("captura falhou", requestId, f.reason); return json(502, { error: "Não foi possível concluir agora. Tente de novo em instantes." }); }
  } else {
    const ok = await rpc(env, "server_complete_request", { p_request: requestId });
    if (!ok) return json(409, { error: "Há uma disputa aberta neste pedido." });
  }
  return json(200, { ok: true });
}

// ---------- aviso do Mercado Pago ----------
async function signatureOk(env, request, dataId) {
  if (!env.MP_SPLIT_WEBHOOK_SECRET) return false;
  const sig = request.headers.get("x-signature") || "", reqId = request.headers.get("x-request-id") || "";
  const ts = (/(?:^|,)\s*ts=([^,]+)/.exec(sig) || [])[1], v1 = (/(?:^|,)\s*v1=([^,]+)/.exec(sig) || [])[1];
  if (!ts || !v1 || !dataId) return false;
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${reqId};ts:${ts};`;
  return sameStr(hex(await hmac(env.MP_SPLIT_WEBHOOK_SECRET, manifest)), v1.trim().toLowerCase());
}
async function webhook(request, env) {
  const url = new URL(request.url);
  let body = {}; try { body = JSON.parse((await request.text()) || "{}"); } catch { /* corpo vazio */ }
  const dataId = url.searchParams.get("data.id") || (body.data && body.data.id) || "";
  if (!(await signatureOk(env, request, dataId))) return json(401, { error: "Assinatura inválida." });
  const type = url.searchParams.get("type") || body.type || "";
  if (type && type !== "payment") return json(200, { ok: true, ignored: type });
  if (!/^\d+$/.test(String(dataId))) return json(200, { ok: true, ignored: "id" });
  // Acha o pagamento que nós criamos para saber de qual vendedor usar o token.
  const rows = await sb(env, `/rest/v1/payments?provider=eq.mercadopago&provider_ref=eq.${dataId}&select=request_id,proposal_id,amount_cents`);
  const row = rows && rows[0];
  if (!row) return json(200, { ok: true, ignored: "desconhecido" });
  const props = await sb(env, `/rest/v1/proposals?id=eq.${row.proposal_id}&select=pro_id`);
  const token = await sellerToken(env, props[0].pro_id);
  if (!token) return json(200, { ok: true, ignored: "sem token" });
  const g = await mp("/v1/payments/" + dataId, token);
  if (!g.ok || !g.data) { console.error("consulta do pagamento falhou", g.status); return json(502, { error: "Tente de novo." }); }
  const m = g.data;
  if (Math.round(Number(m.transaction_amount) * 100) !== row.amount_cents || (m.currency_id && m.currency_id !== "BRL") || String(m.external_reference) !== row.request_id) {
    console.error("valor, moeda ou pedido não conferem no pagamento", dataId);
    return json(200, { ok: true, ignored: "nao-confere" });
  }
  const applied = await rpc(env, "server_apply_payment", { p_ref: String(dataId), p_mp_status: m.status });
  // Pedido já cancelado e o pagamento entrou mesmo assim: devolve na hora.
  if (applied && applied.changed && applied.request_status === "cancelled" && ["held", "released"].includes(applied.payment_status)) {
    const r = m.status === "authorized"
      ? await mp("/v1/payments/" + dataId, token, { method: "PUT", body: { status: "cancelled" } })
      : await mp(`/v1/payments/${dataId}/refunds`, token, { method: "POST", body: {}, idem: `rj-refund-${dataId}` });
    console.error("pagamento de pedido cancelado devolvido:", dataId, r.status);
  }
  return json(200, { ok: true });
}

// ---------- rotina agendada ----------
async function cron(request, env) {
  if (!env.NOTIFY_SECRET || env.NOTIFY_SECRET.length < 16 || !sameStr(request.headers.get("x-rj-secret"), env.NOTIFY_SECRET)) return json(401, { error: "Não autorizado." });
  const due = (await rpc(env, "payments_due_for_capture", {})) || [];
  let captured = 0, failed = 0;
  for (const p of due) {
    try { const f = await finish(env, p.request_id, p.provider_ref, p.amount_cents, p.pro_id); if (f.ok) captured++; else { failed++; console.error("cron: captura falhou", p.request_id, f.reason); } }
    catch (e) { failed++; console.error("cron: erro", p.request_id, e.message); }
  }
  const auto = await rpc(env, "auto_confirm_overdue", { p_hours: 48 });
  return json(200, { ok: true, due: due.length, captured, failed, auto_confirmed: auto });
}

// ---------- devolução (equipe) ----------
async function refund(request, env) {
  const u = await userFrom(request, env);
  if (!u) return json(401, { error: "Faça login." });
  const prof = await sb(env, `/rest/v1/profiles?id=eq.${u.id}&select=role`);
  if (!prof || !prof[0] || prof[0].role !== "admin") return json(403, { error: "Só a equipe." });
  let b; try { b = JSON.parse(await request.text()); } catch { return json(400, { error: "Pedido inválido." }); }
  const requestId = String(b.request_id || "");
  if (!UUID.test(requestId)) return json(400, { error: "Pedido inválido." });
  const d = await loadRequest(env, requestId);
  if (!d || !d.pay || d.pay.provider !== "mercadopago") return json(404, { error: "Pagamento não encontrado." });
  const token = await sellerToken(env, d.p.pro_id);
  if (!token) return json(409, { error: "Sem token do vendedor." });
  const cur = await mp("/v1/payments/" + d.pay.provider_ref, token);
  if (!cur.ok) return json(502, { error: "Não foi possível consultar o pagamento." });
  let r;
  if (cur.data.status === "authorized") r = await mp("/v1/payments/" + d.pay.provider_ref, token, { method: "PUT", body: { status: "cancelled" } });
  else {
    const cents = b.amount_cents == null ? null : Number(b.amount_cents);
    if (cents !== null && (!Number.isInteger(cents) || cents <= 0 || cents > d.pay.amount_cents)) return json(400, { error: "Valor inválido." });
    r = await mp(`/v1/payments/${d.pay.provider_ref}/refunds`, token, { method: "POST", body: cents === null ? {} : { amount: money(cents) }, idem: `rj-refund-${d.pay.provider_ref}-${cents === null ? "total" : cents}` });
  }
  if (!r.ok) { console.error("devolução recusada", r.status); return json(502, { error: "O Mercado Pago recusou a devolução." }); }
  if (b.amount_cents == null) await rpc(env, "server_apply_payment", { p_ref: d.pay.provider_ref, p_mp_status: "refunded" });
  await sb(env, "/rest/v1/audit_log", { method: "POST", headers: { Prefer: "return=minimal" }, body: { actor_id: u.id, action: "mp_refund", entity: "payment", entity_id: d.pay.provider_ref, detail: { request_id: requestId, amount_cents: b.amount_cents ?? null } } });
  return json(200, { ok: true });
}

export async function mpHandle(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === "/api/mp/config") return request.method === "GET" ? json(200, { public_key: env.MP_PUBLIC_KEY || null }) : json(405, { error: "Método não permitido." });
  if (!configured(env)) return json(503, { error: "Pagamento ainda não configurado." });
  const post = (fn) => (request.method === "POST" ? fn(request, env) : json(405, { error: "Método não permitido." }, { Allow: "POST" }));
  try {
    if (pathname === "/api/mp/connect") return await post(connect);
    if (pathname === "/api/mp-oauth/callback") return request.method === "GET" ? await oauthCallback(request, env) : json(405, { error: "Método não permitido." });
    if (pathname === "/api/mp/pay") return await post(pay);
    if (pathname === "/api/mp/confirm") return await post(confirm);
    if (pathname === "/api/mp-split-webhook") return await post(webhook);
    if (pathname === "/api/mp/cron") return await post(cron);
    if (pathname === "/api/mp/refund") return await post(refund);
  } catch (e) {
    console.error("erro em", pathname, e && e.message);
    return json(500, { error: "Erro inesperado." });
  }
  return json(404, { error: "Não encontrado." });
}
