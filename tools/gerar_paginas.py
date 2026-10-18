#!/usr/bin/env python3
"""Gera as páginas "serviço em cidade" do Resolvo Já (para aparecer no Google).

Uso: python3 tools/gerar_paginas.py
Cria public/servicos/*.html e reescreve public/sitemap.xml.
Para incluir um serviço ou uma cidade, edite as listas SERVICOS e CIDADES e rode de novo.
Os nomes em SERVICOS["cat"] precisam ser iguais aos nomes das categorias no app.
"""
import html
import json
import os
import re
import unicodedata

SITE = "https://resolvoja.app.br"
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public")
OUT = os.path.join(ROOT, "servicos")

SERVICOS = [
    dict(cat="Eletricista", nome="Eletricista", plural="eletricistas", artigo="um",
         chamada="Chuveiro queimou, disjuntor caindo, tomada sem energia?",
         trabalhos=["Troca e instalação de chuveiro", "Tomadas, interruptores e iluminação", "Quadro de luz e disjuntores",
                    "Ventilador de teto", "Fiação e circuitos novos", "Padrão de entrada de energia"],
         faq=[("Posso pedir só para trocar um chuveiro?", "Pode. Pedidos pequenos são bem-vindos. Descreva o modelo e a potência do chuveiro e, se puder, mande uma foto do local."),
              ("O eletricista leva o material?", "Depende do combinado. Na proposta, o profissional informa se o valor inclui material ou só a mão de obra.")]),
    dict(cat="Encanador", nome="Encanador", plural="encanadores", artigo="um",
         chamada="Vazamento, torneira pingando ou pia entupida?",
         trabalhos=["Conserto de vazamentos", "Troca de torneira e registro", "Desentupimento de pia e ralo",
                    "Instalação de caixa d'água", "Vaso sanitário e caixa acoplada", "Instalação de filtro e aquecedor"],
         faq=[("Atendem vazamento com urgência?", "No pedido, marque o horário que precisa. Profissionais com agenda livre respondem primeiro; você escolhe pela proposta."),
              ("Preciso saber de onde vem o vazamento?", "Não. Conte o que está vendo (mancha na parede, conta de água alta, pingo) e mande fotos. O encanador avalia.")]),
    dict(cat="Montador de móveis", nome="Montador de móveis", plural="montadores de móveis", artigo="um",
         chamada="Comprou um móvel e precisa montar?",
         trabalhos=["Guarda-roupa e cômoda", "Cozinha planejada e armários", "Cama, beliche e painel de TV",
                    "Escrivaninha e estante", "Desmontagem para mudança", "Instalação de prateleiras e nichos"],
         faq=[("Preciso informar a marca do móvel?", "Ajuda bastante. Informe a loja, o modelo e quantas portas ou gavetas o móvel tem; com isso a proposta sai mais certa."),
              ("O montador fixa o móvel na parede?", "Se você pedir, sim. Diga no pedido se a parede é de tijolo, concreto ou drywall.")]),
    dict(cat="Pintor", nome="Pintor", plural="pintores", artigo="um",
         chamada="Quer renovar a casa, o apartamento ou a fachada?",
         trabalhos=["Pintura de quartos e salas", "Fachadas e muros", "Massa corrida e textura",
                    "Correção de mofo e infiltração na pintura", "Pintura de portões e grades", "Pintura de apartamento para entrega"],
         faq=[("Como o pintor calcula o preço?", "Normalmente pela área (metros quadrados) e pelo estado da parede. Informe os cômodos e mande fotos para receber propostas mais precisas."),
              ("A tinta está incluída?", "Cada profissional informa na proposta se o valor inclui tinta e material ou só a mão de obra.")]),
    dict(cat="Diarista", nome="Diarista", plural="diaristas", artigo="uma",
         chamada="Precisa de uma faxina caprichada?",
         trabalhos=["Faxina completa", "Limpeza pós-obra", "Limpeza de mudança (entrada ou saída)",
                    "Passar roupa", "Limpeza de vidros e janelas", "Organização de armários"],
         faq=[("Posso contratar uma diarista só uma vez?", "Pode. Você faz um pedido para a data que precisa. Se gostar, pode pedir de novo para a mesma profissional."),
              ("Os produtos de limpeza estão inclusos?", "Combine pela proposta. Diga no pedido se você tem os produtos ou se prefere que a diarista leve.")]),
    dict(cat="Pedreiro", nome="Pedreiro", plural="pedreiros", artigo="um",
         chamada="Pequena reforma, piso ou reboco?",
         trabalhos=["Assentamento de piso e revestimento", "Reboco e alvenaria", "Pequenas reformas de banheiro e cozinha",
                    "Contrapiso e calçada", "Muro e churrasqueira", "Reparos de trincas e rachaduras"],
         faq=[("Dá para pedir orçamento de uma reforma inteira?", "Dá. Descreva cada etapa, as medidas aproximadas e mande fotos. Quanto mais detalhes, mais certa vem a proposta."),
              ("O pedreiro compra o material?", "Depende do combinado. Na proposta fica claro se o valor é só de mão de obra ou inclui material.")]),
    dict(cat="Instalação de ar-condicionado", nome="Instalação de ar-condicionado", plural="técnicos de ar-condicionado", artigo="a",
         chamada="Comprou um ar-condicionado ou o seu parou de gelar?",
         trabalhos=["Instalação de split", "Limpeza e higienização", "Recarga de gás",
                    "Troca de lugar (desinstalação e reinstalação)", "Manutenção preventiva", "Instalação de suporte e dreno"],
         faq=[("O que informar para a instalação?", "A potência do aparelho (BTUs), o andar, a distância entre a parte de dentro e a de fora e se já existe tubulação."),
              ("Precisa de ponto elétrico próprio?", "Normalmente sim. Se ainda não tiver, diga no pedido; muitos profissionais fazem o ponto junto.")]),
    dict(cat="Marido de aluguel", nome="Marido de aluguel", plural="profissionais de pequenos reparos", artigo="um",
         chamada="Uma lista de pequenos consertos acumulados?",
         trabalhos=["Instalar cortina, varal e suporte de TV", "Trocar fechadura e maçaneta", "Pendurar quadros e espelhos",
                    "Pequenos reparos elétricos e hidráulicos", "Regular portas e janelas", "Montagem de itens simples"],
         faq=[("Posso pedir vários serviços de uma vez?", "Pode e é o mais comum. Faça uma lista no pedido; o profissional manda um valor para tudo."),
              ("Como sei se cabe num só pedido?", "Se forem reparos pequenos no mesmo endereço, cabem. Para obras maiores, prefira um pedreiro ou eletricista.")]),
    dict(cat="Chaveiro", nome="Chaveiro", plural="chaveiros", artigo="um",
         chamada="Ficou trancado do lado de fora ou quer trocar a fechadura?",
         trabalhos=["Abertura de portas", "Troca de fechadura e segredo", "Cópia de chaves",
                    "Instalação de fechadura digital", "Fechadura de portão", "Conserto de cadeados e trincos"],
         faq=[("Atendem na hora?", "Marque no pedido que é urgente. Quem estiver disponível responde; você escolhe a proposta que chegar primeiro ou a de melhor preço."),
              ("Instalam fechadura digital?", "Sim. Informe o modelo e o tipo de porta (madeira, alumínio ou vidro).")]),
    dict(cat="Fretes e mudanças", nome="Fretes e mudanças", plural="profissionais de frete e mudança", artigo="um",
         chamada="Vai mudar ou precisa levar um móvel?",
         trabalhos=["Mudança residencial", "Frete de móveis e eletrodomésticos", "Carreto pequeno",
                    "Ajudante para carregar", "Desmontagem e montagem na mudança", "Retirada de entulho leve"],
         faq=[("O que informar no pedido de mudança?", "Endereço de saída e de chegada, andares, se tem elevador e a lista dos itens maiores."),
              ("O frete inclui ajudante?", "Depende da proposta. Diga no pedido se você vai precisar de ajuda para carregar.")]),
]

CIDADES = [
    dict(nome="Serra", uf="ES", bairros=["Laranjeiras", "Colina de Laranjeiras", "Jacaraípe", "Manguinhos", "Feu Rosa", "Serra Sede", "Novo Horizonte", "André Carloni"]),
    dict(nome="Vitória", uf="ES", bairros=["Jardim Camburi", "Jardim da Penha", "Praia do Canto", "Mata da Praia", "Centro", "Bento Ferreira", "Maruípe", "Goiabeiras"]),
    dict(nome="Vila Velha", uf="ES", bairros=["Praia da Costa", "Itapuã", "Itaparica", "Coqueiral de Itaparica", "Centro", "Glória", "Cobilândia", "Praia de Itaparica"]),
    dict(nome="Cariacica", uf="ES", bairros=["Campo Grande", "Jardim América", "Itacibá", "Alto Lage", "Porto de Santana", "Rio Marinho", "Vera Cruz"]),
    dict(nome="Viana", uf="ES", bairros=["Centro", "Marcílio de Noronha", "Areinha", "Universal", "Vila Bethânia", "Industrial"]),
    dict(nome="Guarapari", uf="ES", bairros=["Centro", "Muquiçaba", "Praia do Morro", "Meaípe", "Enseada Azul", "Itapebussu"]),
    dict(nome="Fundão", uf="ES", bairros=["Centro", "Praia Grande", "Timbuí", "Irundi"]),
]


def slug(t):
    t = unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")


def url_pagina(s, c):
    return f"/servicos/{slug(s['nome'])}-em-{slug(c['nome'])}-{c['uf'].lower()}"


def e(t):
    return html.escape(str(t), quote=True)


def app_link(cat):
    return "/app/#/?modo=cadastro&c=" + re.sub(r" ", "%20", cat)


ICONES = {
    "ok": '<path d="M5 12l5 5 9-10"/>',
}


def svg(name, size=20):
    return f'<svg class="ic" width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICONES[name]}</svg>'


HEAD_COMUM = """<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#1F3BD1">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon-48.png" sizes="48x48" type="image/png">
<link rel="icon" href="/favicon-96.png" sizes="96x96" type="image/png">
<link rel="apple-touch-icon" href="/favicon-192.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Figtree:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/servicos/servicos.css">"""

TOPO = """<header class="hero"><div class="wrap nav"><a class="logo" href="/">Resolvo<b>Já</b></a><span class="sp"></span><a class="l" href="/servicos/">Serviços</a><a class="btn sun slim" href="/app/">Entrar</a></div>"""

RODAPE = """<footer><div class="wrap"><span><b>Resolvo Já</b> · Conectando quem precisa com quem sabe fazer.</span><span><a href="/servicos/">Serviços por cidade</a> · <a href="/termos">Termos e reembolso</a> · <a href="/privacidade">Política de Privacidade</a> · <a href="mailto:contato@resolvoja.app.br">contato@resolvoja.app.br</a> · Serra, Espírito Santo</span></div></footer>
<script src="/app/app-config.js"></script>
<script src="/servicos/servicos.js"></script>
<script src="/site.js"></script>"""


def pagina(s, c):
    cidade = f"{c['nome']}, {c['uf']}"
    url = SITE + url_pagina(s, c)
    titulo = f"{s['nome']} em {cidade} · Peça orçamento grátis | Resolvo Já"
    desc = (f"Precisa de {s['artigo']} {s['nome'].lower()} em {c['nome']}? Descreva o serviço, receba propostas de "
            f"{s['plural']} da região e contrate com segurança pelo Resolvo Já. Pedir orçamento é grátis.")
    faq = s["faq"] + [
        (f"Quais bairros de {c['nome']} são atendidos?",
         f"Você informa o seu bairro no pedido e os {s['plural']} que atendem a região enviam propostas. "
         f"Atendemos {c['nome']} inteira, incluindo {', '.join(c['bairros'][:-1])} e {c['bairros'][-1]}."),
        ("Quanto custa usar o Resolvo Já?", "Para quem pede o serviço, criar a conta e receber propostas é grátis. Você só paga quando escolhe uma proposta, pelo app, com Pix ou cartão."),
    ]
    ld = [
        {"@context": "https://schema.org", "@type": "Service", "name": f"{s['nome']} em {cidade}", "serviceType": s["nome"],
         "areaServed": {"@type": "City", "name": c["nome"], "containedInPlace": {"@type": "State", "name": "Espírito Santo"}},
         "provider": {"@type": "Organization", "name": "Resolvo Já", "url": SITE + "/"}, "url": url, "description": desc},
        {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
            {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faq]},
        {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Resolvo Já", "item": SITE + "/"},
            {"@type": "ListItem", "position": 2, "name": "Serviços", "item": SITE + "/servicos/"},
            {"@type": "ListItem", "position": 3, "name": f"{s['nome']} em {c['nome']}", "item": url}]},
    ]
    outras_cidades = "".join(f'<a class="place" href="{url_pagina(s, o)}">{e(s["nome"])} em {e(o["nome"])}</a>' for o in CIDADES if o is not c)
    outros_servicos = "".join(f'<a class="place" href="{url_pagina(o, c)}">{e(o["nome"])}</a>' for o in SERVICOS if o is not s)
    trabalhos = "".join(f"<li>{svg('ok', 18)}<span>{e(t)}</span></li>" for t in s["trabalhos"])
    bairros = "".join(f'<span class="place">{e(b)}</span>' for b in c["bairros"])
    faq_html = "".join(f"<details><summary>{e(q)}</summary><p>{e(a)}</p></details>" for q, a in faq)
    link = app_link(s["cat"])
    return f"""<!doctype html>
<html lang="pt-BR">
<head>
{HEAD_COMUM}
<title>{e(titulo)}</title>
<meta name="description" content="{e(desc)}">
<link rel="canonical" href="{e(url)}">
<meta property="og:title" content="{e(s['nome'])} em {e(cidade)} | Resolvo Já">
<meta property="og:description" content="{e(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="{e(url)}">
<meta property="og:image" content="{SITE}/og.png">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False).replace("</", "<\\/")}</script>
</head>
<body data-cat="{e(s['cat'])}" data-cidade="{e(c['nome'])}">
{TOPO}
<div class="wrap intro">
 <nav class="crumbs" aria-label="Você está em"><a href="/">Início</a> › <a href="/servicos/">Serviços</a> › <span>{e(s['nome'])} em {e(c['nome'])}</span></nav>
 <h1>{e(s['nome'])} em {e(c['nome'])}, {e(c['uf'])}</h1>
 <p class="lead">{e(s['chamada'])} Descreva o que precisa e receba propostas de {e(s['plural'])} que atendem {e(c['nome'])}. Você compara preço, prazo e horário antes de escolher.</p>
 <div class="cta"><a class="btn sun" href="{e(link)}">Pedir orçamento grátis</a><a class="btn line" href="/app/#/?modo=cadastro">Sou {e(s['nome'].lower()) if s['cat'] not in ('Fretes e mudanças', 'Instalação de ar-condicionado') else 'profissional'}</a></div>
 <p class="fine">Criar conta e receber propostas é grátis. Você só paga quando escolhe uma proposta.</p>
</div>
</header>

<main>
<section id="vitrine" hidden><div class="wrap">
 <div class="sec-h"><h2>Profissionais aprovados em {e(c['nome'])}</h2><p id="vitrine-n"></p></div>
 <div class="pros" id="vitrine-list"></div>
</div></section>

<section><div class="wrap split">
 <div><div class="sec-h"><h2>O que {e(s['plural'])} fazem pelo Resolvo Já</h2><p>Alguns dos serviços mais pedidos. Se o seu não estiver na lista, descreva no pedido.</p></div>
 <ul class="jobs">{trabalhos}</ul></div>
 <div class="box"><h3>Como funciona</h3>
  <ol class="steps">
   <li><b>Você descreve</b><span>Conte o que precisa, o bairro e o melhor horário. Pode mandar fotos.</span></li>
   <li><b>Recebe propostas</b><span>{e(s['plural'].capitalize())} que atendem {e(c['nome'])} enviam preço, prazo e horário.</span></li>
   <li><b>Contrata pelo app</b><span>Você escolhe, paga com Pix ou cartão pelo Mercado Pago e conversa no mesmo lugar.</span></li>
  </ol>
  <a class="btn full" href="{e(link)}">Descrever meu serviço</a>
 </div>
</div></section>

<section class="alt"><div class="wrap">
 <div class="sec-h"><h2>Bairros de {e(c['nome'])}</h2><p>Atendemos a cidade inteira. Estes são alguns dos bairros; informe o seu no pedido.</p></div>
 <div class="places">{bairros}</div>
</div></section>

<section class="pros-cta"><div class="wrap">
 <div class="box dark"><h3>É {e(s['nome'].lower()) if s['cat'] not in ('Fretes e mudanças', 'Instalação de ar-condicionado', 'Marido de aluguel') else 'profissional da área'} em {e(c['nome'])}?</h3><p>Cadastre-se grátis, escolha os bairros que você atende e receba pedidos de clientes da sua região.</p><a class="btn sun" href="/app/#/?modo=cadastro">Quero receber pedidos</a></div>
</div></section>

<section class="alt"><div class="wrap faq">
 <div class="sec-h"><h2>Perguntas frequentes</h2></div>
 {faq_html}
</div></section>

<section><div class="wrap">
 <div class="sec-h"><h2>Também em {e(c['nome'])}</h2></div>
 <div class="places">{outros_servicos}</div>
 <div class="sec-h" style="margin-top:40px"><h2>{e(s['nome'])} em outras cidades</h2></div>
 <div class="places">{outras_cidades}</div>
</div></section>
</main>
{RODAPE}
</body>
</html>
"""


def hub():
    blocos = "".join(
        f'<div class="box"><h3>{e(c["nome"])}</h3><div class="places">'
        + "".join(f'<a class="place" href="{url_pagina(s, c)}">{e(s["nome"])}</a>' for s in SERVICOS)
        + "</div></div>" for c in CIDADES)
    desc = "Eletricista, encanador, montador de móveis, pintor, diarista e mais em Serra, Vitória, Vila Velha, Cariacica, Viana, Guarapari e Fundão. Peça orçamento grátis no Resolvo Já."
    return f"""<!doctype html>
<html lang="pt-BR">
<head>
{HEAD_COMUM}
<title>Serviços na Grande Vitória · Eletricista, encanador e mais | Resolvo Já</title>
<meta name="description" content="{e(desc)}">
<link rel="canonical" href="{SITE}/servicos/">
<meta property="og:title" content="Serviços na Grande Vitória | Resolvo Já">
<meta property="og:description" content="{e(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="{SITE}/servicos/">
<meta property="og:image" content="{SITE}/og.png">
<meta name="twitter:card" content="summary_large_image">
</head>
<body>
{TOPO}
<div class="wrap intro">
 <nav class="crumbs" aria-label="Você está em"><a href="/">Início</a> › <span>Serviços</span></nav>
 <h1>Serviços por cidade</h1>
 <p class="lead">Escolha o serviço e a sua cidade. Você descreve o que precisa, recebe propostas de profissionais da região e contrata com segurança.</p>
 <div class="cta"><a class="btn sun" href="/app/#/?modo=cadastro">Pedir orçamento grátis</a></div>
</div>
</header>
<main><section><div class="wrap hubgrid">{blocos}</div></section></main>
{RODAPE}
</body>
</html>
"""


CSS = """:root{
  --bg:#F3F5FC;--surface:#FFFFFF;--text:#121A3A;--muted:#566080;--line:#D9DDEE;
  --brand:#1F3BD1;--brand-ink:#FFFFFF;--sun:#FFC400;--sun-ink:#121A3A;--soft:#E3E8FB;
  --hero:#1F3BD1;--hero-ink:#FFFFFF;--hero-mut:#CBD3FA;
  --f-display:'Bricolage Grotesque','Trebuchet MS',system-ui,sans-serif;
  --f-body:'Figtree',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#0D1230;--surface:#151B3E;--text:#EEF0FA;--muted:#A3ABCF;--line:#283062;--brand:#8FA2FF;--brand-ink:#0D1230;--soft:#1F2757;
  --hero:#16205F;--hero-mut:#B6C0F2;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0D1230;--surface:#151B3E;--text:#EEF0FA;--muted:#A3ABCF;--line:#283062;--brand:#8FA2FF;--brand-ink:#0D1230;--soft:#1F2757;--hero:#16205F;--hero-mut:#B6C0F2;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--f-body);font-size:17px;line-height:1.5;-webkit-font-smoothing:antialiased}
h1,h2,h3{font-family:var(--f-display);letter-spacing:-.02em;margin:0;text-wrap:balance}
p{margin:0}a{color:inherit}
:focus-visible{outline:3px solid var(--sun);outline-offset:2px}
.wrap{width:100%;max-width:1080px;margin-inline:auto;padding-inline:20px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:0;border-radius:14px;padding:14px 22px;font:700 17px var(--f-body);cursor:pointer;text-decoration:none;background:var(--brand);color:var(--brand-ink)}
.btn.sun{background:var(--sun);color:var(--sun-ink)}
.btn.line{background:transparent;color:inherit;border:1.5px solid currentColor}
.btn.slim{padding:9px 16px;font-size:15px}
.btn.full{display:flex;width:100%;margin-top:18px}
.hero{background:var(--hero);color:var(--hero-ink)}
.nav{display:flex;align-items:center;gap:16px;padding-block:18px}
.logo{font:800 26px var(--f-display);letter-spacing:-.02em;text-decoration:none;display:flex;gap:6px}
.logo b{background:var(--sun);color:var(--sun-ink);padding:0 9px 3px;border-radius:12px 12px 12px 3px}
.nav .sp{flex:1}
.nav a.l{font-weight:600;text-decoration:none;color:var(--hero-mut)}
.intro{padding-block:18px 56px}
.crumbs{font-size:14px;color:var(--hero-mut);margin-bottom:18px}
.crumbs a{color:var(--hero-mut)}
.intro h1{font-size:clamp(34px,6vw,58px);line-height:1.04;font-weight:800;max-width:16em}
.lead{margin-top:16px;font-size:19px;color:var(--hero-mut);max-width:38em}
.cta{display:flex;gap:12px;flex-wrap:wrap;margin-top:26px}
.hero .btn.line{color:var(--hero-ink)}
.fine{margin-top:14px;font-size:14px;color:var(--hero-mut)}
section{padding-block:56px}
section.alt{background:var(--surface)}
.sec-h{max-width:640px;margin-bottom:26px}
.sec-h h2{font-size:clamp(26px,4vw,36px);line-height:1.1;font-weight:800}
.sec-h p{margin-top:10px;color:var(--muted);font-size:17px}
.split{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);gap:40px;align-items:start}
.jobs{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.jobs li{display:flex;gap:10px;align-items:flex-start;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:12px 14px;font-weight:600}
.jobs .ic{flex:none;color:var(--brand);margin-top:3px}
.box{background:var(--surface);border:1px solid var(--line);border-radius:22px;padding:24px;min-width:0}
.alt .box{background:var(--bg)}
.box h3{font-size:22px;margin-bottom:12px}
.box.dark{background:var(--hero);color:var(--hero-ink);border:0}
.box.dark p{color:var(--hero-mut);margin:6px 0 18px;max-width:40em}
.steps{margin:0;padding:0;list-style:none;counter-reset:s;display:grid;gap:14px}
.steps li{counter-increment:s;display:grid;grid-template-columns:34px 1fr;column-gap:12px}
.steps li::before{content:counter(s);grid-row:span 2;display:grid;place-items:center;width:34px;height:34px;border-radius:11px;background:var(--sun);color:var(--sun-ink);font:800 17px var(--f-display)}
.steps span{color:var(--muted);font-size:15.5px}
.places{display:flex;flex-wrap:wrap;gap:10px}
.place{padding:9px 15px;border-radius:999px;border:1.5px solid var(--line);font-weight:600;font-size:15px;background:var(--surface);text-decoration:none}
a.place:hover{border-color:var(--brand);color:var(--brand)}
.faq details{background:var(--bg);border:1px solid var(--line);border-radius:16px;padding:14px 18px;margin-bottom:10px}
.faq summary{font-weight:700;cursor:pointer}
.faq details p{margin-top:8px;color:var(--muted)}
.pros{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.prop{display:flex;align-items:center;gap:12px;border:1.5px solid var(--line);border-radius:16px;padding:12px;background:var(--surface);text-decoration:none;color:inherit;min-width:0}
.av{flex:none;width:46px;height:46px;border-radius:50%;display:grid;place-items:center;color:#fff;font:800 15px var(--f-display);object-fit:cover}
.prop .t{flex:1;min-width:0}.prop .t b{display:block}.prop .t span{display:block;font-size:14px;color:var(--muted)}
.prop .go{font-weight:700;color:var(--brand)!important;margin-top:4px}
.hubgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
footer{background:var(--hero);color:var(--hero-mut);padding-block:26px;font-size:14px}
footer .wrap{display:flex;gap:10px 24px;flex-wrap:wrap;justify-content:space-between}
footer a{color:inherit}
@media (max-width:760px){.split{grid-template-columns:minmax(0,1fr)}.jobs{grid-template-columns:minmax(0,1fr)}.nav a.l{display:none}section{padding-block:44px}}
"""

JS = """// Mostra, nas páginas de serviço, os profissionais aprovados daquela categoria e cidade (dados públicos do app).
(function () {
  var C = window.RJ_APP, cat = document.body.getAttribute("data-cat"), cid = document.body.getAttribute("data-cidade");
  if (!C || !C.url || !C.anonKey || !cat || !cid || !window.fetch) return;
  function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function norm(t) { return String(t || "").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase().trim(); }
  var cores = ["#1F3BD1", "#0E8A5F", "#B4470C", "#7A3BC4", "#B0245A"];
  fetch(C.url + "/rest/v1/rpc/public_pros", { method: "POST", headers: { apikey: C.anonKey, Authorization: "Bearer " + C.anonKey, "Content-Type": "application/json" }, body: "{}" })
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (l) {
      if (!Array.isArray(l)) return;
      l = l.filter(function (x) {
        var okCat = (x.categories || []).some(function (c) { return norm(c) === norm(cat); });
        var okCid = (x.cities || []).some(function (c) { return norm(c).indexOf(norm(cid)) === 0; });
        return okCat && okCid;
      });
      if (!l.length) return;
      document.getElementById("vitrine-n").textContent = (l.length === 1 ? "1 profissional aprovado" : l.length + " profissionais aprovados") + " pela nossa equipe para este serviço.";
      document.getElementById("vitrine-list").innerHTML = l.slice(0, 12).map(function (x, i) {
        var ini = esc((x.display_name || "?").replace(/[^A-Za-zÀ-ú ]/g, "").split(" ").slice(0, 2).map(function (w) { return w[0] || ""; }).join("").toUpperCase());
        var meta = [];
        if (x.years_exp) meta.push(x.years_exp + " anos de experiência");
        if (x.rating_count > 0) meta.push("Nota " + Number(x.rating_avg).toFixed(1).replace(".", ",") + " (" + x.rating_count + ")");
        var av = x.avatar_path ? '<img class="av" alt="" loading="lazy" src="' + esc(C.url + "/storage/v1/object/public/portfolio/" + x.avatar_path.split("/").map(encodeURIComponent).join("/")) + '">' : '<span class="av" style="background:' + cores[i % cores.length] + '">' + ini + "</span>";
        return '<a class="prop" href="/app/#/?modo=cadastro&pro=' + encodeURIComponent(x.id || "") + "&c=" + encodeURIComponent(cat) + '">' + av + '<div class="t"><b>' + esc(x.display_name) + "</b>" + (meta.length ? "<span>" + esc(meta.join(" · ")) + "</span>" : "") + '<span class="go">Pedir orçamento →</span></div></a>';
      }).join("");
      document.getElementById("vitrine").hidden = false;
    }).catch(function () {});
})();
"""


def main():
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        if f.endswith(".html"):
            os.remove(os.path.join(OUT, f))
    open(os.path.join(OUT, "servicos.css"), "w").write(CSS)
    open(os.path.join(OUT, "servicos.js"), "w").write(JS)
    open(os.path.join(OUT, "index.html"), "w").write(hub())
    urls = [SITE + "/", SITE + "/servicos/"]
    for c in CIDADES:
        for s in SERVICOS:
            p = url_pagina(s, c)
            open(os.path.join(ROOT, p.lstrip("/") + ".html"), "w").write(pagina(s, c))
            urls.append(SITE + p)
    urls += [SITE + "/termos", SITE + "/privacidade", SITE + "/termo-prestador"]
    sm = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "".join(f"  <url><loc>{u}</loc></url>\n" for u in urls) + "</urlset>\n"
    open(os.path.join(ROOT, "sitemap.xml"), "w").write(sm)
    print(len(urls) - 5, "páginas de serviço;", len(urls), "endereços no sitemap")


if __name__ == "__main__":
    main()
