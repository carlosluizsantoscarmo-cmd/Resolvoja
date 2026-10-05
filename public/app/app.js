/* Resolvo Já — app (PWA). Cliente e profissional no mesmo aplicativo.
   Fala direto com o Supabase; quem protege os dados são as regras do banco (RLS). */
(function () {
  "use strict";
  var CFG = window.RJ_APP || {};
  var app = document.getElementById("app");
  var TERMS_VERSION = "2026-10-v1";
  var sb = null, user = null, profile = null, pro = null, proReady = false;
  var cats = [], regions = [], timer = null, installEvt = null, recovering = false;

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
    if (/invalid/i.test(m) && /email/i.test(m)) return "O Supabase não aceitou este e-mail. Use um e-mail real (ex.: Gmail).";
    if (/signups? not allowed/i.test(m)) return "Novos cadastros estão desativados no Supabase (Authentication > Sign In / Providers > Allow new users to sign up).";
    if (/email (signups?|provider|logins?) (is|are) disabled/i.test(m)) return "O cadastro por e-mail está desligado no Supabase (Authentication > Sign In / Providers > Email > Enable Email provider). (Detalhe técnico: " + m.slice(0, 120) + ")";
    try { console.error("Erro do app:", err); } catch (x) {}
    return "Não foi possível concluir agora. Tente de novo em instantes. (Detalhe técnico: " + m.slice(0, 160) + ")";
  }
  var STATUS = { open: ["Aberto", "warn"], awaiting_payment: ["Aguardando pagamento", "warn"], hired: ["Em andamento", "ok"], completed: ["Concluído", "ok"], cancelled: ["Cancelado", "err"], disputed: ["Em disputa", "err"] };
  var PSTATUS = { sent: ["Enviada", "warn"], accepted: ["Aceita", "ok"], rejected: ["Não escolhida", "err"], withdrawn: ["Retirada", "err"] };
  var SLOT = { manha: "Manhã", tarde: "Tarde", noite: "Noite", flexivel: "Flexível" };
  function pill(map, k) { var m = map[k] || [k, ""]; return '<span class="pill ' + m[1] + '">' + e(m[0]) + "</span>"; }
  function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }
  function go(h) { if (location.hash === h) route(); else location.hash = h; }

  // ---------- ícones e peças de tela ----------
  var ICONS = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    list: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h7"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    brush: '<path d="M18 3l3 3-9 9-3-3z"/><path d="M9 12c-3 0-4 2-4 4s-1 3-2 4c3 1 8 0 8-5"/>',
    broom: '<path d="M14 3l-4 8"/><path d="M7 11h8l3 10H4z"/>',
    truck: '<path d="M2 6h11v10H2zM13 9h5l3 3v4h-8"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    pin: '<path d="M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    send: '<path d="M3 11l18-8-8 18-2-8z"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" fill="currentColor"/>'
  };
  function icon(n, s) { s = s || 22; return '<svg class="ic" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[n] || "") + "</svg>"; }
  function catIcon(name) { var n = String(name || "").toLowerCase(); return /eletric/.test(n) ? "bolt" : /encan|hidr/.test(n) ? "drop" : /pintor/.test(n) ? "brush" : /diarista|limpez/.test(n) ? "broom" : /frete|mudan/.test(n) ? "truck" : "wrench"; }
  function initials(n) { var p = String(n || "?").trim().split(/\s+/); return ((p[0] || "?").charAt(0) + (p[1] ? p[1].charAt(0) : "")).toUpperCase(); }
  var AVC = ["", "g", "o", "p"];
  function avatar(n, i) { return '<span class="av ' + AVC[(i || 0) % 4] + '" aria-hidden="true">' + e(initials(n)) + "</span>"; }
  function topbar(title, back) {
    return '<div class="topbar">' + (back ? '<a class="iconbtn" href="' + back + '" aria-label="Voltar">' + icon("back") + "</a>" : "") + "<h2>" + e(title) + "</h2></div>";
  }
  function hashParts() {
    var h = location.hash || "#/", i = h.indexOf("?");
    return { path: i < 0 ? h : h.slice(0, i), q: new URLSearchParams(i < 0 ? "" : h.slice(i + 1)) };
  }

  // ---------- estrutura da tela ----------
  function shell(inner, tab, head) {
    var isPro = profile && profile.role === "pro";
    var items = isPro
      ? [["home", "#/", "Início", "home"], ["propostas", "#/propostas", "Propostas", "list"], ["msg", "#/mensagens", "Mensagens", "chat"], ["perfil", "#/perfil", "Perfil", "user"]]
      : [["home", "#/", "Início", "home"], ["pedidos", "#/pedidos", "Pedidos", "list"], ["msg", "#/mensagens", "Mensagens", "chat"], ["perfil", "#/perfil", "Perfil", "user"]];
    var nav = items.map(function (i) { return '<a href="' + i[1] + '" class="' + (tab === i[0] ? "on" : "") + '"' + (tab === i[0] ? ' aria-current="page"' : "") + ">" + icon(i[3]) + i[2] + "</a>"; }).join("");
    var top = head || '<div class="topbar"><span class="logo">Resolvo <b>Já</b></span><span style="flex:1"></span><span class="muted small">' + e(profile ? profile.name.split(" ")[0] : "") + "</span></div>";
    app.innerHTML = top + '<div class="pad">' + inner + '</div><nav class="bottom"><div class="in">' + nav + "</div></nav>";
    try { window.scrollTo(0, 0); } catch (x) {}
  }
  function plain(inner, heroTitle, heroSub) {
    app.innerHTML = '<div class="hero"><div class="hrow"><span class="logo">Resolvo <b>Já</b></span></div>' + (heroTitle ? "<h1>" + e(heroTitle) + "</h1>" + (heroSub ? '<p class="sub">' + e(heroSub) + "</p>" : "") : "") + '</div><div class="authbox">' + inner + "</div>";
  }
  function loading() { app.innerHTML = '<p class="boot">Carregando…</p>'; }

  // ---------- telas de entrada ----------
  function screenConfig(msg) {
    plain('<div class="card"><p class="muted" style="margin:0">' + e(msg || "O aplicativo ainda não foi configurado.") + "</p></div>", "App em preparação");
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
      '<div id="err"></div><button class="full" id="go" type="submit">' + (signup ? "Criar conta" : "Entrar") + "</button></form>" + (signup ? "" : '<p class="center" style="margin:14px 0 0"><button type="button" class="ghost slim" id="forgot">Esqueci minha senha</button></p>') + installBlock(),
      signup ? "Criar conta" : "Entrar", "Peça serviços e receba propostas de profissionais perto de você."
    );
    bindInstall();
    Array.prototype.forEach.call(document.querySelectorAll('input[name="role"]'), function (r) {
      r.onchange = function () { var h = $("prohint"); if (h) h.hidden = document.querySelector('input[name="role"]:checked').value !== "pro"; };
    });
    if ($("forgot")) $("forgot").onclick = screenForgot;
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
          var s = await sb.auth.signUp({ email: email, password: senha, options: { data: { name: nome }, emailRedirectTo: location.origin + "/app/" } });
          if (s.error) throw s.error;
          if (!s.data.session) {
            plain('<div class="card"><p>Enviamos uma mensagem para <b>' + e(email) + '</b>. Abra o link para ativar a conta e depois volte aqui para entrar.' + (role === "pro" ? " Ao entrar, você completa serviços, bairros e experiência." : "") + '</p><button class="full" id="vol" type="button">Ir para Entrar</button></div>', "Confirme seu e-mail");
            $("vol").onclick = function () { screenAuth("login"); };
          }
        }
      } catch (x) { btn.disabled = false; bad(friendly(x)); }
    };
  }

  // ---------- recuperar senha ----------
  function screenForgot() {
    stopTimer();
    plain('<form class="card" id="f" novalidate><label for="email" style="margin-top:0">E-mail da sua conta</label><input id="email" type="email" autocomplete="email" maxlength="120">' +
      '<div id="err"></div><button class="full" id="go" type="submit">Enviar link para criar nova senha</button></form><p class="center" style="margin-top:14px"><button type="button" class="ghost slim" id="back">Voltar</button></p>',
      "Recuperar senha", "Enviaremos um link para o seu e-mail.");
    $("back").onclick = function () { screenAuth("login"); };
    $("f").onsubmit = async function (ev) {
      ev.preventDefault();
      var email = $("email").value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { $("err").innerHTML = '<div class="banner err" role="alert">Confira o e-mail.</div>'; return; }
      $("go").disabled = true;
      try {
        var r = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/app/" });
        if (r.error) throw r.error;
        plain('<div class="card"><p>Se existir uma conta com <b>' + e(email) + '</b>, enviamos um link para criar uma nova senha. Abra o e-mail (veja também o spam) e clique uma vez no link.</p><button class="full" id="vol" type="button">Voltar para Entrar</button></div>', "Confira seu e-mail");
        $("vol").onclick = function () { screenAuth("login"); };
      } catch (x) { $("go").disabled = false; $("err").innerHTML = '<div class="banner err" role="alert">' + e(friendly(x)) + "</div>"; }
    };
  }
  function screenNewPassword() {
    stopTimer();
    plain('<form class="card" id="f" novalidate><label for="np" style="margin-top:0">Nova senha</label><input id="np" type="password" autocomplete="new-password" maxlength="72"><p class="muted small" style="margin:6px 0 0">Mínimo de 8 caracteres.</p>' +
      '<label for="np2">Repita a nova senha</label><input id="np2" type="password" autocomplete="new-password" maxlength="72"><div id="err"></div><button class="full" id="go" type="submit">Salvar nova senha</button></form>', "Criar nova senha");
    $("f").onsubmit = async function (ev) {
      ev.preventDefault();
      function bad(m) { $("err").innerHTML = '<div class="banner err" role="alert">' + e(m) + "</div>"; }
      var a = $("np").value, b = $("np2").value;
      if (a.length < 8) return bad("A senha precisa ter pelo menos 8 caracteres.");
      if (a !== b) return bad("As duas senhas não são iguais.");
      $("go").disabled = true;
      try {
        var r = await sb.auth.updateUser({ password: a });
        if (r.error) throw r.error;
        recovering = false; toast("Senha alterada!"); profile = null; pro = null; route();
      } catch (x) { $("go").disabled = false; bad(friendly(x)); }
    };
  }

  // ---------- cadastro básico / profissional ----------
  function screenBasicProfile() {
    plain('<form class="card" id="f" novalidate>' +
      '<label for="nome">Nome completo</label><input id="nome" maxlength="100" autocomplete="name">' +
      '<label for="tel">WhatsApp com DDD</label><input id="tel" type="tel" maxlength="20" placeholder="(27) 9 0000-0000">' +
      '<label>Como você vai usar o app?</label><div class="chips"><label><input type="radio" name="role" value="client" checked> Quero contratar</label><label><input type="radio" name="role" value="pro"> Sou profissional</label></div>' +
      '<div id="err"></div><button class="full" id="go" type="submit">Continuar</button></form>', "Complete seu cadastro");
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
    plain('<form class="card" id="f" novalidate>' +
      '<label>O que você faz?</label><div class="chips">' + cats.map(function (x) { return '<label><input type="checkbox" name="cat" value="' + x.id + '"> ' + e(x.name) + "</label>"; }).join("") + "</div>" +
      '<label>Onde você atende?</label><div class="chips">' + regions.map(function (x) { return '<label><input type="checkbox" name="reg" value="' + x.id + '"> ' + e(x.name) + " (" + e(x.city) + ")</label>"; }).join("") + "</div>" +
      '<label for="exp">Anos de experiência</label><input id="exp" type="number" inputmode="numeric" min="0" max="70">' +
      '<label for="bio">Fale um pouco sobre seu trabalho</label><textarea id="bio" maxlength="600" placeholder="Ex.: Eletricista há 8 anos. Instalação de chuveiro, tomadas, quadro de luz."></textarea>' +
          '<label for="doc">Documento com foto (RG ou CNH)</label><input id="doc" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"><p class="muted small">Foto nítida ou PDF, até 5 MB. Só a equipe do Resolvo Já vê este arquivo, para confirmar quem você é. Ele não aparece para clientes.</p>' +
      '<label style="font-weight:500;display:flex;gap:8px;align-items:flex-start;margin-top:16px"><input id="ok" type="checkbox" style="width:auto;margin-top:4px"><span>Li e aceito o <a href="/termo-prestador.html" target="_blank" rel="noopener">Termo do Prestador</a> e os <a href="/termos.html" target="_blank" rel="noopener">Termos de Uso</a>, inclusive a taxa de verificação de R$ 29,90 e a comissão de 10% sobre os serviços feitos pelo app.</span></label>' +
      '<div id="err"></div><button class="full" id="go" type="submit">Enviar para análise</button></form>', "Cadastro de profissional", "Nossa equipe confere seus dados antes de liberar os pedidos. Você só aparece para clientes depois de aprovado.");
    $("f").onsubmit = async function (ev) {
      ev.preventDefault();
      function bad(m) { $("err").innerHTML = '<div class="banner err" role="alert">' + e(m) + "</div>"; }
      var cs = Array.prototype.map.call(document.querySelectorAll('input[name="cat"]:checked'), function (i) { return Number(i.value); });
      var rs = Array.prototype.map.call(document.querySelectorAll('input[name="reg"]:checked'), function (i) { return Number(i.value); });
      var exp = $("exp").value === "" ? null : Number($("exp").value), bio = $("bio").value.trim();
      if (!cs.length) return bad("Escolha pelo menos um serviço.");
      if (!rs.length) return bad("Escolha pelo menos um bairro de atendimento.");
      if (exp !== null && (!(exp >= 0) || exp > 70)) return bad("Confira os anos de experiência.");
      var df = $("doc").files[0], needDoc = !pro || !pro.document_path;
      if (needDoc && !df) return bad("Envie a foto do seu RG ou CNH para a equipe conferir.");
      var dErr = df ? docCheck(df) : "";
      if (dErr) return bad(dErr);
      if (!$("ok").checked) return bad("Marque a aceitação dos Termos para continuar.");
      $("go").disabled = true;
      try {
        var path = df ? await uploadDoc(df) : null;
        if (!pro) {
          var a = await sb.from("pro_profiles").insert({ user_id: user.id, bio: bio || null, years_exp: exp, status: "pending", document_path: path });
          if (a.error) throw a.error;
        } else if (path) {
          var a2 = await sb.from("pro_profiles").update({ document_path: path }).eq("user_id", user.id);
          if (a2.error) throw a2.error;
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

  // ---------- documento do profissional ----------
  function docCheck(f) {
    if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(f.type)) return "Envie uma foto (JPG, PNG) ou um PDF.";
    if (f.size > 5 * 1024 * 1024) return "O arquivo passa de 5 MB. Tire a foto de novo com menos qualidade ou envie um PDF menor.";
    return "";
  }
  async function uploadDoc(f) {
    var ext = f.type === "application/pdf" ? "pdf" : f.type === "image/png" ? "png" : f.type === "image/webp" ? "webp" : "jpg";
    var path = user.id + "/documento-" + Date.now() + "." + ext;
    var r = await sb.storage.from("documentos").upload(path, f, { contentType: f.type, upsert: false });
    if (r.error) throw r.error;
    return path;
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
    if (recovering) return screenNewPassword();
    loading();
    try {
      await loadMe();
      if (!profile) return screenBasicProfile();
      if (profile.role === "admin") return shell('<div class="card"><h2 style="margin-top:0">Conta da equipe</h2><p>Use o painel da equipe: <a href="/equipe/">abrir painel</a>.</p><button class="ghost full" id="out" type="button">Sair</button></div>', "perfil"), ($("out").onclick = signOut);
      if (profile.role === "pro" && (!pro || pro._incomplete)) return screenProSetup();
      var hp = hashParts(), h = hp.path, m;
      if (h === "#/perfil") return screenPerfil();
      if (h === "#/mensagens") return messagesList();
      if ((m = h.match(/^#\/pedido\/([0-9a-f-]{36})$/i))) return profile.role === "pro" ? proRequest(m[1]) : clientRequest(m[1]);
      if (profile.role === "pro") return h === "#/propostas" ? proProposals() : proHome();
      if (h === "#/novo") return clientNew(hp.q);
      if (h === "#/pedidos") return clientList();
      return clientHome();
    } catch (x) {
      shell('<div class="banner err" role="alert">' + e(friendly(x)) + '</div><button class="full" id="re" type="button">Tentar de novo</button>', "home");
      $("re").onclick = route;
    }
  }

  async function signOut() { await sb.auth.signOut(); profile = null; pro = null; user = null; location.hash = ""; route(); }

  // ---------- perfil ----------
  async function screenPerfil() {
    var isPro = profile.role === "pro";
    var mpHtml = isPro && pro && pro.status === "approved" ? await mpConnectHtml() : "";
    shell('<div class="card"><div class="row" style="justify-content:flex-start;gap:14px">' + avatar(profile.name, 0) + '<div><b>' + e(profile.name) + '</b><br><span class="muted small">' + e(user.email || "") + "<br>" + e(profile.phone || "") + "</span></div></div>" +
      '<p style="margin:12px 0 0">' + (isPro ? "Profissional " + (pro && pro.status === "approved" ? '<span class="pill ok">aprovado</span>' : pro && pro.status === "suspended" ? '<span class="pill err">suspenso</span>' : '<span class="pill warn">em análise</span>') : "Cliente") + "</p></div>" +
      mpHtml + installBlock() +
      '<p class="small center muted" style="margin-top:18px"><a href="/termos.html" target="_blank" rel="noopener">Termos</a> · <a href="/privacidade.html" target="_blank" rel="noopener">Privacidade</a></p>' +
      '<button class="danger full" id="out" type="button">Sair da conta</button>', "perfil", topbar("Perfil"));
    $("out").onclick = signOut; bindInstall(); mpConnectBind();
  }

  // ---------- chat ----------
  function chatBlock(requestId) {
    return '<h2>Conversa</h2><div class="card"><div class="chat" id="chat" aria-live="polite"></div><form id="cf" class="cform"><input id="cm" maxlength="500" placeholder="Escreva uma mensagem" aria-label="Mensagem"><button type="submit" aria-label="Enviar">' + icon("send", 20) + "</button></form></div>";
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

  // ---------- acompanhamento ----------
  function stepsBlock(status) {
    if (status === "cancelled" || status === "disputed") return "";
    var labels = ["Pedido enviado", "Propostas dos profissionais", "Contratação e pagamento", "Serviço em andamento", "Concluído"];
    var now = { open: 1, awaiting_payment: 2, hired: 3, completed: 5 }[status];
    if (now == null) return "";
    return "<h2>Acompanhamento</h2><div class=\"card\"><ol class=\"steps\">" + labels.map(function (l, i) {
      var cls = i < now ? "done" : i === now ? "now" : "";
      return '<li class="' + cls + '"><span class="sdot">' + (i < now ? icon("check", 14) : "") + "</span><span>" + e(l) + "</span></li>";
    }).join("") + "</ol></div>";
  }

  // ---------- mensagens ----------
  async function messagesList() {
    var items = [];
    if (profile.role === "pro") {
      var m = await sb.from("proposals").select("request_id,status,service_requests(id,title,status,categories(name))").eq("pro_id", user.id);
      (m.data || []).forEach(function (p) {
        var s = p.service_requests;
        if (!s || p.status === "rejected" || p.status === "withdrawn") return;
        if (["open", "awaiting_payment", "hired"].indexOf(s.status) < 0) return;
        items.push({ id: s.id, title: s.title, cat: s.categories ? s.categories.name : "", status: s.status });
      });
    } else {
      var r = await sb.from("service_requests").select("id,title,status,categories(name)").in("status", ["open", "awaiting_payment", "hired"]).order("created_at", { ascending: false });
      var list = r.data || [], cnt = {};
      if (list.length) {
        var pr = await sb.from("proposals").select("request_id,status").in("request_id", list.map(function (x) { return x.id; }));
        (pr.data || []).forEach(function (p) { if (p.status !== "withdrawn") cnt[p.request_id] = (cnt[p.request_id] || 0) + 1; });
      }
      list.forEach(function (x) { if (x.status !== "open" || cnt[x.id]) items.push({ id: x.id, title: x.title, cat: x.categories ? x.categories.name : "", status: x.status }); });
    }
    shell(items.length ? '<p class="muted small">Toque em um pedido para abrir a conversa com a outra pessoa.</p>' + items.map(function (x) {
      return '<a class="card reqcard" href="#/pedido/' + x.id + '"><span class="ico">' + icon("chat", 22) + '</span><div class="t"><b>' + e(x.title) + '</b><span class="muted small">' + e(x.cat) + "</span><span style=\"display:block;margin-top:6px\">" + pill(STATUS, x.status) + "</span></div></a>";
    }).join("") : '<div class="empty">Nenhuma conversa ainda.<br>Elas aparecem aqui quando houver propostas em um pedido.</div>', "msg", topbar("Mensagens"));
  }

  // ---------- cliente ----------
  function reqCard(x, n) {
    var ci = catIcon(x.categories ? x.categories.name : "");
    return '<a class="card reqcard" href="#/pedido/' + x.id + '"><span class="ico">' + icon(ci, 22) + '</span><div class="t"><b>' + e(x.title) + '</b><span class="muted small">' + e(x.categories ? x.categories.name : "") + " · " + dt(x.created_at) + (x.status === "open" ? " · " + (n ? n + " proposta" + (n > 1 ? "s" : "") : "aguardando propostas") : "") + "</span><span style=\"display:block;margin-top:6px\">" + pill(STATUS, x.status) + "</span></div></a>";
  }
  async function clientRequests() {
    var r = await sb.from("service_requests").select("id,title,status,created_at,categories(name)").order("created_at", { ascending: false });
    if (r.error) throw r.error;
    var list = r.data || [], counts = {};
    if (list.length) {
      var pr = await sb.from("proposals").select("request_id,status").in("request_id", list.map(function (x) { return x.id; }));
      (pr.data || []).forEach(function (p) { if (p.status === "sent") counts[p.request_id] = (counts[p.request_id] || 0) + 1; });
    }
    return { list: list, counts: counts };
  }

  async function clientHome() {
    var d = await clientRequests(), list = d.list;
    var c = await sb.from("categories").select("id,name").eq("active", true).order("name");
    var quick = [["Chuveiro queimou", "eletric"], ["Torneira pingando", "encan"], ["Montar guarda-roupa", "montad"]];
    var first = profile.name.split(" ")[0];
    var head = '<div class="hero"><div class="hrow"><div><small>Serviço em</small><span class="loc">' + icon("pin", 18) + 'Serra, ES</span></div><span class="hello">Olá, ' + e(first) + "</span></div>" +
      "<h1>O que você precisa resolver hoje?</h1>" +
      '<form class="search" id="sf" role="search">' + icon("search", 20) + '<input id="sq" maxlength="80" placeholder="Ex.: chuveiro não esquenta" aria-label="Descreva o serviço"><button type="submit" class="slim">Buscar</button></form>' +
      '<div class="chips-h">' + quick.map(function (q) { return '<a href="#/novo?t=' + encodeURIComponent(q[0]) + "&c=" + q[1] + '">' + e(q[0]) + "</a>"; }).join("") + "</div>" +
      '<a class="btn sun full" href="#/novo">' + icon("plus", 20) + "Pedir orçamento</a></div>";
    var cs = c.data || [];
    var body = '<div class="section"><h2>Meus pedidos</h2>' + (list.length > 3 ? '<a href="#/pedidos">Ver todos</a>' : "") + "</div>" +
      (list.length ? list.slice(0, 3).map(function (x) { return reqCard(x, d.counts[x.id] || 0); }).join("") : '<div class="empty">Você ainda não fez nenhum pedido.<br>Toque em <b>Pedir orçamento</b> para começar.</div>') +
      (cs.length ? '<div class="section"><h2>Categorias</h2></div><div class="catgrid">' + cs.map(function (x) {
        return '<a class="cat" href="#/novo?cid=' + x.id + '"><span class="ico">' + icon(catIcon(x.name), 24) + "</span>" + e(x.name) + "</a>";
      }).join("") + "</div>" : "");
    shell(body, "home", head);
    $("sf").onsubmit = function (ev) { ev.preventDefault(); var q = $("sq").value.trim(); go("#/novo" + (q ? "?t=" + encodeURIComponent(q) : "")); };
  }

  async function clientList() {
    var d = await clientRequests();
    shell(d.list.length ? d.list.map(function (x) { return reqCard(x, d.counts[x.id] || 0); }).join("") : '<div class="empty">Você ainda não fez nenhum pedido.</div><a class="btn full" href="#/novo">Pedir orçamento</a>', "pedidos", topbar("Meus pedidos"));
  }

  async function clientNew(params) {
    var c = await sb.from("categories").select("id,name").eq("active", true).order("name");
    var rg = await sb.from("regions").select("id,city,name").eq("active", true).order("city").order("name");
    cats = c.data || []; regions = rg.data || [];
    var preCat = "";
    if (params && params.get("cid")) preCat = params.get("cid");
    else if (params && params.get("c")) { var k = cats.filter(function (x) { return x.name.toLowerCase().indexOf(params.get("c").toLowerCase()) === 0; })[0]; if (k) preCat = String(k.id); }
    var preTit = params && params.get("t") ? params.get("t").slice(0, 80) : "";
    shell('<p class="muted">Descreva o que você precisa. Profissionais da sua região enviam propostas.</p>' +
      '<form class="card" id="f" novalidate>' +
      '<label for="cat" style="margin-top:0">Tipo de serviço</label><select id="cat"><option value="">Escolha…</option>' + cats.map(function (x) { return '<option value="' + x.id + '">' + e(x.name) + "</option>"; }).join("") + "</select>" +
      '<label for="tit">Título curto</label><input id="tit" maxlength="80" placeholder="Ex.: Trocar chuveiro elétrico">' +
      '<label for="des">Descreva o serviço</label><textarea id="des" maxlength="1000" placeholder="O que precisa ser feito? Tem alguma urgência?"></textarea>' +
      '<label for="reg">Bairro</label><select id="reg"><option value="">Escolha…</option>' + regions.map(function (x) { return '<option value="' + x.id + '">' + e(x.name) + " — " + e(x.city) + "</option>"; }).join("") + "</select>" +
      '<p class="muted small" style="margin:6px 0 0">Por enquanto atendemos só estes bairros do piloto. O endereço completo só é liberado ao profissional contratado.</p>' +
      '<label for="rua">Rua</label><input id="rua" maxlength="120" autocomplete="address-line1">' +
      '<div class="row" style="align-items:flex-start;gap:10px"><div style="flex:1"><label for="num">Número</label><input id="num" maxlength="12"></div><div style="flex:2"><label for="comp">Complemento</label><input id="comp" maxlength="60"></div></div>' +
      '<label for="dat">Data desejada (opcional)</label><input id="dat" type="date">' +
      '<label for="slot">Horário</label><select id="slot"><option value="flexivel">Flexível</option><option value="manha">Manhã</option><option value="tarde">Tarde</option><option value="noite">Noite</option></select>' +
      '<div id="err"></div><button class="full" id="go" type="submit">Publicar pedido</button></form>', "home", topbar("Novo pedido", "#/"));
    $("dat").min = new Date().toISOString().slice(0, 10);
    if (preCat) $("cat").value = preCat;
    if (preTit) $("tit").value = preTit;
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
    if (!r.data) return shell('<div class="empty">Pedido não encontrado.</div><a class="btn full" href="#/pedidos">Voltar</a>', "pedidos", topbar("Pedido", "#/pedidos"));
    var q = r.data;
    var pr = await sb.from("proposals").select("*").eq("request_id", id).order("amount_cents");
    var props = pr.data || [], names = {};
    if (props.length) {
      var pp = await sb.from("pro_public").select("id,name,bio,years_exp,rating_avg,rating_count").in("id", props.map(function (x) { return x.pro_id; }));
      (pp.data || []).forEach(function (x) { names[x.id] = x; });
    }
    var html = "<h1>" + e(q.title) + '</h1><div class="row"><span class="muted small">' + e(q.categories ? q.categories.name : "") + " · " + dt(q.created_at) + "</span>" + pill(STATUS, q.status) + "</div>" +
      '<div class="card"><p style="white-space:pre-wrap;margin:0">' + e(q.description) + "</p>" +
      (q.desired_date || q.desired_slot ? '<p class="muted small" style="margin:10px 0 0">Preferência: ' + (q.desired_date ? new Date(q.desired_date + "T12:00:00").toLocaleDateString("pt-BR") + " · " : "") + e(SLOT[q.desired_slot] || "") + "</p>" : "") + "</div>";
    html += stepsBlock(q.status);
    var accepted = props.filter(function (x) { return x.status === "accepted"; })[0], payMode = "";
    if (q.status === "awaiting_payment" && accepted) {
      var cn = await sb.rpc("request_pro_connected", { p_request: id });
      if (cn.data === true) { html += payHtml(accepted.amount_cents); payMode = "pay"; }
    }
    if (q.status === "awaiting_payment" && !payMode) html += '<div class="banner">Você escolheu uma proposta. O pagamento seguro dentro do app ainda está sendo liberado: a equipe do Resolvo Já vai falar com você no WhatsApp para combinar os próximos passos.</div>';
    if (q.status === "hired") {
      var hp0 = await sb.from("payments").select("provider,method,status").eq("request_id", id).maybeSingle();
      if (hp0.data && hp0.data.provider === "mercadopago") { html += doneHtml(hp0.data); payMode = "done"; }
    }
    if (q.status === "open" || q.status === "awaiting_payment" || q.status === "hired" || q.status === "completed") {
      html += "<h2>Propostas" + (props.length ? " (" + props.length + ")" : "") + "</h2>";
      html += props.length ? props.map(function (p, i) {
        var n = names[p.pro_id] || {};
        return '<div class="card prop"><div class="who">' + avatar(n.name || "P", i) + '<div class="t"><b>' + e(n.name || "Profissional") + '</b><span class="muted small">' + (n.rating_count ? '<span class="star">' + icon("star", 14) + "</span> " + Number(n.rating_avg).toFixed(1) + " (" + n.rating_count + ") · " : "Novo no Resolvo Já · ") + (n.years_exp != null ? n.years_exp + " anos de experiência" : "") + '</span></div><span class="price">' + brl(p.amount_cents) + "</span></div>" +
          '<p style="margin:10px 0 0">' + pill(PSTATUS, p.status) + "</p>" +
          (p.eta_text ? '<p style="margin:8px 0 0"><b>Prazo:</b> ' + e(p.eta_text) + "</p>" : "") + (p.message ? '<p style="margin:6px 0 0;white-space:pre-wrap">' + e(p.message) + "</p>" : "") +
          (n.bio ? '<p class="muted small" style="margin:6px 0 0">' + e(n.bio) + "</p>" : "") +
          (q.status === "open" && p.status === "sent" ? '<button class="full" data-acc="' + p.id + '" type="button">Aceitar esta proposta</button>' : "") + "</div>";
      }).join("") : '<div class="empty">Ainda não chegaram propostas. Avisaremos quando chegar a primeira — volte aqui em alguns minutos.</div>';
    }
    if ((q.status === "open" && props.length) || q.status === "awaiting_payment" || q.status === "hired") html += chatBlock(id);
    if (q.status === "open" || q.status === "awaiting_payment") html += '<button class="danger full" id="can" type="button">Cancelar pedido</button>';
    if (accepted && q.status !== "cancelled") html += reportHtml();
    shell(html, "pedidos", topbar("Pedido", "#/pedidos"));
    if (accepted) reportBind(id, accepted.pro_id);
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
    if (payMode === "pay") payBind(id, accepted.amount_cents);
    if (payMode === "done") doneBind(id);
    if ($("chat")) chatBind(id);
    if (q.status === "awaiting_payment" || q.status === "hired") {
      var t0 = timer; if (t0) clearInterval(t0);
      timer = setInterval(async function () {
        if ($("chat")) chatLoad(id);
        var st = await sb.from("service_requests").select("status").eq("id", id).maybeSingle();
        if (st.data && st.data.status !== q.status) route();
      }, 6000);
    }
  }

  // ---------- pagamento (Mercado Pago) ----------
  async function api(path, body) {
    var ses = await sb.auth.getSession();
    var tk = ses.data && ses.data.session ? ses.data.session.access_token : "";
    var res, data = {};
    try {
      res = await fetch(path, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + tk }, body: JSON.stringify(body || {}) });
      data = await res.json().catch(function () { return {}; });
    } catch (x) { return { ok: false, error: "Sem conexão. Confira a internet e tente de novo." }; }
    if (!res.ok && !data.error) data.error = "Não foi possível concluir agora. Tente de novo.";
    if (!res.ok) data.ok = false;
    return data;
  }
  var mpSdk = null;
  function loadMpSdk() {
    if (window.MercadoPago) return Promise.resolve();
    if (mpSdk) return mpSdk;
    mpSdk = new Promise(function (ok, bad) {
      var s = document.createElement("script"); s.src = "https://sdk.mercadopago.com/js/v2"; s.onload = ok;
      s.onerror = function () { mpSdk = null; bad(new Error("Não foi possível carregar o pagamento. Confira a internet.")); };
      document.head.appendChild(s);
    });
    return mpSdk;
  }
  // Script de segurança do Mercado Pago: gera o Device ID (window.MP_DEVICE_SESSION_ID) usado pelo antifraude.
  var mpSec = null;
  function loadMpSecurity() {
    if (window.MP_DEVICE_SESSION_ID) return Promise.resolve();
    if (mpSec) return mpSec;
    mpSec = new Promise(function (ok) {
      var s = document.createElement("script"); s.src = "https://www.mercadopago.com/v2/security.js"; s.setAttribute("view", "checkout");
      s.onload = function () { setTimeout(ok, 600); }; s.onerror = function () { ok(); };
      document.head.appendChild(s);
    });
    return mpSec;
  }
  function payBox(msg, cls) { var b = $("payerr"); if (b) b.innerHTML = msg ? '<div class="banner ' + (cls || "err") + '" role="alert">' + e(msg) + "</div>" : ""; }

  // Tela de pagamento do cliente (pedido em "awaiting_payment" com o profissional já conectado).
  function payHtml(amount) {
    return '<h2>Pagamento</h2><div class="card" id="paycard"><div class="row"><span>Valor do serviço</span><span class="price">' + brl(amount) + '</span></div>' +
      '<p class="muted small" style="margin:8px 0 12px">Pagamento seguro pelo Mercado Pago. O valor só é repassado ao profissional depois que você confirmar o serviço.</p><p class="muted small" style="margin:0 0 12px"><b>Para pagar com cartão, use um cartão no seu nome.</b> Cartão de outra pessoa pode ser recusado por segurança. Se for o caso, use o Pix.</p>' +
      '<div id="payerr"></div><div class="chips" id="pm"><button type="button" class="full" id="pix">Pagar com Pix</button><button type="button" class="ghost full" id="crd">Pagar com cartão</button></div><div id="paybody"></div></div>';
  }
  function pixView(pix) {
    var img = pix.qr_base64 ? '<img alt="QR Code Pix" style="width:200px;height:200px;display:block;margin:12px auto" src="data:image/png;base64,' + e(pix.qr_base64) + '">' : "";
    $("paybody").innerHTML = img + '<p class="small center muted" style="margin:0 0 8px">Abra o app do seu banco, escolha Pix e leia o QR Code, ou use o código abaixo.</p>' +
      '<input id="pixcode" readonly value="' + e(pix.code || "") + '" aria-label="Código Pix copia e cola"><button type="button" class="full" id="cp">Copiar código Pix</button>' +
      '<p class="small center muted" style="margin:10px 0 0">Esta tela atualiza sozinha assim que o pagamento for confirmado.' + (pix.expires_at ? " O código vale até " + hm(pix.expires_at) + "." : "") + "</p>";
    $("cp").onclick = function () {
      var v = $("pixcode").value;
      (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(v) : Promise.reject()).then(function () { toast("Código copiado!"); }, function () { $("pixcode").select(); toast("Selecione e copie o código."); });
    };
  }
  async function startPix(id) {
    payBox(""); $("pix").disabled = true; $("paybody").innerHTML = '<p class="muted small center">Gerando o Pix…</p>';
    var r = await api("/api/mp/pay", { request_id: id, method: "pix" });
    $("pix").disabled = false;
    if (!r.ok || !r.pix || !r.pix.code) { $("paybody").innerHTML = ""; return payBox(r.error || "Não foi possível gerar o Pix agora."); }
    pixView(r.pix);
  }
  async function startCard(id, amount) {
    payBox(""); $("paybody").innerHTML = '<p class="muted small center">Carregando o formulário do cartão…</p>';
    try {
      var cfg = await fetch("/api/mp/config").then(function (x) { return x.json(); });
      if (!cfg.public_key) throw new Error("Pagamento por cartão ainda não está disponível.");
      await loadMpSdk();
      await loadMpSecurity();
      var mp = new window.MercadoPago(cfg.public_key, { locale: "pt-BR" });
      $("paybody").innerHTML = '<div id="cardbrick"></div>';
      await mp.bricks().create("cardPayment", "cardbrick", {
        initialization: { amount: amount / 100, payer: { email: user.email || "" } },
        customization: { visual: { hidePaymentButton: false }, paymentMethods: { maxInstallments: 1 } },
        callbacks: {
          onReady: function () {},
          onError: function () { payBox("Confira os dados do cartão e tente de novo."); },
          onSubmit: function (d) {
            payBox("");
            return api("/api/mp/pay", { request_id: id, method: "card", token: d.token, installments: d.installments, payment_method_id: d.payment_method_id, issuer_id: d.issuer_id, device_id: window.MP_DEVICE_SESSION_ID || null, identification: d.payer && d.payer.identification }).then(function (r) {
              if (!r.ok) { payBox(r.error || "Pagamento não aprovado."); throw new Error("recusado"); }
              toast("Pagamento reservado no cartão!"); route();
            });
          }
        }
      });
    } catch (x) { $("paybody").innerHTML = ""; payBox(friendly(x)); }
  }
  async function payBind(id, amount) {
    var pm = await sb.from("payments").select("status,method,pix_code,pix_qr,expires_at").eq("request_id", id).maybeSingle();
    var p = pm.data;
    if (p && p.status === "pending" && p.method === "pix" && p.pix_code && (!p.expires_at || Date.parse(p.expires_at) > Date.now())) pixView({ code: p.pix_code, qr_base64: p.pix_qr, expires_at: p.expires_at });
    $("pix").onclick = function () { startPix(id); };
    $("crd").onclick = function () { startCard(id, amount); };
    // O cartão aparece sempre; some só se MP_CARTAO_ATIVO=0 no Cloudflare.
    fetch("/api/mp/config").then(function (x) { return x.json(); }).then(function (c) { if (c && c.card_enabled === false && $("crd")) $("crd").hidden = true; }, function () {});
  }
  function doneHtml(pay) {
    var how = pay && pay.method === "card" ? "O valor está reservado no seu cartão e só será cobrado quando você confirmar o serviço (ou automaticamente em até 4 dias)." : "Pagamento por Pix confirmado.";
    return '<h2>Pagamento</h2><div class="card"><p style="margin:0">' + e(how) + '</p><p class="muted small" style="margin:8px 0 0">Quando o serviço terminar, confirme abaixo. Se algo deu errado, abra um problema antes de confirmar.</p>' +
      '<div id="payerr"></div><button class="full" id="conf" type="button">Confirmar serviço concluído</button><button class="ghost full" id="prob" type="button">Tive um problema</button></div>';
  }
  function doneBind(id) {
    $("conf").onclick = async function () {
      if (!confirm("Confirmar que o serviço foi concluído? O pagamento será liberado ao profissional.")) return;
      $("conf").disabled = true;
      var r = await api("/api/mp/confirm", { request_id: id });
      if (!r.ok) { $("conf").disabled = false; return payBox(r.error || "Não foi possível confirmar agora."); }
      toast("Serviço confirmado. Obrigado!"); route();
    };
    $("prob").onclick = async function () {
      var why = prompt("Conte o que aconteceu (a equipe do Resolvo Já vai analisar):");
      if (!why || why.trim().length < 10) { if (why !== null) toast("Descreva melhor o problema (mínimo de 10 letras)."); return; }
      var x = await sb.from("disputes").insert({ request_id: id, opened_by: user.id, reason: why.trim().slice(0, 1000) });
      if (x.error) toast(friendly(x.error)); else { toast("Problema enviado. A equipe vai entrar em contato."); route(); }
    };
  }

  // Denunciar: abre um registro para a equipe analisar (aparece na aba Denúncias do painel).
  function reportHtml() { return '<p class="center small" style="margin-top:18px"><button class="ghost" id="rep" type="button">Denunciar um problema neste pedido</button></p>'; }
  function reportBind(requestId, targetId) {
    var b = $("rep"); if (!b) return;
    b.onclick = async function () {
      var why = prompt("Conte o que aconteceu. A equipe do Resolvo Já vai analisar e entrar em contato:");
      if (why === null) return;
      why = why.trim();
      if (why.length < 10) { toast("Descreva melhor (mínimo de 10 letras)."); return; }
      b.disabled = true;
      var x = await sb.from("reports").insert({ reporter_id: user.id, target_user_id: targetId || null, request_id: requestId, reason: why.slice(0, 1000) });
      b.disabled = false;
      if (x.error) toast(/limite/i.test(x.error.message) ? x.error.message : friendly(x.error)); else toast("Denúncia enviada. Obrigado por avisar.");
    };
  }

  // Cartão "Conectar Mercado Pago" do profissional.
  async function mpConnectHtml() {
    var c = await sb.rpc("my_mp_connected");
    if (c.error) return "";
    if (c.data) return '<div class="banner ok">Mercado Pago conectado. Você recebe os pagamentos direto na sua conta.</div>';
    return '<div class="card"><b>Conecte sua conta do Mercado Pago</b><p class="muted small" style="margin:6px 0 10px">É por ela que você recebe: o cliente paga pelo app e o valor (menos 10% de comissão) cai na sua conta. Sem a conexão, os clientes não conseguem pagar pelo app.</p><div id="mperr"></div><button class="full" id="mpc" type="button">Conectar Mercado Pago</button></div>';
  }
  function mpConnectBind() {
    if (!$("mpc")) return;
    $("mpc").onclick = async function () {
      $("mpc").disabled = true;
      var r = await api("/api/mp/connect", {});
      if (!r.url) { $("mpc").disabled = false; $("mperr").innerHTML = '<div class="banner err" role="alert">' + e(r.error || "Não foi possível conectar agora.") + "</div>"; return; }
      location.href = r.url;
    };
  }

  // ---------- profissional ----------
  function proHead(title, sub) {
    return '<div class="hero"><div class="hrow"><div><small>Olá, ' + e(profile.name.split(" ")[0]) + '</small><span class="loc">' + icon("pin", 18) + "Sua região</span></div></div><h1>" + e(title) + "</h1>" + (sub ? '<p class="sub">' + e(sub) + "</p>" : "") + "</div>";
  }
  async function proHome() {
    var banner = "";
    if (pro.status === "pending" && !pro.document_path) {
      return shell('<div class="banner">Falta um passo: envie a foto do seu RG ou CNH para a equipe conferir. Sem o documento, seu cadastro não pode ser aprovado.</div>' +
        '<form class="card" id="df"><label for="doc" style="margin-top:0">Documento com foto (RG ou CNH)</label><input id="doc" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"><p class="muted small">Foto nítida ou PDF, até 5 MB. Só a equipe vê este arquivo.</p><div id="derr"></div><button class="full" id="dgo" type="submit">Enviar documento</button></form>', "home", proHead("Início")),
        ($("df").onsubmit = async function (ev) {
          ev.preventDefault();
          var f = $("doc").files[0], m = !f ? "Escolha o arquivo do documento." : docCheck(f);
          if (m) { $("derr").innerHTML = '<div class="banner err" role="alert">' + e(m) + "</div>"; return; }
          $("dgo").disabled = true;
          try {
            var path = await uploadDoc(f);
            var u = await sb.from("pro_profiles").update({ document_path: path }).eq("user_id", user.id);
            if (u.error) throw u.error;
            toast("Documento enviado. Obrigado!"); await loadMe(true); route();
          } catch (x) { $("dgo").disabled = false; $("derr").innerHTML = '<div class="banner err" role="alert">' + e(friendly(x)) + "</div>"; }
        });
    }
    if (pro.status === "pending") banner = '<div class="banner">Seu cadastro está em análise pela equipe. Assim que for aprovado, os pedidos da sua região aparecem aqui.</div>';
    if (pro.status === "suspended") banner = '<div class="banner err">Seu cadastro está suspenso. Fale com o suporte do Resolvo Já.</div>';
    if (pro.status !== "approved") return shell(banner, "home", proHead("Início"));
    var mpHtml = await mpConnectHtml();
    var mine = await sb.from("proposals").select("request_id").eq("pro_id", user.id);
    var proposed = {};
    (mine.data || []).forEach(function (p) { proposed[p.request_id] = true; });
    var r = await sb.from("service_requests").select("id,title,description,desired_date,desired_slot,created_at,categories(name)").eq("status", "open").order("created_at", { ascending: false });
    if (r.error) throw r.error;
    var list = (r.data || []).filter(function (x) { return !proposed[x.id]; });
    var body = list.length ? list.map(function (x) {
      return '<a class="card reqcard" href="#/pedido/' + x.id + '"><span class="ico">' + icon(catIcon(x.categories ? x.categories.name : ""), 22) + '</span><div class="t"><b>' + e(x.title) + '</b><span class="muted small">' + e(x.categories ? x.categories.name : "") + (x.desired_date ? " · para " + new Date(x.desired_date + "T12:00:00").toLocaleDateString("pt-BR") : "") + " · " + dt(x.created_at) + '</span><span class="small" style="display:block;white-space:normal;margin-top:4px">' + e(x.description.slice(0, 100)) + (x.description.length > 100 ? "…" : "") + "</span></div></a>";
    }).join("") : '<div class="empty">Nenhum pedido novo na sua região agora. Volte daqui a pouco.</div>';
    shell(mpHtml + body, "home", proHead("Pedidos abertos", "Envie sua proposta e conquiste o cliente."));
    mpConnectBind();
  }

  async function proProposals() {
    var mine = await sb.from("proposals").select("*,service_requests(id,title,status,categories(name))").eq("pro_id", user.id).order("created_at", { ascending: false });
    var myList = mine.data || [];
    shell(myList.length ? myList.map(function (p) {
      var s = p.service_requests || {};
      return '<a class="card reqcard" href="#/pedido/' + p.request_id + '"><span class="ico">' + icon(catIcon(s.categories ? s.categories.name : ""), 22) + '</span><div class="t"><b>' + e(s.title || "Pedido") + '</b><span class="muted small">' + brl(p.amount_cents) + " · " + e(s.categories ? s.categories.name : "") + " · " + dt(p.created_at) + "</span><span style=\"display:block;margin-top:6px\">" + pill(PSTATUS, p.status) + "</span></div></a>";
    }).join("") : '<div class="empty">Você ainda não enviou propostas.</div>', "propostas", topbar("Minhas propostas"));
  }

  async function proRequest(id) {
    var r = await sb.from("service_requests").select("*,categories(name)").eq("id", id).maybeSingle();
    if (r.error) throw r.error;
    if (!r.data) return shell('<div class="empty">Pedido não encontrado ou já não está disponível.</div><a class="btn full" href="#/">Voltar</a>', "home", topbar("Pedido", "#/"));
    var q = r.data;
    var m = await sb.from("proposals").select("*").eq("request_id", id).eq("pro_id", user.id).maybeSingle();
    var mine = m.data || null;
    var html = "<h1>" + e(q.title) + '</h1><div class="row"><span class="muted small">' + e(q.categories ? q.categories.name : "") + " · " + dt(q.created_at) + "</span>" + pill(STATUS, q.status) + "</div>" +
      '<div class="card"><p style="white-space:pre-wrap;margin:0">' + e(q.description) + "</p>" +
      (q.desired_date || q.desired_slot ? '<p class="muted small" style="margin:10px 0 0">Preferência: ' + (q.desired_date ? new Date(q.desired_date + "T12:00:00").toLocaleDateString("pt-BR") + " · " : "") + e(SLOT[q.desired_slot] || "") + "</p>" : "") +
      '<p class="muted small" style="margin:8px 0 0">O endereço completo e o contato do cliente são liberados depois da contratação e do pagamento.</p></div>';
    if (mine) {
      html += "<h2>Sua proposta</h2><div class=\"card\"><div class=\"row\"><span class=\"price\">" + brl(mine.amount_cents) + "</span>" + pill(PSTATUS, mine.status) + "</div>" +
        (mine.eta_text ? "<p style=\"margin:8px 0 0\"><b>Prazo:</b> " + e(mine.eta_text) + "</p>" : "") + (mine.message ? '<p style="margin:6px 0 0;white-space:pre-wrap">' + e(mine.message) + "</p>" : "") +
        '<p class="muted small" style="margin:8px 0 0">Você recebe ' + brl(Math.round(mine.amount_cents * 0.9)) + " (valor menos a comissão de 10%).</p>" +
        (mine.status === "sent" && q.status === "open" ? '<button class="danger full" id="wd" type="button">Retirar proposta</button>' : "") + "</div>";
      if (mine.status === "accepted") html += '<div class="banner ok">Você foi escolhido! Assim que o cliente pagar, você será avisado e o valor cai direto na sua conta do Mercado Pago (menos a comissão de 10%). Se ainda não conectou o Mercado Pago, faça isso na tela Início.</div>';
      if (mine.status !== "rejected" && mine.status !== "withdrawn" && (q.status === "open" || q.status === "awaiting_payment" || q.status === "hired")) html += chatBlock(id);
    } else if (q.status === "open") {
      html += '<h2>Enviar proposta</h2><form class="card" id="f" novalidate>' +
        '<label for="val" style="margin-top:0">Valor do serviço (R$)</label><input id="val" inputmode="decimal" placeholder="Ex.: 150,00">' +
        '<p class="muted small" id="liq" style="margin:6px 0 0"></p>' +
        '<label for="eta">Quando você pode fazer?</label><input id="eta" maxlength="80" placeholder="Ex.: Amanhã à tarde">' +
        '<label for="msg">Mensagem (opcional)</label><textarea id="msg" maxlength="500" placeholder="Explique o que está incluso no valor."></textarea>' +
        '<div id="err"></div><button class="full" id="go" type="submit">Enviar proposta</button></form>';
    } else html += '<div class="empty">Este pedido não está mais aberto.</div>';
    if (mine && mine.status === "accepted") html += reportHtml();
    shell(html, mine ? "propostas" : "home", topbar("Pedido", mine ? "#/propostas" : "#/"));
    if (mine && mine.status === "accepted") reportBind(id, q.client_id);
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
    // Link do e-mail vencido ou já usado: avisa em português e limpa o endereço.
    recovering = /[#&]type=recovery/.test(location.hash);
    var linkErr = /[#&]error_code=/.test(location.hash) ? (/otp_expired/.test(location.hash) ? "expired" : "other") : "";
    if (linkErr) { try { history.replaceState(null, "", location.pathname); } catch (x) {} }
    if (recovering) { setTimeout(function () { try { history.replaceState(null, "", location.pathname); } catch (x) {} }, 1500); }
    var mpRes = new URLSearchParams(location.search).get("mp");
    if (mpRes) { try { history.replaceState(null, "", location.pathname + location.hash); } catch (x) {} }
    if (!CFG.url || !CFG.anonKey || !window.supabase) { sb = null; return route(); }
    sb = window.supabase.createClient(CFG.url, CFG.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
    var started = false;
    sb.auth.onAuthStateChange(function (ev, session) {
      if (ev === "PASSWORD_RECOVERY") { recovering = true; user = session ? session.user : user; if (started) screenNewPassword(); return; }
      if (!started) return;
      var u = session ? session.user : null;
      if ((u && u.id) !== (user && user.id)) { user = u; profile = null; pro = null; setTimeout(route, 0); }
    });
    sb.auth.getSession().then(function (r) {
      var u = r.data && r.data.session ? r.data.session.user : null;
      user = u; started = true;
      if (recovering && u) screenNewPassword(); else { recovering = false; route(); }
      if (mpRes) toast(mpRes === "ok" ? "Mercado Pago conectado com sucesso!" : "Não foi possível conectar o Mercado Pago. Tente de novo.");
      if (linkErr) toast(linkErr === "expired" ? "Esse link venceu ou já foi usado. Tente entrar com seu e-mail e senha." : "Não foi possível usar esse link. Tente entrar com seu e-mail e senha.");
    });
  }
  init();
})();
