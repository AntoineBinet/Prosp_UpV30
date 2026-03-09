// KPI page (v5.0)
// Generates a validation Excel from a checklist.

(function () {
  const DEFAULT_ITEMS = [
    { group: 'Prospection', label: 'Contacté (mail / tel / LinkedIn)' },
    { group: 'Prospection', label: 'Relance effectuée' },
    { group: 'Prospection', label: 'Validation / qualification effectuée' },
    { group: 'RDV', label: 'RDV pris' },
    { group: 'Client', label: 'Client vu (visio / onsite)' },
    { group: 'Push', label: 'Push envoyé' },
    { group: 'Candidats', label: 'Candidat rencontré' },
    { group: 'Candidats', label: 'Candidat ajouté au pipeline' },
    { group: 'Candidats', label: 'Candidat sourcé (identifié)' },
  ];

  const $ = (id) => document.getElementById(id);

  const state = DEFAULT_ITEMS.map((it) => ({
    group: it.group,
    label: it.label,
    checked: false,
    note: '',
  }));

  function groupBy(items) {
    const map = {};
    for (const it of items) {
      if (!map[it.group]) map[it.group] = [];
      map[it.group].push(it);
    }
    return map;
  }

  function render() {
    const root = $('kpiChecklist');
    if (!root) return;
    root.innerHTML = '';

    const groups = groupBy(state);
    for (const g of Object.keys(groups)) {
      const card = document.createElement('div');
      card.className = 'card';
      card.style.padding = '14px';

      const title = document.createElement('div');
      title.style.fontWeight = '700';
      title.style.marginBottom = '10px';
      title.textContent = g;
      card.appendChild(title);

      for (const item of groups[g]) {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.gap = '10px';
        row.style.alignItems = 'flex-start';
        row.style.marginBottom = '10px';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!item.checked;
        cb.addEventListener('change', () => {
          item.checked = cb.checked;
        });

        const col = document.createElement('div');
        col.style.flex = '1';

        const label = document.createElement('div');
        label.textContent = item.label;
        label.style.fontWeight = '600';

        const note = document.createElement('input');
        note.type = 'text';
        note.className = 'input';
        note.placeholder = 'Commentaire (optionnel)';
        note.value = item.note || '';
        note.style.marginTop = '6px';
        note.addEventListener('input', () => {
          item.note = note.value;
        });

        col.appendChild(label);
        col.appendChild(note);

        row.appendChild(cb);
        row.appendChild(col);

        card.appendChild(row);
      }

      root.appendChild(card);
    }
  }

  function selectAll(v) {
    for (const it of state) it.checked = v;
    render();
  }

  function weekPreset() {
    for (const it of state) {
      const k = it.label.toLowerCase();
      it.checked =
        k.includes('contact') ||
        k.includes('relance') ||
        k.includes('validation') ||
        k.includes('rdv') ||
        k.includes('push') ||
        k.includes('candidat');
    }
    render();
  }

  async function exportExcel() {
    const date = ($('kpiDate')?.value || '').trim() || todayISO();
    const title = ($('kpiTitle')?.value || '').trim() || 'Validation KPI';

    const payload = {
      date,
      title,
      items: state.map((it) => ({
        group: it.group,
        label: it.label,
        checked: !!it.checked,
        note: it.note || '',
      })),
    };

    const res = await fetch('/api/kpi/export/xlsx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      alert('Erreur export KPI: ' + (txt || res.status));
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kpi_${date}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function init() {
    const d = $('kpiDate');
    if (d && !d.value) d.value = todayISO();

    $('btnKpiExport')?.addEventListener('click', exportExcel);
    $('btnKpiSelectAll')?.addEventListener('click', () => selectAll(true));
    $('btnKpiSelectNone')?.addEventListener('click', () => selectAll(false));
    $('btnKpiWeek')?.addEventListener('click', weekPreset);

    render();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
