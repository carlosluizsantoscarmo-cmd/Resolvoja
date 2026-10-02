// Ponto de entrada para o fluxo de Workers do Cloudflare (wrangler deploy).
// As páginas vêm da pasta public (binding ASSETS); só os endereços /api/* passam por aqui.
import * as lead from "./functions/api/lead.js";
import * as leads from "./functions/api/leads.js";
import { json } from "./functions/api/_util.js";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/lead") {
      return request.method === "POST" ? lead.onRequestPost({ request, env }) : lead.onRequest({ request, env });
    }
    if (pathname === "/api/leads") {
      if (request.method === "GET") return leads.onRequestGet({ request, env });
      if (request.method === "DELETE") return leads.onRequestDelete({ request, env });
      return leads.onRequest({ request, env });
    }
    if (pathname.startsWith("/api/")) return json(404, { error: "Não encontrado." });
    return env.ASSETS.fetch(request);
  },
};
