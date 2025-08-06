// ==UserScript==
// @name         SIM Ticket Autofill + Slack Post
// @downloadURL  https://portal.mycompany.net/userscripts/sim-autofill.user.js
// @downloadURL  https://raw.githubusercontent.com/JamesBern1/userscripts/main/sim-ticket-autofill.user.js
// @updateURL    https://raw.githubusercontent.com/JamesBern1/userscripts/main/sim-ticket-autofill.user.js
// @version      1.5.1
// @description  FCResearch → SIM autofill → post ticket to Slack via Workflow webhook
// @match        https://fcresearch-na.amazon.com/*
// @match        https://fcresearch-na.aka.amazon.com/*
// @match        https://fcresearch*.amazon.com/*
// @match        https://fcresearch*.aka.amazon.com/*
// @match        https://t.corp.amazon.com/*
 // @grant        GM_setValue
 // @grant        GM_getValue
 // @grant        GM_deleteValue
 // @grant        GM_addStyle
 // @grant        GM_xmlhttpRequest
 // @connect      hooks.slack.com
 // @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';
  console.log('[TM] SIM script loaded on', location.href);

  /* ------------ CONFIG ------------ */
  const FIELDS        = ['ASIN','Title','Binding','Publisher','Vendor Code','Weight','Dimensions','List Price'];
  const SIM_TITLE_ID  = 'ticket-title';
  const SIM_DESC_ID   = 'markdown-editor';
  const RADIO_INDEX   = 1;                 // 2nd radio option
  const REFILL_MS     = 6000;              // keep refilling for up to 6 s
  const REFILL_INT    = 150;               // every 150 ms

  const SLACK_WEBHOOK  = 'https://hooks.slack.com/triggers/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';
  const POST_WINDOW_MS = 90 * 1000;        // 1.5 min window
  const PENDING_KEY    = 'tm_postNext_key';

  /* ------------ UTIL ------------ */
  const waitFor = (test, cb, int = 200, max = 60) => {
    let n = 0;
    const id = setInterval(() => {
      if (test()) { clearInterval(id); cb(); }
      else if (++n > max) clearInterval(id);
    }, int);
  };

  const nativeSet = (el, val) => {
    if (!el) return;
    const proto = el.tagName === 'TEXTAREA'
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val);
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const keyGen = () => `tm_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const q      = k => new URLSearchParams(location.search).get(k);
  const armPost = tplKey => {
    GM_setValue(PENDING_KEY, String(tplKey));
    console.log('[TM] Armed Slack post for', tplKey);
  };

  /* ------------ FC RESEARCH PAGE ------------ */
  function onFC () {
    GM_addStyle(`
      .tm-btn{
        position:fixed;right:20px;z-index:99999;
        background:#ff9900;color:#fff;border-radius:4px;box-shadow:0 2px 6px rgba(0,0,0,.3);
        padding:8px 12px;font:12px/1 Arial;cursor:pointer;
      }
      .tm-btn:hover{background:#e88a00}
      #tm-btn-broken{top:60px}
      #tm-btn-master{top:20px}
    `);

    const makeBtn = (id, text, handler) => {
      const b = document.createElement('div');
      b.id = id; b.className = 'tm-btn'; b.textContent = text; b.onclick = handler;
      document.body.appendChild(b);
    };

    const createTicket = (templateId, titlePrefix) => {
      const rows = [...document.querySelectorAll('table tr')];
      const getVal = label => {
        const row = rows.find(tr => tr.cells &&
          tr.cells[0] &&
          tr.cells[0].textContent.trim().toLowerCase() === label.toLowerCase());
        return row ? (row.cells[1]?.innerText || '').trim().replace(/\s+/g, ' ') : '';
      };
      const data = Object.fromEntries(FIELDS.map(f => [f.replace(/\s+/g, ''), getVal(f)]));

      const desc = `ASIN - ${data.ASIN}
Title - ${data.Title}
Binding - ${data.Binding}
Publisher - ${data.Publisher}
Vendor code - ${data.VendorCode}
Weight - ${data.Weight}
Dimensions - ${data.Dimensions}
List Price - ${data.ListPrice}`;

      const payload = { title: `${titlePrefix}${data.ASIN}`, desc };
      const key = keyGen();
      GM_setValue(key, payload);
      armPost(key);
      window.open(
        `https://t.corp.amazon.com/create/copy/${templateId}?tmk=${encodeURIComponent(key)}`,
        '_blank'
      );
    };

    makeBtn('tm-btn-master', 'MasterPack Ticket',
      () => createTicket('V1861702570', 'Master Pack - ')
    );
    makeBtn('tm-btn-broken', 'BrokenSet Ticket',
      () => createTicket('V1879253931', 'Broken Set - ')
    );
  }

  /* ------------ SIM COPY PAGE ------------ */
  function onSIMCopy () {
    const key = q('tmk');
    const payload = key ? GM_getValue(key) : null;
    if (!payload) return;

    /* radio + Confirm dialog */
    waitFor(() => document.querySelectorAll('input[type="radio"]').length >= 2, () => {
      const r = document.querySelectorAll('input[type="radio"]')[RADIO_INDEX];
      if (r) { r.click(); r.dispatchEvent(new Event('change', { bubbles: true })); }
      const confirm = [...document.querySelectorAll('button')]
        .find(b => /confirm/i.test(b.textContent));
      if (confirm) confirm.click();
    });

    /* title + desc fill */
    waitFor(() => document.getElementById(SIM_TITLE_ID) && document.getElementById(SIM_DESC_ID), () => {
      const t = document.getElementById(SIM_TITLE_ID);
      const d = document.getElementById(SIM_DESC_ID);
      const TEMPLATE_TITLE = t.value.trim();
      const TEMPLATE_DESC  = d.value.replace(/\s+/g, ' ').trim();

      nativeSet(t, payload.title);
      nativeSet(d, payload.desc);

      let stopTitle = false, stopDesc = false;
      const deadline = Date.now() + REFILL_MS;
      const loop = setInterval(() => {
        if (Date.now() > deadline) { clearInterval(loop); return; }
        if (!stopTitle && (!t.value.trim() || t.value.trim() === TEMPLATE_TITLE)) nativeSet(t, payload.title);
        const cur = d.value.replace(/\s+/g, ' ').trim();
        if (!stopDesc && (cur === TEMPLATE_DESC || cur.length < 15)) nativeSet(d, payload.desc);
        if (stopTitle && stopDesc) clearInterval(loop);
      }, REFILL_INT);

      t.addEventListener('input', e => { if (e.isTrusted) stopTitle = true; }, { once: true });
      d.addEventListener('input', e => { if (e.isTrusted) stopDesc  = true; }, { once: true });
    });

    /* cleanup */
    setTimeout(() => { if (key) GM_deleteValue(key); }, 30_000);
  }

  /* ------------ SIM TICKET VIEW (Slack Post) ------------ */
  function sendToSlack (title, link) {
    if (!SLACK_WEBHOOK) return;
    GM_xmlhttpRequest({
      method: 'POST',
      url: SLACK_WEBHOOK,
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ title, url: link }),
      onload: r => {
        if (r.status === 200) {
          const toast = document.createElement('div');
          toast.textContent = '✅ Posted to #tpa4-icqa-tt';
          Object.assign(toast.style, {
            position: 'fixed', bottom: '15px', right: '15px',
            background: '#2eb67d', color: '#fff',
            padding: '8px 12px', borderRadius: '4px',
            zIndex: 99999, font: '12px Arial'
          });
          document.body.appendChild(toast);
          setTimeout(() => toast.remove(), 3000);
        }
      }
    });
  }

  function onSIMTicketView () {
    const tid = location.pathname.match(/V\d+/)?.[0];
    if (!tid) return;

    const armedKey = GM_getValue(PENDING_KEY);
    if (!armedKey) return;

    const sentKey = `sent_${tid}`;
    if (GM_getValue(sentKey)) return;

    const getTitle = () => {
      const el = document.querySelector('#ticket-title') ||
                 document.querySelector('[data-testid="ticket-title"]') ||
                 document.querySelector('h1');
      return (el?.value || el?.textContent || '').trim().replace(/^\s*\[?\d+\]?\s*/, '');
    };

    const trySend = () => {
      const title = getTitle();
      if (title) {
        sendToSlack(title, location.href);
        GM_setValue(sentKey, true);
        GM_deleteValue(PENDING_KEY);
      }
    };

    getTitle() ? trySend() : waitFor(() => !!getTitle(), trySend, 200, 50);
  }

  /* ------------ ROUTER ------------ */
  function routeNow () {
    if (location.hostname.includes('fcresearch')) onFC();
    else if (location.hostname.includes('t.corp.amazon.com')) {
      if (/create\/copy/.test(location.pathname)) onSIMCopy();
      if (/\/V\d+/.test(location.pathname))      onSIMTicketView();
    }
  }
  routeNow();
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) { lastPath = location.pathname; routeNow(); }
  }, 500);
})();
