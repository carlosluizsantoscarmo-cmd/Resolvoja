// GET /api/leads — lista os cadastros. Exige o cabeçalho "Authorization: Bearer <ADMIN_TOKEN>".
// ?format=csv devolve uma planilha. DELETE /api/leads?key=lead:... remove um cadastro (pedido de exclusão pela LGPD).
import { json, tokenMatches } from "./_util.js";

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

export async function onRequestGet({ request, env }) {
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

export async function onRequestDelete({ request, env }) {
  if (!env.LEADS) return json(500, { error: "Servidor sem armazenamento configurado." });
  if (!(await authorized(request, env))) return json(401, { error: "Não autorizado." });
  const key = new URL(request.url).searchParams.get("key") || "";
  if (!/^lead:(cliente|pro):\d{10,13}$/.test(key)) return json(400, { error: "Chave inválida." });
  await env.LEADS.delete(key);
  return json(200, { ok: true });
}

export async function onRequest() {
  return json(405, { error: "Método não permitido." }, { Allow: "GET, DELETE" });
}
