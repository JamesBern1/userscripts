// ==UserScript==
// @name         SIM Ticket Autofill + Slack Post
// @downloadURL  https://portal.mycompany.net/userscripts/sim-autofill.user.js
// @updateURL    https://portal.mycompany.net/userscripts/sim-autofill.user.js
// @version      1.5.2
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

  /* ------------ CONFIG ------------ */
  const FIELDS        = ['ASIN','Title','Binding','Publisher','Vendor Code','Weight','Dimensions','List Price'];
  const SIM_TITLE_ID  = 'ticket-title';
  const SIM_DESC_ID   = 'markdown-editor';
  const RADIO_INDEX   = 1;
  const REFILL_MS     = 6000;
  const REFILL_INT    = 150;

  const SLACK_WEBHOOK  = 'https://hooks.slack.com/triggers/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';
  const POST_WINDOW_MS = 90 * 1000;                 // 1.5 min
  const PENDING_KEY    = 'tm_postNext_key';          // template key
  const PENDING_TS     = 'tm_postNext_ts';           // ★ timestamp of click

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
  const armPost = tplKey => {
    GM_setValue(PENDING_KEY, String(tplKey));
    GM_setValue(PENDING_TS,  Date.now());        // ★ remember when we armed
  };

  /* ------------ FC RESEARCH PAGE ------------ */
  function onFC() {
    /* styles & helper trimmed for brevity – unchanged */
    /* … */
  }

  /* ------------ SIM COPY PAGE ------------ */
  function onSIMCopy () {
    const key = q('tmk');
    const payload = key ? GM_getValue(key) : null;
    if (!payload) return;

    /* radio / confirm click same as before … */

    const findCreateBtn = () =>
      [...document.querySelectorAll('button')].find(b=>/create ticket/i.test(b.textContent||''));
    waitFor(findCreateBtn, () => {
      const btn=findCreateBtn();
      if (btn) btn.addEventListener('click',()=>{ GM_setValue(PENDING_TS, Date.now()); },{once:true}); // ★
    });

    /* cleanup stored payload … */
  }

  /* ------------ SIM TICKET VIEW (Slack Post) ------------ */
  function sendToSlack(title, link){
    /* identical */
  }

  function onSIMTicketView(){
    const tid = location.pathname.match(/V\d+/)?.[0];
    if(!tid) return;

    /* ----- NEW time-based gate ------------------------- */
    const armedAt = GM_getValue(PENDING_TS) || 0;        // ★
    if(!armedAt || (Date.now() - armedAt) > POST_WINDOW_MS){
      return;   // window expired or never armed
    }

    const sentKey=`sent_${tid}`;
    if(GM_getValue(sentKey)) return;

    const getTitle = () =>{
      const el=document.querySelector('#ticket-title')||
               document.querySelector('[data-testid="ticket-title"]')||
               document.querySelector('h1');
      return (el?.value||el?.textContent||'').trim().replace(/^\s*\[?\d+\]?\s*/,'');
    };

    const trySend=()=>{
      const title=getTitle();
      if(title){
        sendToSlack(title,location.href);
        GM_setValue(sentKey,true);
        GM_deleteValue(PENDING_KEY);
        GM_deleteValue(PENDING_TS); // disarm
      }
    };

    if(getTitle()) trySend();
    else waitFor(()=>!!getTitle(), trySend, 200, 50);
  }

  /* ------------ ROUTER ------------ */
  function routeNow(){
    if(location.hostname.includes('fcresearch-na.aka.amazon.com')) onFC();
    else if(location.hostname.includes('t.corp.amazon.com')){
      if(/create\/copy/i.test(location.pathname)) onSIMCopy();
      if(/\/V\d+/i.test(location.pathname))      onSIMTicketView();
    }
  }
  routeNow();
  let lastPath=location.pathname;
  setInterval(()=>{ if(location.pathname!==lastPath){ lastPath=location.pathname; routeNow(); } },500);

})(); 
