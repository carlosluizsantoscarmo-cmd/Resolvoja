// POST /api/lead — recebe o cadastro da lista de espera e grava no Workers KV (binding LEADS).
import { json } from "./_util.js";

const CATEGORIES = ["Eletricista", "Encanador", "Montador", "Pintor", "Diarista", "Fretes"];
const CITIES = ["Serra", "Vitória", "Vila Velha", "Cariacica", "Outra"];
const EXPERIENCE = ["Menos de 1 ano", "1 a 3 anos", "3 a 10 anos", "Mais de 10 anos"];
const clean = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");

export async function onRequestPost({ request, env }) {
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

export async function onRequest({ request }) {
  return json(405, { error: "Método não permitido." }, { Allow: "POST" });
}
