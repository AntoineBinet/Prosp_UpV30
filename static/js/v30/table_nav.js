/* ProspUp v30 — Navigation clavier pour tables (J/K/X/E + Enter)
   S'applique aux containers qui exposent data-v30-table-nav sur un <tbody>
   ou un conteneur de lignes. Les lignes sont matchées par [data-id]. */
(function () {
  'use strict';

  function isTyping(el) {
    if (!el) return false;
    var tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (el.isContentEditable) return true;
    if (el.closest && el.closest('[data-v30-palette],[data-v30-help]')) return true;
    return false;
  }

  function tables() {
    return Array.prototype.slice.call(document.querySelectorAll('[data-v30-table-nav]'));
  }

  function rowsFor(t) {
    return Array.prototype.slice.call(t.querySelectorAll('[data-id]'));
  }

  function getActive() {
    var ts = tables();
    for (var i = 0; i < ts.length; i++) {
      var r = ts[i].querySelector('[data-id].is-active');
      if (r) return { table: ts[i], row: r, rows: rowsFor(ts[i]), existed: true };
    }
    // Aucun row actif : on active le premier de la première table visible
    for (var j = 0; j < ts.length; j++) {
      var rows = rowsFor(ts[j]);
      if (rows.length) { rows[0].classList.add('is-active'); return { table: ts[j], row: rows[0], rows: rows, existed: false }; }
    }
    return null;
  }

  function setActive(rows, index) {
    if (!rows.length) return null;
    index = Math.max(0, Math.min(rows.length - 1, index));
    rows.forEach(function (r, i) { r.classList.toggle('is-active', i === index); });
    var row = rows[index];
    if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return row;
  }

  function toggleCheckbox(row) {
    var cb = row.querySelector('[data-v30-row-select], input[type="checkbox"]');
    if (!cb) return;
    cb.checked = !cb.checked;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function openRow(row) {
    var link = row.querySelector('[data-v30-open]') || row.querySelector('a[href*="/v30/"]');
    if (link) {
      if (link.dataset.v30Open) {
        // Déclenche le handler existant plutôt que de naviguer directement
        link.click();
      } else if (link.href) {
        window.location.href = link.href;
      }
    }
  }

  function editRow(row) {
    // Pour l'instant : édit inline = clic sur la zone éditable si présente
    var ce = row.querySelector('[data-v30-edit], [contenteditable="true"]');
    if (ce) {
      ce.focus();
      try {
        var sel = window.getSelection();
        var range = document.createRange();
        range.selectNodeContents(ce);
        sel.removeAllRanges(); sel.addRange(range);
      } catch (_) {}
      return;
    }
    // Pas de zone inline → même comportement que Enter
    openRow(row);
  }

  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (isTyping(e.target)) return;
    if (!tables().length) return;

    var key = e.key.toLowerCase();
    if (key !== 'j' && key !== 'k' && key !== 'x' && key !== 'e' && e.key !== 'Enter') return;

    e.preventDefault();
    var ctx = getActive();
    if (!ctx) return;
    var idx = ctx.rows.indexOf(ctx.row);

    // Si on vient d'activer la 1ere ligne (aucune active avant), J ne doit pas avancer
    if (key === 'j') setActive(ctx.rows, ctx.existed ? idx + 1 : idx);
    else if (key === 'k') setActive(ctx.rows, ctx.existed ? idx - 1 : idx);
    else if (key === 'x') toggleCheckbox(ctx.row);
    else if (key === 'e') editRow(ctx.row);
    else if (e.key === 'Enter') openRow(ctx.row);
  });
})();
