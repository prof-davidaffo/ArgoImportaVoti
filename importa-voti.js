function argoImportaVoti() {
  'use strict';
  const normalize = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ').trim().toUpperCase();
  const number = s => Number(String(s).trim().replace(',', '.'));
  function parse(text) {
    const seen = new Set();
    const rows = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map((line, i) => {
      const m = line.match(/^(x|\d{1,2}(?:[.,]\d{1,2})?)\s+(.+)$/i);
      if (!m) throw Error('Riga ' + (i + 1) + ': usa VOTO seguito da nome e cognome.');
      const key = normalize(m[2]);
      if (seen.has(key)) throw Error('Nome ripetuto: ' + m[2]);
      seen.add(key);
      const value = /^x$/i.test(m[1]) ? null : number(m[1]);
      if (value !== null && (value < 0 || value > 10)) throw Error('Voto fuori intervallo: ' + m[1]);
      return {name: m[2], key, value};
    });
    if (!rows.length) throw Error('Incolla almeno una riga.');
    return rows;
  }
  function plan(text, students, codes) {
    return parse(text).map(row => {
      const matches = students.filter(r => normalize(r.get('nominativo')) === row.key);
      if (matches.length !== 1) throw Error(row.name + ': ' + (matches.length ? 'nome ambiguo nel registro.' : 'nome non trovato nella tabella attiva.'));
      const record = matches[0];
      if (row.value === null) return {...row, record, skip: true};
      let votes = codes.filter(r => r.get('codTipo') === 'V' && r.get('numValore') != null && String(r.get('numValore')).trim() !== '' && number(r.get('numValore')) === row.value);
      const exact = votes.filter(r => /^\d+(?:[.,]\d+)?$/.test(String(r.get('codCodice')).trim()) && number(r.get('codCodice')) === row.value);
      if (exact.length) votes = exact;
      if (votes.length !== 1) throw Error(row.name + ': voto ' + row.value + (votes.length ? ' associato a più codici Argo.' : ' non disponibile tra i codici Argo.'));
      const pk = votes[0].get('pk');
      if (pk == null || pk === '' || pk === 'vuoto') throw Error('Codice voto non valido per ' + row.name);
      return {...row, record, pk, code: votes[0].get('codCodice'), old: record.get('pkVoto')};
    });
  }
  const Ext = window.Ext;
  try {
    if (!Ext || !Ext.ComponentQuery) throw Error('Apri il registro didUP e la tabella di inserimento voti.');
    const grids = Ext.ComponentQuery.query('valutazioni-scritte-grid, valutazione-collettiva-grid').filter(g => g.isVisible(true));
    if (grids.length !== 1) throw Error('Apri una sola tabella di inserimento voti (modifica prova scritta o valutazione collettiva).');
    if (document.getElementById('argo-importa-voti')) return;
    const grid = grids[0], store = grid.getStore(), vm = grid.lookupViewModel();
    const getCodes = () => {
      let s = vm.getStore('codiciVotazioni');
      if (!s) throw Error('Elenco codici voto non disponibile.');
      if (s.getSource && s.getSource()) s = s.getSource();
      let data = s.getData();
      while (data.getSource && data.getSource()) data = data.getSource();
      return data.getRange();
    };
    const host = document.createElement('div');
    host.id = 'argo-importa-voti';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#0008;display:flex;align-items:center;justify-content:center';
    const root = host.attachShadow({mode:'open'});
    root.innerHTML = `<style>:host{all:initial}*{box-sizing:border-box}section{background:white;color:#17212b;font:16px/1.5 system-ui;padding:24px;border-radius:12px;width:min(760px,94vw);max-height:92vh;overflow:auto}h2{margin:0 0 12px}textarea{width:100%;height:220px;font:15px/1.4 monospace}button{font:inherit;margin:12px 8px 0 0;padding:8px 14px;cursor:pointer}pre{white-space:pre-wrap;font:14px/1.5 monospace}p{margin:8px 0}</style><section role="dialog" aria-modal="true" aria-label="Importa voti"><h2>Importa voti in didUP</h2><p>Una riga per alunno: voto, spazio o tabulazione, cognome e nome. Le x lasciano invariati i voti esistenti.</p><textarea aria-label="Elenco dei voti" placeholder="9,25  Cognome Nome&#10;x  Cognome Nome"></textarea><div><button id="preview">Controlla abbinamenti</button><button id="apply" disabled>Inserisci nei campi</button><button id="close">Chiudi</button></div><pre role="status" aria-live="polite"></pre><p>Al termine controlla la prova e premi «Salva» nel registro.</p></section>`;
    document.body.appendChild(host);
    const area = root.querySelector('textarea'), status = root.querySelector('pre'), apply = root.getElementById('apply');
    let pending = null;
    root.getElementById('close').onclick = () => host.remove();
    area.oninput = () => {pending = null; apply.disabled = true; status.textContent = '';};
    root.getElementById('preview').onclick = () => {
      pending = null; apply.disabled = true;
      try {
        if (!grid.isVisible(true) || grid.destroyed) throw Error('La tabella non è più attiva.');
        pending = plan(area.value, store.getRange(), getCodes());
        status.textContent = pending.map(r => r.name + ' → ' + (r.skip ? 'salta (x)' : r.value.toFixed(2).replace('.', ',') + ' [codice ' + r.code + ']' + (r.old != null && r.old !== '' && r.old !== 'vuoto' && r.old !== r.pk ? ' — SOSTITUISCE il voto presente' : ''))).join('\n') + '\n\n' + pending.filter(r => !r.skip).length + ' voti da inserire.';
        apply.disabled = !pending.some(r => !r.skip);
      } catch (e) {status.textContent = e.message;}
    };
    apply.onclick = () => {
      const changed = [];
      try {
        if (!pending || grid.destroyed || !grid.isVisible(true)) throw Error('Ripeti il controllo degli abbinamenti.');
        const current = plan(area.value, store.getRange(), getCodes());
        if (current.some((r, i) => r.record !== pending[i].record || r.pk !== pending[i].pk || r.old !== pending[i].old)) throw Error('La tabella è cambiata: ripeti il controllo.');
        current.filter(r => !r.skip).forEach(r => {changed.push(r); r.record.set('pkVoto', r.pk);});
        vm.notify();
        if (changed.some(r => r.record.get('pkVoto') !== r.pk)) throw Error('Il registro non ha accettato tutti i voti.');
        status.textContent = changed.length + ' voti inseriti. Le x sono state saltate. Chiudi, controlla la prova e premi Salva nel registro.';
      } catch (e) {
        changed.reverse().forEach(r => r.record.set('pkVoto', r.old));
        vm.notify();
        status.textContent = e.message + (changed.length ? '\nRipristinati i valori precedenti.' : '');
      }
      pending = null; apply.disabled = true;
    };
    area.focus();
  } catch (e) {window.alert(e.message);}
}
argoImportaVoti();
