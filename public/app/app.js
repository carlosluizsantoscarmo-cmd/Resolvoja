/* Resolvo Já — app (PWA). Cliente e profissional no mesmo aplicativo.
   Fala direto com o Supabase; quem protege os dados são as regras do banco (RLS). */
(function () {
  "use strict";
  var CFG = window.RJ_APP || {};
  var app = document.getElementById("app");
  var TERMS_VERSION = "2026-10-v1";
  var sb = null, user = null, profile = null, pro = null, proReady = false;
  var cats = [], regions = [], timer = null, installEvt = null, proTab = "abertos";

  // ---------- utilidades ----------
  function e(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function brl(c) { return "R$ " + (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function parseBrl(s) {
    s = String(s || "").trim().replace(/[R$\s]/g, "");
    if (!s) return NaN;
    if (s.indexOf(",") > -1) s = s.replace(/\./g, "").replace(",", ".");
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
    var n = Number(s);
    return isFinite(n) && n > 0 ? Math.round(n * 100) : NaN;
  }
  function dt(iso) { return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }); }
  function hm(iso) { return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
  function $(id) { return document.getElementById(id); }
  function toast(m) { var t = $("toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove("show"); }, 3200); }
  function friendly(err) {
    var m = String((err && (err.message || err.error_description)) || err || "");
    if (/invalid login/i.test(m)) return "E-mail ou senha incorretos.";
    if (/already registered|already been registered/i.test(m)) return "Este e-mail já tem cadastro. Use a aba Entrar.";
    if (/not confirmed/i.test(m)) return "Confirme seu e-mail (veja a caixa de entrada) antes de entrar.";
    if (/password/i.test(m) && /(short|least|weak)/i.test(m)) return "A senha precisa ter pelo menos 8 caracteres.";
    if (/rate limit|too many/i.test(m)) return "Muitas tentativas. Espere um pouco e tente de novo.";
    if (/failed to fetch|network/i.test(m)) return "Sem conexão. Confira a internet e tente de novo.";
    if (/row-level security|permission denied/i.test(m)) return "Sem permissão para essa ação.";
    return "Não foi possível concluir agora. Tente de novo em instantes.";
  }
  var STATUS = { open: ["Aberto", "warn"], awaiting_payment: ["Aguardando pagamento", "warn"], hired: ["Em andamento", "ok"], completed: ["Concluído", "ok"], cancelled: ["Cancelado", "err"], disputed: ["Em disputa", "err"] };
  var PSTATUS = { sent: ["Enviada", "warn"], accepted: ["Aceita", "ok"], rejected: ["Não escolhida", "err"], withdrawn: ["Retirada", "err"] };
  var SLOT = { manha: "Manhã", tarde: "Tarde", noite: "Noite", flexivel: "Flexível" };
  function pill(map, k) { var m = map[k] || [k, ""]; return '<span class="pill ' + m[1] + '">' + e(m[0]) + "</span>"; }
  function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }
  function go(h) { if (location.hash === h) route(); else location.hash = h; }

  // ---------- estrutura da tela ----------
  function shell(inner, tab) {
    var isPro = profile && profile.role === "pro";
    var nav = isPro
      ? '<a href="#/" class="' + (tab === "home" ? "on" : "") + '">Início</a><a href="#/perfil" class="' + (tab === "perfil" ? "on" : "") + '">Perfil</a>'
      : '<a href="#/" class="' + (tab === "home" ? "on" : "") + '">Meus pedidos</a><a href="#/novo" class="' + (tab === "novo" ? "on" : "") + '">Novo pedido</a><a href="#/perfil" class="' + (tab === "perfil" ? "on" : "") + '">Perfil</a>';
    app.innerHTML = '<header class="top"><div class="logo">Resolvo <b>Já</b></div><span class="muted small">' + e(profile ? profile.name.split(" ")[0] : "") + "</span></header>" + inner +
      '<nav class="bottom"><div class="in">' + nav + "</div></nav>";
  }
  function plain(inner) { app.innerHTML = '<header class="top"><div class="logo">Resolvo <b>Já</b></div></header>' + inner; }
  function loading() { app.innerHTML = '<p class="boot">Carregando…</p>'; }

  // ---------- telas de entrada ----------
  function screenConfig(msg) {
    plain('<div class="card"><h1>App em preparação</h1><p class="muted">' + e(msg || "O aplicativo ainda não foi configurado.") + "</p></div>");
  }

  function installBlock() {
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    var standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    if (standalone) return "";
    if (installEvt) return '<button class="ghost full" id="inst" type="button">Instalar o app no celular</button>';
    if (ios) return '<p class="muted small center" style="margin-top:14px">No iPhone: toque em <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>.</p>';
    return '<p class="muted small center" style="margin-top:14px">No Android: abra o menu do navegador e escolha <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.</p>';
  }
  function bindInstall() {
    var b = $("inst");
    if (b) b.onclick = function () { installEvt.prompt(); installEvt.userChoice.finally(function () { installEvt = null; }); };
  }

  function screenAuth(mode) {
    stopTimer();
    mode = mode || "login";
    var signup = mode === "signup";
    plain(
      '<h1>' + (signup ? "Criar conta" : "Entrar") + "</h1>" +
      '<p class="muted">Peça serviços e receba propostas de profissionais perto de você.</p>' +
      '<div class="tabs"><button type="button" id="t1" class="' + (signup ? "" : "on") + '">Entrar</button><button type="button" id="t2" class="' + (signup ? "on" : "") + '">Criar conta</button></div>' +
      '<form class="card" id="f" novalidate>' +
      (signup
        ? '<label for="nome">Nome completo</label><input id="nome" autocomplete="name" maxlength="100">' +
          '<label for="tel">WhatsApp com DDD</label><input id="tel" type="tel" autocomplete="tel" placeholder="(27) 9 0000-0000" maxlength="20">'
        : "") +
      '<label for="email">E-mail</label><input id="email" type="email" autocomplete="email" maxlength="120">' +
      '<label for="senha">Senha</label><input id="senha" type="password" autocomplete="' + (signup ? "new-password" : "current-password") + '" maxlength="72">' +
      (signup
        ? '<p class="muted small" style="margin:6px 0 0">Mínimo de 8 caracteres.</p>' +
          '<label>Como você vai usar o app?</label><div class="chips"><label><input type="radio" name="role" value="client" checked> Quero contratar</label><label><input type="radio" name="role" value="pro"> Sou profissional</label></div>' +
          '<p id="prohint" class="banner" hidden>Profissional: depois de criar a conta e entrar, você escolhe os <b>serviços</b>, os <b>bairros</b> e informa a <b>experiência</b> na próxima tela.</p>' +
          '<label style="font-weight:500;display:flex;gap:8px;align-items:flex-start;margin-top:16px"><input id="ok" type="checkbox" style="width:auto;margin-top:4px"><span>Li e aceito os <a href="/termos.html" target="_blank" rel="noopener">Termos</a> e a <a href="/privacidade.html" target="_blank" rel="noopener">Política de Privacidade</a>.</span></label>'
        : "") +
      '<div id="err"></div><button class="full" id="go" type="submit">' + (signup ? "Criar conta" : "Entrar") + "</button></form>" + installBlock()
    );
    bindInstall();
    Array.prototype.forEach.call(document.querySelectorAll('input[name="role"]'), function (r) {
      r.onchange = function () { var h = $("prohint"); if (h) h.hidden = document.querySelector('input[name="role"]:checked').value !== "pro"; };
    });
    $("t1").onclick = function () { screenAuth("login"); };
    $("t2").onclick = function () { screenAuth("signup"); };
    $("f").onsubmit = async function (ev) {
      ev.preventDefault();
      var err = $("err"), btn = $("go"); err.innerHTML = "";
      function bad(m) { err.innerHTML = '<div class="banner err" role="alert">' + e(m) + "</div>"; }
      var email = $("email").value.trim(), senha = $("senha").value;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return bad("Confira o e-mail.");
      if (senha.length < 8) return bad("A senha precisa ter pelo menos 8 caracteres.");
      btn.disabled = true;
      try {
        if (!signup) {
          var r = await sb.auth.signInWithPassword({ email: email, password: senha });
          if (r.error) throw r.error;
        } else {
          var nome = $("nome").value.trim(), tel = $("tel").value.trim(), digits = tel.replace(/\D/g, "");
          if (nome.length < 2) { btn.disabled = false; return bad("Informe seu nome."); }
          if (digits.length < 10 || digits.length > 13) { btn.disabled = false; return bad("Confira o WhatsApp. Use o DDD."); }
          if (!$("ok").checked) { btn.disabled = false; return bad("Marque a aceitação dos Termos e da Política de Privacidade."); }
          var role = document.querySelector('input[name="role"]:checked').value;
          try { localStorage.setItem("rj_pending", JSON.stringify({ email: email.toLowerCase(), role: role, name: nome, phone: tel })); } catch (x) {}
          var s = await sb.auth.signUp({ email: email, password: senha, options: { data: { name: nome } } });
          if (s.error) throw s.error;
          if (!s.data.session) {
            plain('<div class="card"><h1>Confirme seu e-mail</h1><p>Enviamos uma mensagem para <b>' + e(email) + '</b>. Abra o link para ativar a conta e depois volte aqui para entrar.' + (role === "pro" ? " Ao entrar, você completa serviços, bairros e experiência." : "") + '</p><button class="full" id="vol" type="button">Ir para Entrar</button></div>');
            $("vol").onclick = function () { screenAuth("login"); };
          }
        }
      } catch (x) { btn.disabled = false; bad(friendly(x)); }
    };
  }

  // ---------- cadastro básico / profissional ----------
  function screenBasicProfile() {
    plain('<h1>Complete seu cadastro</h1><form class="card" id="f" novalidate>' +
      '<label for="nome">Nome completo</label><input id="nome" maxlength="100" autocomplete="name">' +
      '<label for="tel">WhatsApp com DDD</label><input id="tel" type="tel" maxlength="20" placeholder="(27) 9 0000-0000">' +
      '<label>Como você vai usar o app?</label><div class="chips"><label><input type="radio" name="role" value="client" checked> Quero contratar</label><label><input type="radio" name="role" value="pro"> Sou profissional</label></div>' +
      '<div id="err"></div><button class="full" id="go" type="submit">Continuar</button></form>');
    $("f").onsubmit = async function (ev) {
      ev.preventDefault();
      var nome = $("nome").value.trim(), tel = $("tel").value.trim(), d = tel.replace(/\D/g, "");
      if (nome.length < 2 || d.length < 10 || d.length > 13) { $("err").innerHTML = '<div class="banner err">Confira nome e WhatsApp (com DDD).</div>'; return; }
      $("go").disabled = true;
      try { await createProfile({ role: document.querySelector('input[name="role"]:checked').value, name: nome, phone: tel }); await loadMe(true); route(); }
      catch (x) { $("go").disabled = false; $("err").innerHTML = '<div class="banner err">' + e(friendly(x)) + "</div>"; }
    };
  }

  async function createProfile(p) {
    var r = await sb.from("profiles").insert({ id: user.id, role: p.role === "pro" ? "pro" : "client", name: p.name, phone: p.phone });
    if (r.error) throw r.error;
    try { localStorage.removeItem("rj_pending"); } catch (x) {}
  }

  async function screenProSetup() {
    loading();
    var c = await sb.from("categories").select("id,name").eq("active", true).order("name");
    var rg = await sb.from("regions").select("id,city,name").eq("active", true).order("city").order("name");
    cats = c.data || []; regions = rg.data || [];
    plain('<h1>Cadastro de profissional</h1><p class="muted">Nossa equipe confere seus dados antes de liberar os pedidos. Você só aparece para clientes depois de aprovado.</p>' +
      '<form class="card" id="f" novalidate>' +
      '<label>O que você faz?</label><div class="chips">' + cats.map(function (x) { return '<label><input type="checkbox" name="cat" value="' + x.id + '"> ' + e(x.name) + "</label>"; }).join("") + "</div>" +
      '<label>Onde você atende?</label><div class="chips">' + regions.map(function (x) { return '<label><input type="checkbox" name="reg" value="' + x.id + '"> ' + e(x.name) + " (" + e(x.city) + ")</label>"; }).join("") + "</div>" +
      '<label for="exp">Anos de experiência</label><input id="exp" type="number" inputmode="numeric" min="0" max="70">' +
      '<label for="bio">Fale um pouco sobre seu trabalho</label><textarea id="bio" maxlength="600" placeholder="Ex.: Eletricista há 8 anos. Instalação de chuveiro, tomadas, quadro de luz."></textarea>' +
      '<label style="font-weight:500;display:flex;gap:8px;align-items:flex-start;margin-top:16px"><input id="ok" type="checkbox" style="width:auto;margin-top:4px"><span>Li e aceito os <a href="/termos.html" target="_blank" rel="noopener">Termos</a>, inclusive a taxa de verificação de R$ 29,90 e a comissão de 10% sobre os serviços feitos pelo app.</span></label>' +
      '<div id="err"></div><button class="full" id="go" type="submit">Enviar para análise</button></form>');
    $("f").onsubmit = async function (ev) {
      ev.preventDefault();
      function bad(m) { $("err").innerHTML = '<div class="banner err" role="alert">' + e(m) + "</div>"; }
      var cs = Array.prototype.map.call(document.querySelectorAll('input[name="cat"]:checked'), function (i) { return Number(i.value); });
      var rs = Array.prototype.map.call(document.querySelectorAll('input[name="reg"]:checked'), function (i) { return Number(i.value); });
      var exp = $("exp").value === "" ? null : Number($("exp").value), bio = $("bio").value.trim();
      if (!cs.length) return bad("Escolha pelo menos um serviço.");
      if (!rs.length) return bad("Escolha pelo menos um bairro de atendimento.");
      if (exp !== null && (!(exp >= 0) || exp > 70)) return bad("Confira os anos de experiência.");
      if (!$("ok").checked) return bad("Marque a aceitação dos Termos para continuar.");
      $("go").disabled = true;
      try {
        if (!pro) {
          var a = await sb.from("pro_profiles").insert({ user_id: user.id, bio: bio || null, years_exp: exp, status: "pending" });
          if (a.error) throw a.error;
        }
        var b1 = await sb.from("pro_categories").upsert(cs.map(function (id) { return { user_id: user.id, category_id: id }; }));
        if (b1.error) throw b1.error;
        var b2 = await sb.from("pro_regions").upsert(rs.map(function (id) { return { user_id: user.id, region_id: id }; }));
        if (b2.error) throw b2.error;
        var t = await sb.from("terms_acceptances").select("id").eq("document", "termo_prestador").limit(1);
        if (!t.data || !t.data.length) {
          var t2 = await sb.rpc("accept_terms", { p_version: TERMS_VERSION, p_user_agent: String(navigator.userAgent).slice(0, 200) });
          if (t2.error) throw t2.error;
        }
        await loadMe(true); go("#/");
      } catch (x) { $("go").disabled = false; bad(friendly(x)); }
    };
  }

  // ---------- dados do usuário ----------
  async function loadMe(force) {
    if (!user) return;
    if (profile && !force) return;
    var p = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
    profile = p.data || null;
    if (!profile) {
      var pend = null;
      try { pend = JSON.parse(localStorage.getItem("rj_pending") || "null"); } catch (x) {}
      if (pend && user.email && pend.email === String(user.email).toLowerCase()) {
        try { await createProfile(pend); var p2 = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle(); profile = p2.data || null; } catch (x) {}
      }
    }
    pro = null; proReady = true;
    if (profile && profile.role === "pro") {
      var q = await sb.from("pro_profiles").select("*").eq("user_id", user.id).maybeSingle();
      pro = q.data || null;
      if (pro) {
        var c = await sb.from("pro_categories").select("category_id", { count: "exact", head: true }).eq("user_id", user.id);
        var t = await sb.from("terms_acceptances").select("id", { count: "exact", head: true }).eq("document", "termo_prestador");
        if (!(c.count > 0) || !(t.count > 0)) pro._incomplete = true;
      }
    }
  }

  // ---------- roteador ----------
  async function route() {
    stopTimer();
    if (!sb) return screenConfig(CFG.anonKey ? "Não foi possível carregar o aplicativo. Confira a internet e abra de novo." : "Falta configurar a chave pública do banco de dados.");
    if (!user) return screenAuth();
    loading();
    try {
      await loadMe();
      if (!profile) return screenBasicProfile();
      if (profile.role === "admin") return shell('<div class="card"><h1>Conta da equipe</h1><p>Use o painel da equipe no computador: <a href="/admin.html">painel</a>.</p><button class="ghost full" id="out" type="button">Sair</button></div>', "perfil"), ($("out").onclick = signOut);
      if (profile.role === "pro" && (!pro || pro._incomplete)) return screenProSetup();
      var h = location.hash || "#/", m;
      if (h === "#/perfil") return screenPerfil();
      if (profile.role === "pro") {
        if ((m = h.match(/^#\/pedido\/([0-9a-f-]{36})$/i))) return proRequest(m[1]);
        return proHome();
      }
      if (h === "#/novo") return clientNew();
      if ((m = h.match(/^#\/pedido\/([0-9a-f-]{36})$/i))) return clientRequest(m[1]);
      return clientHome();
    } catch (x) {
      shell('<div class="banner err" role="alert">' + e(friendly(x)) + '</div><button class="full" id="re" type="button">Tentar de novo</button>', "home");
      $("re").onclick = route;
    }
  }

  async function signOut() { await sb.auth.signOut(); profile = null; pro = null; user = null; location.hash = ""; route(); }

  // ---------- perfil ----------
  function screenPerfil() {
    var isPro = profile.role === "pro";
    shell('<h1>Perfil</h1><div class="card"><p><b>' + e(profile.name) + "</b><br><span class=\"muted\">" + e(user.email || "") + "<br>" + e(profile.phone || "") + "</span></p>" +
      "<p>" + (isPro ? "Profissional " + (pro && pro.status === "approved" ? '<span class="pill ok">aprovado</span>' : pro && pro.status === "suspended" ? '<span class="pill err">suspenso</span>' : '<span class="pill warn">em análise</span>') : "Cliente") + "</p></div>" +
      installBlock() +
      '<p class="small center muted" style="margin-top:18px"><a href="/termos.html" target="_blank" rel="noopener">Termos</a> · <a href="/privacidade.html" target="_blank" rel="noopener">Privacidade</a></p>' +
      '<button class="danger full" id="out" type="button">Sair da conta</button>', "perfil");
    $("out").onclick = signOut; bindInstall();
  }

  // ---------- chat ----------
  function chatBlock(requestId) {
    return '<h2>Conversa</h2><div class="card"><div class="chat" id="chat" aria-live="polite"></div><form id="cf" class="row" style="margin-top:8px;align-items:stretch"><input id="cm" maxlength="500" placeholder="Escreva uma mensagem" aria-label="Mensagem"><button type="submit" style="flex:none">Enviar</button></form></div>';
  }
  async function chatLoad(requestId) {
    var r = await sb.from("messages").select("id,sender_id,body,created_at").eq("request_id", requestId).order("created_at");
    var box = $("chat"); if (!box || r.error) return;
    var stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
    box.innerHTML = (r.data || []).length ? r.data.map(function (m) { return '<div class="msg ' + (m.sender_id === user.id ? "me" : "") + '">' + e(m.body) + "<time>" + dt(m.created_at) + " " + hm(m.created_at) + "</time></div>"; }).join("") : '<p class="muted small center">Nenhuma mensagem ainda.</p>';
    if (stick) box.scrollTop = box.scrollHeight;
  }
  function chatBind(requestId) {
    chatLoad(requestId);
    timer = setInterval(function () { chatLoad(requestId); }, 8000);
    $("cf").onsubmit = async function (ev) {
      ev.preventDefault();
      var v = $("cm").value.trim(); if (!v) return;
      $("cm").value = "";
      var r = await sb.from("messages").insert({ request_id: requestId, sender_id: user.id, body: v });
      if (r.error) { toast("Não foi possível enviar a mensagem."); $("cm").value = v; } else chatLoad(requestId);
    };
  }

  // ---------- cliente ----------
  async function clientHome() {
    var r = await sb.from("service_requests").select("id,title,status,created_at,categories(name)").order("created_at", { ascending: false });
    if (r.error) throw r.error;
    var list = r.data || [], counts = {};
    if (list.length) {
      var pr = await sb.from("proposals").select("request_id,status").in("request_id", list.map(function (x) { return x.id; }));
      (pr.data || []).forEach(function (p) { if (p.status === "sent") counts[p.request_id] = (counts[p.request_id] || 0) + 1; });
    }
    shell("<h1>Meus pedidos</h1>" + (list.length ? list.map(function (x) {
      var n = counts[x.id] || 0;
      return '<a class="card" href="#/pedido/' + x.id + '"><div class="row"><b>' + e(x.title) + "</b>" + pill(STATUS, x.status) + '</div><div class="muted small">' + e(x.categories ? x.categories.name : "") + " · " + dt(x.created_at) + (x.status === "open" ? " · " + (n ? n + " proposta" + (n > 1 ? "s" : "") : "aguardando propostas") : "") + "</div></a>";
    }).join("") : '<div class="empty">Você ainda não fez nenhum pedido.<br>Toque em <b>Novo pedido</b> para começar.</div>') +
      '<a class="btn fab" href="#/novo">+ Novo pedido</a>', "home");
  }

  async function clientNew() {
    var c = await sb.from("categories").select("id,name").eq("active", true).order("name");
    var rg = await sb.from("regions").select("id,city,name").eq("active", true).order("city").order("name");
    cats = c.data || []; regions = rg.data || [];
    shell('<h1>Novo pedido</h1><p class="muted">Descreva o que você precisa. Profissionais da sua região enviam propostas.</p>' +
      '<form class="card" id="f" novalidate>' +
      '<label for="cat">Tipo de serviço</label><select id="cat"><option value="">Escolha…</option>' + cats.map(function (x) { return '<option value="' + x.id + '">' + e(x.name) + "</option>"; }).join("") + "</select>" +
      '<label for="tit">Título curto</label><input id="tit" maxlength="80" placeholder="Ex.: Trocar chuveiro elétrico">' +
      '<label for="des">Descreva o serviço</label><textarea id="des" maxlength="1000" placeholder="O que precisa ser feito? Tem alguma urgência?"></textarea>' +
      '<label for="reg">Bairro</label><select id="reg"><option value="">Escolha…</option>' + regions.map(function (x) { return '<option value="' + x.id + '">' + e(x.name) + " — " + e(x.city) + "</option>"; }).join("") + "</select>" +
      '<p class="muted small" style="margin:6px 0 0">Por enquanto atendemos só estes bairros do piloto. O endereço completo só é liberado ao profissional contratado.</p>' +
      '<label for="rua">Rua</label><input id="rua" maxlength="120" autocomplete="address-line1">' +
      '<div class="row" style="align-items:flex-start;gap:10px"><div style="flex:1"><label for="num">Número</label><input id="num" maxlength="12"></div><div style="flex:2"><label for="comp">Complemento</label><input id="comp" maxlength="60"></div></div>' +
      '<label for="dat">Data desejada (opcional)</label><input id="dat" type="date">' +
      '<label for="slot">Horário</label><select id="slot"><option value="flexivel">Flexível</option><option value="manha">Manhã</option><option value="tarde">Tarde</option><option value="noite">Noite</option></select>' +
      '<div id="err"></div><button class="full" id="go" type="submit">Publicar pedido</button></form>', "novo");
    $("dat").min = new Date().toISOString().slice(0, 10);
    $("f").onsubmit = async function (ev) {
      ev.preventDefault();
      function bad(m) { $("err").innerHTML = '<div class="banner err" role="alert">' + e(m) + "</div>"; }
      var cat = Number($("cat").value), reg = regions.filter(function (x) { return String(x.id) === $("reg").value; })[0];
      var tit = $("tit").value.trim(), des = $("des").value.trim(), rua = $("rua").value.trim();
      if (!cat) return bad("Escolha o tipo de serviço.");
      if (tit.length < 4) return bad("Escreva um título (mínimo de 4 letras).");
      if (des.length < 10) return bad("Descreva melhor o serviço.");
      if (!reg) return bad("Escolha o bairro.");
      if (rua.length < 3) return bad("Informe a rua.");
      $("go").disabled = true;
      try {
        var a = await sb.from("addresses").insert({ user_id: user.id, label: "Pedido", street: rua, number: $("num").value.trim() || null, complement: $("comp").value.trim() || null, neighborhood: reg.name, city: reg.city, state: "ES" }).select("id").single();
        if (a.error) throw a.error;
        var q = await sb.from("service_requests").insert({ client_id: user.id, category_id: cat, address_id: a.data.id, title: tit, description: des, desired_date: $("dat").value || null, desired_slot: $("slot").value }).select("id").single();
        if (q.error) throw q.error;
        toast("Pedido publicado!"); go("#/pedido/" + q.data.id);
      } catch (x) { $("go").disabled = false; bad(friendly(x)); }
    };
  }

  async function clientRequest(id) {
    var r = await sb.from("service_requests").select("*,categories(name)").eq("id", id).maybeSingle();
    if (r.error) throw r.error;
    if (!r.data) return shell('<div class="empty">Pedido não encontrado.</div><a class="btn full" href="#/">Voltar</a>', "home");
    var q = r.data;
    var pr = await sb.from("proposals").select("*").eq("request_id", id).order("amount_cents");
    var props = pr.data || [], names = {};
    if (props.length) {
      var pp = await sb.from("pro_public").select("id,name,bio,years_exp,rating_avg,rating_count").in("id", props.map(function (x) { return x.pro_id; }));
      (pp.data || []).forEach(function (x) { names[x.id] = x; });
    }
    var html = '<p><a href="#/">← Meus pedidos</a></p><h1>' + e(q.title) + '</h1><div class="row"><span class="muted small">' + e(q.categories ? q.categories.name : "") + " · " + dt(q.created_at) + "</span>" + pill(STATUS, q.status) + "</div>" +
      '<div class="card"><p style="white-space:pre-wrap;margin:0">' + e(q.description) + "</p>" +
      (q.desired_date || q.desired_slot ? '<p class="muted small" style="margin:10px 0 0">Preferência: ' + (q.desired_date ? new Date(q.desired_date + "T12:00:00").toLocaleDateString("pt-BR") + " · " : "") + e(SLOT[q.desired_slot] || "") + "</p>" : "") + "</div>";
    if (q.status === "awaiting_payment") html += '<div class="banner">Você escolheu uma proposta. O pagamento seguro dentro do app ainda está sendo liberado: a equipe do Resolvo Já vai falar com você no WhatsApp para combinar os próximos passos.</div>';
    if (q.status === "open" || q.status === "awaiting_payment" || q.status === "hired" || q.status === "completed") {
      html += "<h2>Propostas" + (props.length ? " (" + props.length + ")" : "") + "</h2>";
      html += props.length ? props.map(function (p) {
        var n = names[p.pro_id] || {};
        return '<div class="card"><div class="row"><b>' + e(n.name || "Profissional") + '</b><span class="price">' + brl(p.amount_cents) + "</span></div>" +
          '<div class="muted small">' + (n.rating_count ? "★ " + Number(n.rating_avg).toFixed(1) + " (" + n.rating_count + ") · " : "Novo no Resolvo Já · ") + (n.years_exp != null ? n.years_exp + " anos de experiência · " : "") + pill(PSTATUS, p.status) + "</div>" +
          (p.eta_text ? '<p style="margin:8px 0 0"><b>Prazo:</b> ' + e(p.eta_text) + "</p>" : "") + (p.message ? '<p style="margin:6px 0 0;white-space:pre-wrap">' + e(p.message) + "</p>" : "") +
          (n.bio ? '<p class="muted small" style="margin:6px 0 0">' + e(n.bio) + "</p>" : "") +
          (q.status === "open" && p.status === "sent" ? '<button class="full" data-acc="' + p.id + '" type="button">Aceitar esta proposta</button>' : "") + "</div>";
      }).join("") : '<div class="empty">Ainda não chegaram propostas. Avisaremos quando chegar a primeira — volte aqui em alguns minutos.</div>';
    }
    if ((q.status === "open" && props.length) || q.status === "awaiting_payment" || q.status === "hired") html += chatBlock(id);
    if (q.status === "open" || q.status === "awaiting_payment") html += '<button class="danger full" id="can" type="button">Cancelar pedido</button>';
    shell(html, "home");
    Array.prototype.forEach.call(document.querySelectorAll("[data-acc]"), function (b) {
      b.onclick = async function () {
        if (!confirm("Aceitar esta proposta? As outras serão recusadas.")) return;
        b.disabled = true;
        var x = await sb.rpc("accept_proposal", { p_proposal: b.getAttribute("data-acc") });
        if (x.error) { b.disabled = false; toast(friendly(x.error)); } else { toast("Proposta aceita!"); route(); }
      };
    });
    if ($("can")) $("can").onclick = async function () {
      if (!confirm("Cancelar este pedido?")) return;
      var x = await sb.from("service_requests").update({ status: "cancelled" }).eq("id", id);
      if (x.error) toast(friendly(x.error)); else { toast("Pedido cancelado."); route(); }
    };
    if ($("chat")) chatBind(id);
  }

  // ---------- profissional ----------
  async function proHome() {
    var banner = "";
    if (pro.status === "pending") banner = '<div class="banner">Seu cadastro está em análise pela equipe. Assim que for aprovado, os pedidos da sua região aparecem aqui.</div>';
    if (pro.status === "suspended") banner = '<div class="banner err">Seu cadastro está suspenso. Fale com o suporte do Resolvo Já.</div>';
    if (pro.status !== "approved") return shell("<h1>Início</h1>" + banner, "home");
    var mine = await sb.from("proposals").select("*,service_requests(id,title,status,categories(name))").eq("pro_id", user.id).order("created_at", { ascending: false });
    var myList = mine.data || [], proposed = {};
    myList.forEach(function (p) { proposed[p.request_id] = true; });
    var body = "";
    if (proTab === "abertos") {
      var r = await sb.from("service_requests").select("id,title,description,desired_date,desired_slot,created_at,categories(name)").eq("status", "open").order("created_at", { ascending: false });
      if (r.error) throw r.error;
      var list = (r.data || []).filter(function (x) { return !proposed[x.id]; });
      body = list.length ? list.map(function (x) {
        return '<a class="card" href="#/pedido/' + x.id + '"><div class="row"><b>' + e(x.title) + '</b><span class="muted small">' + dt(x.created_at) + '</span></div><div class="muted small">' + e(x.categories ? x.categories.name : "") + (x.desired_date ? " · para " + new Date(x.desired_date + "T12:00:00").toLocaleDateString("pt-BR") : "") + '</div><p class="small" style="margin:6px 0 0">' + e(x.description.slice(0, 120)) + (x.description.length > 120 ? "…" : "") + "</p></a>";
      }).join("") : '<div class="empty">Nenhum pedido novo na sua região agora. Volte daqui a pouco.</div>';
    } else {
      body = myList.length ? myList.map(function (p) {
        var s = p.service_requests || {};
        return '<a class="card" href="#/pedido/' + p.request_id + '"><div class="row"><b>' + e(s.title || "Pedido") + "</b>" + pill(PSTATUS, p.status) + '</div><div class="muted small">' + brl(p.amount_cents) + " · " + e(s.categories ? s.categories.name : "") + " · " + dt(p.created_at) + "</div></a>";
      }).join("") : '<div class="empty">Você ainda não enviou propostas.</div>';
    }
    shell("<h1>Início</h1>" + '<div class="tabs"><button type="button" id="ta" class="' + (proTab === "abertos" ? "on" : "") + '">Pedidos abertos</button><button type="button" id="tb" class="' + (proTab === "minhas" ? "on" : "") + '">Minhas propostas</button></div>' + body, "home");
    $("ta").onclick = function () { proTab = "abertos"; route(); };
    $("tb").onclick = function () { proTab = "minhas"; route(); };
  }

  async function proRequest(id) {
    var r = await sb.from("service_requests").select("*,categories(name)").eq("id", id).maybeSingle();
    if (r.error) throw r.error;
    if (!r.data) return shell('<div class="empty">Pedido não encontrado ou já não está disponível.</div><a class="btn full" href="#/">Voltar</a>', "home");
    var q = r.data;
    var m = await sb.from("proposals").select("*").eq("request_id", id).eq("pro_id", user.id).maybeSingle();
    var mine = m.data || null;
    var html = '<p><a href="#/">← Início</a></p><h1>' + e(q.title) + '</h1><div class="row"><span class="muted small">' + e(q.categories ? q.categories.name : "") + " · " + dt(q.created_at) + "</span>" + pill(STATUS, q.status) + "</div>" +
      '<div class="card"><p style="white-space:pre-wrap;margin:0">' + e(q.description) + "</p>" +
      (q.desired_date || q.desired_slot ? '<p class="muted small" style="margin:10px 0 0">Preferência: ' + (q.desired_date ? new Date(q.desired_date + "T12:00:00").toLocaleDateString("pt-BR") + " · " : "") + e(SLOT[q.desired_slot] || "") + "</p>" : "") +
      '<p class="muted small" style="margin:8px 0 0">O endereço completo e o contato do cliente são liberados depois da contratação e do pagamento.</p></div>';
    if (mine) {
      html += "<h2>Sua proposta</h2><div class=\"card\"><div class=\"row\"><span class=\"price\">" + brl(mine.amount_cents) + "</span>" + pill(PSTATUS, mine.status) + "</div>" +
        (mine.eta_text ? "<p style=\"margin:8px 0 0\"><b>Prazo:</b> " + e(mine.eta_text) + "</p>" : "") + (mine.message ? '<p style="margin:6px 0 0;white-space:pre-wrap">' + e(mine.message) + "</p>" : "") +
        '<p class="muted small" style="margin:8px 0 0">Você recebe ' + brl(Math.round(mine.amount_cents * 0.9)) + " (valor menos a comissão de 10%).</p>" +
        (mine.status === "sent" && q.status === "open" ? '<button class="danger full" id="wd" type="button">Retirar proposta</button>' : "") + "</div>";
      if (mine.status === "accepted") html += '<div class="banner ok">Você foi escolhido! O pagamento do cliente está sendo liberado; a equipe do Resolvo Já entra em contato com você.</div>';
      if (mine.status !== "rejected" && mine.status !== "withdrawn" && (q.status === "open" || q.status === "awaiting_payment" || q.status === "hired")) html += chatBlock(id);
    } else if (q.status === "open") {
      html += '<h2>Enviar proposta</h2><form class="card" id="f" novalidate>' +
        '<label for="val">Valor do serviço (R$)</label><input id="val" inputmode="decimal" placeholder="Ex.: 150,00">' +
        '<p class="muted small" id="liq" style="margin:6px 0 0"></p>' +
        '<label for="eta">Quando você pode fazer?</label><input id="eta" maxlength="80" placeholder="Ex.: Amanhã à tarde">' +
        '<label for="msg">Mensagem (opcional)</label><textarea id="msg" maxlength="500" placeholder="Explique o que está incluso no valor."></textarea>' +
        '<div id="err"></div><button class="full" id="go" type="submit">Enviar proposta</button></form>';
    } else html += '<div class="empty">Este pedido não está mais aberto.</div>';
    shell(html, "home");
    if ($("val")) $("val").oninput = function () { var c = parseBrl($("val").value); $("liq").textContent = isNaN(c) ? "" : "Você recebe " + brl(Math.round(c * 0.9)) + " (valor menos a comissão de 10%)."; };
    if ($("f")) $("f").onsubmit = async function (ev) {
      ev.preventDefault();
      function bad(t) { $("err").innerHTML = '<div class="banner err" role="alert">' + e(t) + "</div>"; }
      var c = parseBrl($("val").value);
      if (isNaN(c)) return bad("Informe o valor. Exemplo: 150,00");
      if (c > 5000000) return bad("Confira o valor informado.");
      $("go").disabled = true;
      var x = await sb.from("proposals").insert({ request_id: id, pro_id: user.id, amount_cents: c, eta_text: $("eta").value.trim() || null, message: $("msg").value.trim() || null });
      if (x.error) { $("go").disabled = false; bad(friendly(x.error)); } else { toast("Proposta enviada!"); route(); }
    };
    if ($("wd")) $("wd").onclick = async function () {
      if (!confirm("Retirar sua proposta?")) return;
      var x = await sb.from("proposals").update({ status: "withdrawn" }).eq("id", mine.id);
      if (x.error) toast(friendly(x.error)); else { toast("Proposta retirada."); route(); }
    };
    if ($("chat")) chatBind(id);
  }

  // ---------- início ----------
  window.addEventListener("beforeinstallprompt", function (ev) { ev.preventDefault(); installEvt = ev; });
  window.addEventListener("hashchange", route);
  if ("serviceWorker" in navigator) window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });

  function init() {
    if (!CFG.url || !CFG.anonKey || !window.supabase) { sb = null; return route(); }
    sb = window.supabase.createClient(CFG.url, CFG.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
    var started = false;
    sb.auth.onAuthStateChange(function (ev, session) {
      if (!started) return;
      var u = session ? session.user : null;
      if ((u && u.id) !== (user && user.id)) { user = u; profile = null; pro = null; setTimeout(route, 0); }
    });
    sb.auth.getSession().then(function (r) {
      var u = r.data && r.data.session ? r.data.session.user : null;
      user = u; started = true;
      route();
    });
  }
  init();
})();
