// ==UserScript==
// @name         SIM Ticket Autofill + Slack Post
// @downloadURL https://portal.mycompany.net/userscripts/sim-autofill.user.js
// @downloadURL https://raw.githubusercontent.com/JamesBern1/userscripts/main/sim-ticket-autofill.user.js
// @updateURL   https://raw.githubusercontent.com/JamesBern1/userscripts/main/sim-ticket-autofill.user.js
// @version      1.5
// @description  FCResearch → SIM autofill → post ticket to Slack via Workflow webhook
// @match        https://fcresearch-na.aka.amazon.com/*
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
  const RADIO_INDEX   = 1;                 // second radio option
  const REFILL_MS     = 6000;              // keep refilling for up to 6s
  const REFILL_INT    = 150;               // every 150ms

  const SLACK_WEBHOOK  = 'https://hooks.slack.com/triggers/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'; // <— paste your Workflow webhook
  const POST_WINDOW_MS = 15 * 60 * 1000;          // 15 min window
  const PENDING_KEY    = 'tm_postNext';           // flag we set before submit

  /* ------------ UTIL ------------ */
  const waitFor = (test, cb, int=200, max=60) => {
    let n=0; const id=setInterval(()=>{ if(test()){clearInterval(id);cb();} else if(++n>max){clearInterval(id);} }, int);
  };
  const nativeSet = (el,val)=>{
    if(!el)return;
    const proto = el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,'value').set.call(el,val);
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
  };
  const keyGen = ()=>`tm_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const q = k => new URLSearchParams(location.search).get(k);
  const armPost = () => {
    GM_setValue(PENDING_KEY, Date.now());
    console.log('[TM] Armed Slack post');
  };

  /* ------------ FC RESEARCH PAGE ------------ */
function onFC() {
  // Common button styling
  GM_addStyle(`
    .tm-btn {
      position:fixed; right:20px; z-index:99999;
      background:#ff9900;color:#fff;border-radius:4px;box-shadow:0 2px 6px rgba(0,0,0,.3);
      padding:8px 12px;font:12px/1 Arial; cursor:pointer;
    }
    .tm-btn:hover { background:#e88a00 }
    #tm-btn-broken { top:60px }   /* second button lower */
    #tm-btn-master { top:20px }
  `);

  // Utility to create a button
  const makeBtn = (id,text,handler) => {
    const b=document.createElement('div');
    b.id=id; b.className='tm-btn'; b.textContent=text; b.onclick=handler;
    document.body.appendChild(b);
  };

  // Shared code to open a SIM copy page
  const createTicket = (templateId, titlePrefix) => {
    const rows=[...document.querySelectorAll('table tr')];
    const getVal=label=>{
      const row=rows.find(tr=>tr.cells&&tr.cells[0]&&tr.cells[0].textContent.trim().toLowerCase()===label.toLowerCase());
      return row?(row.cells[1]?.innerText||'').trim().replace(/\s+/g,' '):'';
    };
    const data=Object.fromEntries(FIELDS.map(f=>[f.replace(/\s+/g,''),getVal(f)]));

    const desc=`ASIN - ${data.ASIN||''}
Title - ${data.Title||''}
Binding - ${data.Binding||''}
Publisher - ${data.Publisher||''}
Vendor code - ${data.VendorCode||''}
Weight - ${data.Weight||''}
Dimensions - ${data.Dimensions||''}
List Price - ${data.ListPrice||''}`;

    const payload={
      title:`${titlePrefix}${data.ASIN||''}`,
      desc
    };
    const key=keyGen();
    GM_setValue(key,payload);
    window.open(`https://t.corp.amazon.com/create/copy/${templateId}?tmk=${encodeURIComponent(key)}`,'_blank');
  };

  // MasterPack button
  makeBtn('tm-btn-master','MasterPack Ticket', () =>
    createTicket('V1861702570','Master Pack - ')
  );

  // BrokenSet button
  makeBtn('tm-btn-broken','BrokenSet Ticket', () =>
    createTicket('V1879253931','Broken Set - ')
  );
}

  /* ------------ SIM COPY PAGE ------------ */
  function onSIMCopy () {
  const key = q('tmk');
  const payload = key ? GM_getValue(key) : null;
  if (!payload) { console.warn('[TM] No payload for SIM copy page'); return; }

  /* --- choose radio & click Confirm ---------------------------------- */
  waitFor(() => document.querySelectorAll('input[type="radio"]').length >= 2, () => {
    const radios  = document.querySelectorAll('input[type="radio"]');
    const r       = radios[RADIO_INDEX];
    if (r) { r.click(); r.dispatchEvent(new Event('change', { bubbles: true })); }

    const confirm = [...document.querySelectorAll('button')]
                      .find(b => /confirm/i.test(b.textContent || ''));
    if (confirm) { armPost(); confirm.click(); }
  });

  /* --- fill & keep filled -------------------------------------------- */
  waitFor(() => document.getElementById(SIM_TITLE_ID) && document.getElementById(SIM_DESC_ID), () => {
    const t = document.getElementById(SIM_TITLE_ID);
    const d = document.getElementById(SIM_DESC_ID);

    /* snapshot the blank templates BEFORE we overwrite */
    const TEMPLATE_TITLE = t.value.trim();                       //  ← new
    const TEMPLATE_DESC  = d.value.replace(/\s+/g, ' ').trim();  //  (existing)

    /* initial write */
    nativeSet(t, payload.title || '');
    nativeSet(d, payload.desc  || '');

    let stopTitle  = false;
    let stopDesc   = false;
    const deadline = Date.now() + REFILL_MS;

    const stopLoop = id => { clearInterval(id); console.log('[TM] Refill loop ended'); };

    /* stop when user types */
    t.addEventListener('input', e => { if (e.isTrusted) stopTitle = true; }, { once: true });
    d.addEventListener('input', e => { if (e.isTrusted) stopDesc  = true; }, { once: true });

    const loop = setInterval(() => {
      if (Date.now() > deadline) return stopLoop(loop);

      /* -------- Title -------- */
      const titleLooksTemplate = !t.value || t.value.trim() === TEMPLATE_TITLE;
      if (!stopTitle && titleLooksTemplate) {
        nativeSet(t, payload.title || '');
      }

      /* -------- Description -- */
      const currentTrim   = d.value.replace(/\s+/g, ' ').trim();
      const descLooksTpl  = currentTrim === TEMPLATE_DESC || currentTrim.length < 15;
      if (!stopDesc && descLooksTpl) {
        nativeSet(d, payload.desc || '');
      }

      if (stopTitle && stopDesc) stopLoop(loop);
    }, REFILL_INT);
  });

  /* --- re‑arm when user clicks “Create ticket” ------------------------ */
  const findCreateBtn = () =>
    [...document.querySelectorAll('button')].find(b => /create ticket/i.test(b.textContent || ''));

  waitFor(findCreateBtn, () => {
    const btn = findCreateBtn();
    if (btn) btn.addEventListener('click', armPost, { once: true });
  });

  /* cleanup stored payload */
  setTimeout(() => { if (key) GM_deleteValue(key); }, 30_000);
}
  /* ------------ SIM TICKET VIEW (Slack Post) ------------ */
  function sendToSlack(title, link){
    if (!SLACK_WEBHOOK) return;
    console.log('[TM] Sending to Slack:', title, link);
    GM_xmlhttpRequest({
      method:'POST',
      url:SLACK_WEBHOOK,
      headers:{'Content-Type':'application/json'},
      data:JSON.stringify({ title, url: link }),
      onload:r=>{
        console.log('[TM] Slack response', r.status, r.responseText);
        if(r.status===200){
          const toast=document.createElement('div');
          toast.textContent='✅ Posted to #tpa4-icqa-tt';
          Object.assign(toast.style,{position:'fixed',bottom:'15px',right:'15px',background:'#2eb67d',color:'#fff',padding:'8px 12px',borderRadius:'4px',zIndex:99999,font:'12px Arial'});
          document.body.appendChild(toast);
          setTimeout(()=>toast.remove(),3000);
        }
      },
      onerror:e=>console.error('[TM] Slack error', e)
    });
  }

  function onSIMTicketView(){
    const tid = location.pathname.match(/V\d+/)?.[0];
    if (!tid) return;

    const ts = GM_getValue(PENDING_KEY);
    if (!ts || (Date.now() - ts) > POST_WINDOW_MS) {
      console.log('[TM] Skip Slack post (no pending marker or too old)');
      return;
    }

    const sentKey = `sent_${tid}`;
    if (GM_getValue(sentKey)) {
      console.log('[TM] Already sent for', tid);
      return;
    }

    const getTitle = () => {
  const el =
    document.querySelector('#ticket-title') ||               // edit form
    document.querySelector('[data-testid="ticket-title"]') || // if SIM exposes one
    document.querySelector('h1');                             // read-only view

  let txt = (el?.value || el?.textContent || '').trim();

  // remove a leading severity badge like "5 " or "[5] "
  txt = txt.replace(/^\s*\[?\d+\]?\s*/, '');

  return txt;
};

    const trySend = () => {
      const title = getTitle();
      console.log('[TM] Title found?', title);
      if (title) {
        sendToSlack(title, location.href);
        GM_setValue(sentKey, true);
        GM_deleteValue(PENDING_KEY);
      }
    };

    if (getTitle()) trySend();
    else waitFor(() => !!getTitle(), trySend, 200, 50);
  }

  /* ------------ ROUTING & SPA WATCH ------------ */
  function routeNow() {
    if (location.hostname.includes('fcresearch-na.aka.amazon.com')) {
      onFC();
    } else if (location.hostname.includes('t.corp.amazon.com')) {
      if (/create\/copy/i.test(location.pathname)) onSIMCopy();
      if (/\/V\d+/i.test(location.pathname))      onSIMTicketView();
    }
  }

  routeNow();

  // Watch for client-side navigation
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      console.log('[TM] Path changed to', lastPath);
      routeNow();
    }
  }, 500);

})();
