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

async function authorized(request, env) {
  const h = request.headers.get("Authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  return env.ADMIN_TOKEN && env.ADMIN_TOKEN.length >= 16 && (await tokenMatches(token, env.ADMIN_TOKEN));
}

// Evita que o Excel execute fórmulas colocadas num cadastro (=, +, -, @).
const csvCell = (v) => {
  let s = Array.isArray(v) ? v.join("; ") : v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
};

async function leadsGet({ request, env }) {
  if (!env.LEADS) return json(500, { error: "Servidor sem armazenamento configurado." });
  if (!(await authorized(request, env))) return json(401, { error: "Não autorizado." });

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
  if (!(await authorized(request, env))) return json(401, { error: "Não autorizado." });
  const key = new URL(request.url).searchParams.get("key") || "";
  if (!/^lead:(cliente|pro):\d{10,13}$/.test(key)) return json(400, { error: "Chave inválida." });
  await env.LEADS.delete(key);
  return json(200, { ok: true });
}

async function leadsOther() {
  return json(405, { error: "Método não permitido." }, { Allow: "GET, DELETE" });
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
    if (pathname.startsWith("/api/")) return json(404, { error: "Não encontrado." });
    return env.ASSETS.fetch(request);
  },
};
