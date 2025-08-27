// ==UserScript==
// @name         FCResearch • ASIN→Weight Scraper (stops when done)
// @description  Paste one long string of 10-char ASINs; auto-search each, read Weight, and download one CSV — then STOP cleanly.
// @version      1.5.0
// @author       you
// @match        https://fcresearch-na.amazon.com/*
// @match        https://fcresearch-na.aka.amazon.com/*
// @match        https://fcresearch*.amazon.com/*
// @match        https://fcresearch*.aka.amazon.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_download
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ======== SELECTORS ========
  const SEARCH_INPUT_SELECTOR  = '#search';
  const SEARCH_BUTTON_SELECTOR = 'input.a-button-input[type="submit"][aria-labelledby="search-button-announce"]';

  // ======== SETTINGS ========
  const DEBUG = true;
  const SEARCH_DELAY_MS = 700;
  const PAGE_WAIT_TIMEOUT_MS = 20000;
  const BETWEEN_ITEMS_MS = 600;

  // ======== HELPERS ========
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const log = (...a) => { if (DEBUG) console.log('[ASIN→Weight]', ...a); };
  const highlight = (el, color = '#10b981') => {
    if (!el) return;
    const prev = el.style.outline;
    el.style.outline = `3px solid ${color}`;
    setTimeout(() => { el.style.outline = prev; }, 1500);
  };

  // Storage
  const getVal = (k, d) => {
    const v = GM_getValue(k, d);
    return (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
  };
  const setVal = (k, v) => GM_setValue(k, v);
  const delVal = (k) => GM_deleteValue(k);

  // Parse exactly-10-char ASINs
  function parseAsins(blob) {
    if (!blob) return [];
    const tokens = (blob.toUpperCase().match(/[A-Z0-9]{10}/g) || []);
    const seen = new Set(), out = [];
    for (const t of tokens) if (!seen.has(t)) { seen.add(t); out.push(t); }
    return out;
  }

  // Find search UI
  function getSearchElements() {
    let searchInput = document.querySelector(SEARCH_INPUT_SELECTOR) || null;
    let searchButton = document.querySelector(SEARCH_BUTTON_SELECTOR) || null;

    if (!searchInput) {
      searchInput = document.querySelector('input[type="search"]') ||
                    document.querySelector('input[type="text"]') || null;
    }
    if (!searchButton && searchInput?.form) {
      searchButton = Array.from(searchInput.form.querySelectorAll('button, input[type="submit"]'))
        .find(b => /search/i.test(b.textContent || '') || /search/i.test(b.value || '')) || null;
    }
    log('Elements:', { searchInput, searchButton, form: searchInput?.form });
    return { searchInput, searchButton };
  }

  function dispatchInput(el, value) {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    el.focus();
    if (typeof el.select === 'function') el.select();
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function submitSearch(searchInput, searchButton) {
    await sleep(SEARCH_DELAY_MS);
    // Enter
    searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    searchInput.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', code: 'Enter', bubbles: true }));
    await sleep(200);
    // form.requestSubmit
    if (searchInput?.form && typeof searchInput.form.requestSubmit === 'function') {
      log('Submitting via form.requestSubmit');
      searchInput.form.requestSubmit(searchButton || undefined);
      return;
    }
    // form.submit
    if (searchInput?.form) {
      log('Submitting via form.submit()');
      searchInput.form.submit();
      return;
    }
    // click
    if (searchButton) {
      log('Submitting via button.click()');
      searchButton.click();
      return;
    }
    log('No explicit submit mechanism found; relying on Enter.');
  }

  // ======== EXTRACT "Weight" ========
  function extractWeightText() {
    // <tr><th>Weight</th><td>VALUE</td></tr>
    const ths = document.querySelectorAll('th');
    for (const th of ths) {
      const label = (th.textContent || '').trim().toLowerCase();
      if (label === 'weight' || label === 'weight:') {
        const tr = th.closest('tr');
        if (tr) {
          const cells = Array.from(tr.children);
          let afterTh = false;
          for (const cell of cells) {
            if (afterTh && (cell.tagName === 'TD' || cell.tagName === 'TH')) {
              const txt = (cell.textContent || '').trim();
              if (txt) return txt;
            }
            if (cell === th) afterTh = true;
          }
        }
        const sib = th.nextElementSibling;
        if (sib) {
          const t = (sib.textContent || '').trim();
          if (t) return t;
        }
      }
    }
    // Backup: first cell = Weight
    const rows = document.querySelectorAll('tr');
    for (const tr of rows) {
      const cells = Array.from(tr.querySelectorAll('th,td'));
      if (!cells.length) continue;
      if ((cells[0].textContent || '').trim().toLowerCase().replace(':','') === 'weight' && cells.length > 1) {
        const t = (cells[1].textContent || '').trim();
        if (t) return t;
      }
    }
    // Last resort
    const candidates = Array.from(document.querySelectorAll('td, th, div, span, dt, dd, label, p, li, strong'));
    const weightish = candidates.find(el => /\b(pounds?|lbs?|oz)\b/i.test(el.textContent || '') && /\d/.test(el.textContent || ''));
    return weightish ? weightish.textContent.trim() : null;
  }

  function probeWeight() {
    const ths = document.querySelectorAll('th');
    for (const th of ths) {
      if ((th.textContent || '').trim().toLowerCase().replace(':','') === 'weight') {
        highlight(th, '#22c55e');
        const tr = th.closest('tr');
        if (tr) {
          const cells = Array.from(tr.children);
          let afterTh = false;
          for (const cell of cells) {
            if (afterTh && (cell.tagName === 'TD' || cell.tagName === 'TH')) {
              highlight(cell, '#f59e0b');
              alert('Found weight: ' + (cell.textContent || '').trim());
              return;
            }
            if (cell === th) afterTh = true;
          }
        }
        const sib = th.nextElementSibling;
        if (sib) {
          highlight(sib, '#f59e0b');
          alert('Found weight: ' + ((sib.textContent || '').trim()));
        }
        return;
      }
    }
    alert('No <th>Weight</th> found.');
  }

  // ======== RESULTS / CSV ========
  function resultsToCSV(resultsMap) {
    const rows = [['ASIN', 'Weight']];
    for (const [asin, weight] of Object.entries(resultsMap)) {
      rows.push([asin, (weight ?? '').toString().replace(/\s+/g, ' ').trim()]);
    }
    return rows.map(r => r.map(cell =>
      /[,"\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell
    ).join(',')).join('\n');
  }

  function downloadCSVNow() {
    const results = getVal('fw_results', {});
    if (!results || !Object.keys(results).length) { alert('No results yet.'); return; }
    const csv = resultsToCSV(results);
    const name = `asin_weights_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.csv`;
    GM_download({ url: 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv), name });
  }

  function resetAll() {
    delVal('fw_queue');
    delVal('fw_results');
    delVal('fw_idx');
    delVal('fw_current');
    delVal('fw_waiting');
    updatePanel();
    alert('State cleared. You can start a new run.');
  }

  // ======== FINISH HANDLER (STOPS LOOP) ========
  function finishRun(autoDownload = true) {
    const results = getVal('fw_results', {});
    // Stop future nudges by clearing the queue
    setVal('fw_waiting', false);
    setVal('fw_current', null);
    setVal('fw_idx', 0);
    setVal('fw_queue', []);       // CRITICAL: prevents re-trigger
    updatePanel();
    if (autoDownload) {
      alert(`Done! Collected ${Object.keys(results).length} weights. Downloading CSV…`);
      downloadCSVNow();
    }
  }

  // ======== UI: Paste modal ========
  function showPasteModal() {
    GM_addStyle(`
      .fw-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:999999;}
      .fw-modal{position:fixed;left:50%;top:10%;transform:translateX(-50%);width:min(900px,90vw);
        background:#fff;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.35);z-index:1000000;padding:16px;}
      .fw-modal h2{margin:0 0 8px 0;font-size:18px}
      .fw-modal textarea{width:100%;height:300px;box-sizing:border-box;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px}
      .fw-modal .row{display:flex;gap:8px;justify-content:flex-end;margin-top:8px}
      .fw-modal button{padding:8px 12px;border-radius:8px;border:1px solid #ccc;background:#f5f5f5;cursor:pointer}
      .fw-modal button.primary{background:#2563eb;color:#fff;border-color:#2563eb}
    `);
    const backdrop = document.createElement('div'); backdrop.className = 'fw-modal-backdrop';
    const modal = document.createElement('div'); modal.className = 'fw-modal';
    modal.innerHTML = `
      <h2>Paste ASINs</h2>
      <p>Paste a long string of 10-character ASINs (letters/numbers). Separators optional.</p>
      <textarea placeholder="B0CMZFG2HCB08N5WRWNW..."></textarea>
      <div class="row">
        <button class="cancel">Cancel</button>
        <button class="primary start">Start</button>
      </div>`;
    backdrop.appendChild(modal); document.body.appendChild(backdrop);

    return new Promise((resolve) => {
      modal.querySelector('.cancel').addEventListener('click', () => { backdrop.remove(); resolve(null); });
      modal.querySelector('.start').addEventListener('click', () => {
        const val = modal.querySelector('textarea').value; backdrop.remove(); resolve(val);
      });
    });
  }

  async function startNewRun() {
    const pasted = await showPasteModal();
    if (!pasted) return;
    const asins = parseAsins(pasted);
    if (!asins.length) { alert('No 10-character ASINs found. Try again.'); return; }

    setVal('fw_queue', asins);
    setVal('fw_results', {});
    setVal('fw_idx', 0);
    setVal('fw_current', null);
    setVal('fw_waiting', false);

    updatePanel();
    alert(`Loaded ${asins.length} ASINs. Starting…`);
    await processLoop();
  }

  // ======== MAIN LOOP ========
  async function processLoop() {
    const queue = getVal('fw_queue', []);
    if (!queue.length) { updatePanel(); return; }

    let idx = getVal('fw_idx', 0);
    const results = getVal('fw_results', {});
    let current = getVal('fw_current', null);
    let waiting = getVal('fw_waiting', false);

    // Done?
    if (idx >= queue.length) {
      finishRun(true);
      return;
    }

    // If we were waiting for page to show the weight for "current", try to read it now
    if (waiting && current) {
      const deadline = Date.now() + PAGE_WAIT_TIMEOUT_MS;
      let weight = null;
      while (Date.now() < deadline && !weight) {
        weight = extractWeightText();
        if (weight) break;
        await sleep(250);
      }
      results[current] = weight || 'NOT_FOUND';
      setVal('fw_results', results);
      setVal('fw_waiting', false);
      setVal('fw_current', null);
      setVal('fw_idx', idx + 1);
      updatePanel();
      await sleep(BETWEEN_ITEMS_MS);
      idx = getVal('fw_idx', 0);
    }

    // Done? (after saving current)
    if (idx >= queue.length) {
      finishRun(true);
      return;
    }

    const asin = queue[idx];
    const { searchInput, searchButton } = getSearchElements();
    if (!searchInput) { alert('Could not find the search input.'); return; }

    if (DEBUG) { highlight(searchInput, '#22c55e'); if (searchButton) highlight(searchButton, '#f59e0b'); }

    dispatchInput(searchInput, asin);
    setVal('fw_current', asin);
    setVal('fw_waiting', true);
    updatePanel();
    await submitSearch(searchInput, searchButton);
  }

  // ======== CONTROL PANEL ========
  function addControlPanel() {
    if (document.getElementById('fw-scraper-panel')) return;

    GM_addStyle(`
      #fw-scraper-panel{position:fixed;right:16px;bottom:16px;z-index:999999;
        background:#111;color:#fff;border-radius:12px;padding:10px 12px;
        box-shadow:0 10px 30px rgba(0,0,0,.35);font:12px/1.35 system-ui,Segoe UI,Roboto,sans-serif}
      #fw-scraper-panel .fw-title{font-weight:700;margin-bottom:6px;opacity:.9}
      #fw-scraper-panel .fw-row{display:flex;gap:8px;margin-top:6px;flex-wrap:wrap}
      #fw-scraper-panel button{padding:6px 10px;border:1px solid #2b2b2b;border-radius:8px;
        background:#1f2937;color:#fff;cursor:pointer}
      #fw-scraper-panel button:hover{background:#374151}
      #fw-scraper-panel button.primary{background:#2563eb;border-color:#2563eb}
      #fw-scraper-panel button.primary:hover{background:#1d4ed8}
      #fw-scraper-panel .fw-stat{opacity:.85}
    `);

    const panel = document.createElement('div');
    panel.id = 'fw-scraper-panel';
    panel.innerHTML = `
      <div class="fw-title">ASIN → Weight</div>
      <div class="fw-stat" id="fw-stat">Idle</div>
      <div class="fw-row">
        <button class="primary fw-start">Start</button>
        <button class="fw-probe-weight">Probe Weight</button>
        <button class="fw-force-next">Force Next</button>
        <button class="fw-dl">Download CSV</button>
        <button class="fw-reset">Reset</button>
      </div>
    `;
    document.body.appendChild(panel);

    panel.querySelector('.fw-start').addEventListener('click', startNewRun);
    panel.querySelector('.fw-dl').addEventListener('click', downloadCSVNow);
    panel.querySelector('.fw-reset').addEventListener('click', resetAll);
    panel.querySelector('.fw-probe-weight').addEventListener('click', probeWeight);
    panel.querySelector('.fw-force-next').addEventListener('click', forceNext);
  }

  function updatePanel() {
    const stat = document.getElementById('fw-stat');
    if (!stat) return;
    const q = getVal('fw_queue', []);
    const idx = getVal('fw_idx', 0);
    const waiting = getVal('fw_waiting', false);
    const current = getVal('fw_current', null);
    const results = getVal('fw_results', {});
    if (!q.length) { stat.textContent = 'Idle — no queue loaded'; return; }
    if (idx >= q.length) { stat.textContent = `Done — ${Object.keys(results).length} results`; return; }
    stat.textContent = waiting ? `Searching ${current} (${idx+1}/${q.length})…`
                               : `Ready for next (${idx+1}/${q.length})`;
  }

  // Manual “Force Next”
  function forceNext() {
    const q = getVal('fw_queue', []);
    let idx = getVal('fw_idx', 0);
    if (!q.length || idx >= q.length) return;

    const current = getVal('fw_current', null);
    const results = getVal('fw_results', {});
    const maybe = extractWeightText();
    results[current ?? q[idx]] = maybe || 'NOT_FOUND';
    setVal('fw_results', results);
    setVal('fw_waiting', false);
    setVal('fw_current', null);
    setVal('fw_idx', idx + 1);
    updatePanel();
    processLoop();
  }

  // ======== MENU & BOOT ========
  GM_registerMenuCommand('Start scraping (paste ASIN list)', () => startNewRun());
  GM_registerMenuCommand('Download CSV now', () => downloadCSVNow());
  GM_registerMenuCommand('Reset scraper state', () => resetAll());

  addControlPanel();
  updatePanel();

  // Auto-continue (SPA-friendly) — only when genuinely mid-run
  try {
    const q = GM_getValue('fw_queue', []);
    const idx = GM_getValue('fw_idx', 0);
    const waiting = GM_getValue('fw_waiting', false);
    if ((q && q.length) && (waiting || idx < q.length)) {
      setTimeout(() => { processLoop().catch?.(e => console.error(e)); }, 400);
    }
  } catch (e) {
    console.error('[ASIN→Weight] boot auto-continue error:', e);
  }

  // Gentle nudger — only when mid-run
  setInterval(() => {
    try {
      const q = GM_getValue('fw_queue', []);
      const idx = GM_getValue('fw_idx', 0);
      const waiting = GM_getValue('fw_waiting', false);
      if ((q && q.length) && (waiting || idx < q.length)) processLoop();
    } catch (e) {
      console.error('[ASIN→Weight] interval error:', e);
    }
  }, 3000);
})();
