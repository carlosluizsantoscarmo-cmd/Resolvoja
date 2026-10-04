(function () {
  var RJ = window.RJ || {};
  var widgetId = null, token = "";

  // Botão flutuante de WhatsApp
  var num = String(RJ.whatsapp || "").replace(/\D/g, "");
  if (num.length >= 12) {
    var a = document.createElement("a");
    a.href = "https://wa.me/" + num + "?text=" + encodeURIComponent(RJ.whatsappMsg || "");
    a.target = "_blank"; a.rel = "noopener";
    a.setAttribute("aria-label", "Falar com o suporte pelo WhatsApp");
    a.className = "rj-wa";
    a.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg><span>Suporte</span>';
    document.addEventListener("DOMContentLoaded", function () { document.body.appendChild(a); });
  }

  // Turnstile: só liga se houver Site Key e um <div id="cf-turnstile"> na página
  function mount() {
    var box = document.getElementById("cf-turnstile");
    if (!RJ.turnstile || !box) return;
    window.__rjTurnstileReady = function () {
      widgetId = window.turnstile.render(box, {
        sitekey: RJ.turnstile, language: "pt-br",
        callback: function (t) { token = t; },
        "expired-callback": function () { token = ""; },
        "error-callback": function () { token = ""; }
      });
    };
    var s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__rjTurnstileReady";
    s.async = true; s.defer = true;
    document.head.appendChild(s);
  }
  document.addEventListener("DOMContentLoaded", mount);

  RJ.token = function () { return token; };
  RJ.enabled = function () { return !!RJ.turnstile && !!document.getElementById("cf-turnstile"); };
  RJ.reset = function () { token = ""; try { if (widgetId !== null) window.turnstile.reset(widgetId); } catch (e) {} };
  window.RJ = RJ;

  var css = document.createElement("style");
  css.textContent = ".rj-wa{position:fixed;right:16px;bottom:16px;z-index:50;display:inline-flex;align-items:center;gap:8px;padding:12px 16px;border-radius:999px;background:#128C4A;color:#fff;font:600 15px system-ui,sans-serif;text-decoration:none;box-shadow:0 6px 18px rgba(0,0,0,.25)}.rj-wa:hover{filter:brightness(1.08)}.rj-wa:focus-visible{outline:3px solid #FFC400;outline-offset:2px}@media(max-width:480px){.rj-wa span{display:none}.rj-wa{padding:14px}}";
  document.head.appendChild(css);
})();
