// Mostra, nas páginas de serviço, os profissionais aprovados daquela categoria e cidade (dados públicos do app).
(function () {
  var C = window.RJ_APP, cat = document.body.getAttribute("data-cat"), cid = document.body.getAttribute("data-cidade");
  if (!C || !C.url || !C.anonKey || !cat || !cid || !window.fetch) return;
  function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function norm(t) { return String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim(); }
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
