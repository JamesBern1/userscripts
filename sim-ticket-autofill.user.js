// ==UserScript==
// @name         SIM Ticket Autofill + Slack Post
// @version      1.5.2
// @description  FCResearch → SIM autofill → post ticket to Slack
// @downloadURL  https://portal.mycompany.net/userscripts/sim-autofill.user.js
// @updateURL    https://raw.githubusercontent.com/JamesBern1/userscripts/main/sim-ticket-autofill.user.js
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

  /* ===== CONFIG ===== */
  const FIELDS          = ['ASIN','Title','Binding','Publisher','Vendor Code','Weight','Dimensions','List Price'];
  const SIM_TITLE_ID    = 'ticket-title';
  const SIM_DESC_ID     = 'markdown-editor';
  const RADIO_INDEX     = 1;
  const REFILL_MS       = 6000;
  const REFILL_INT      = 150;

  const SLACK_WEBHOOK   = 'https://hooks.slack.com/triggers/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';
  const POST_WINDOW_MS  = 90 * 1000;          // 1.5 min
  const ARM_KEY         = 'tm_postNext_key';  // holds template-key

  /* ===== UTIL ===== */
  const waitFor = (test, cb, int=200, max=60)=>{
    let n=0; const id=setInterval(()=>{if(test()){clearInterval(id);cb();}else if(++n>max){clearInterval(id);}},int);
  };
  const nativeSet = (el,val)=>{
    if(!el)return;
    const p=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(p,'value').set.call(el,val);
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
  };
  const keyGen = ()=>`tm_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const q      = k=>new URLSearchParams(location.search).get(k);
  const arm    = k=>{ GM_setValue(ARM_KEY,String(k)); };

  /* ===== FC RESEARCH PAGE ===== */
  function onFC(){
    GM_addStyle(`
      .tm-btn{position:fixed;right:20px;z-index:99999;background:#ff9900;color:#fff;border-radius:4px;
              box-shadow:0 2px 6px rgba(0,0,0,.3);padding:8px 12px;font:12px/1 Arial;cursor:pointer;}
      .tm-btn:hover{background:#e88a00} #tm-btn-master{top:20px} #tm-btn-broken{top:60px}
    `);
    const makeBtn=(id,txt,h)=>{
      const b=document.createElement('div');b.id=id;b.className='tm-btn';b.textContent=txt;b.onclick=h;document.body.appendChild(b);
    };
    const createTicket=(tpl,titlePrefix)=>{
      const rows=[...document.querySelectorAll('table tr')];
      const val=lab=>{const r=rows.find(tr=>tr.cells[0]?.textContent.trim().toLowerCase()===lab.toLowerCase());return r?(r.cells[1]?.innerText||'').trim().replace(/\s+/g,' '):'';};
      const d=Object.fromEntries(FIELDS.map(f=>[f.replace(/\s+/g,''),val(f)]));
      const desc=`ASIN - ${d.ASIN}\nTitle - ${d.Title}\nBinding - ${d.Binding}\nPublisher - ${d.Publisher}\nVendor code - ${d.VendorCode}\nWeight - ${d.Weight}\nDimensions - ${d.Dimensions}\nList Price - ${d.ListPrice}`;
      const payload={title:`${titlePrefix}${d.ASIN}`,desc};
      const k=keyGen(); GM_setValue(k,payload); arm(k);
      window.open(`https://t.corp.amazon.com/create/copy/${tpl}?tmk=${encodeURIComponent(k)}`,'_blank');
    };
    makeBtn('tm-btn-master','MasterPack Ticket',()=>createTicket('V1861702570','Master Pack - '));
    makeBtn('tm-btn-broken','BrokenSet Ticket',()=>createTicket('V1879253931','Broken Set - '));
  }

  /* ===== SIM COPY PAGE ===== */
  function onSIMCopy(){
    const key=q('tmk'); const payload=key?GM_getValue(key):null; if(!payload)return;
    waitFor(()=>document.querySelectorAll('input[type="radio"]').length>=2,()=>{
      const r=document.querySelectorAll('input[type="radio"]')[RADIO_INDEX];
      if(r){r.click();r.dispatchEvent(new Event('change',{bubbles:true}));}
      const confirm=[...document.querySelectorAll('button')].find(b=>/confirm/i.test(b.textContent||'')); if(confirm)confirm.click();
    });
    waitFor(()=>document.getElementById(SIM_TITLE_ID)&&document.getElementById(SIM_DESC_ID),()=>{
      const t=document.getElementById(SIM_TITLE_ID),d=document.getElementById(SIM_DESC_ID);
      const tplT=t.value.trim(),tplD=d.value.replace(/\s+/g,' ').trim();
      nativeSet(t,payload.title); nativeSet(d,payload.desc);
      let stopT=false,stopD=false,constDeadline=Date.now()+REFILL_MS;
      const loop=setInterval(()=>{if(Date.now()>constDeadline)return clearInterval(loop);
        if(!stopT&&( !t.value.trim()||t.value.trim()===tplT))nativeSet(t,payload.title);
        const cur=d.value.replace(/\s+/g,' ').trim(); if(!stopD&&(cur===tplD||cur.length<15))nativeSet(d,payload.desc);
        if(stopT&&stopD)clearInterval(loop);},REFILL_INT);
      t.addEventListener('input',e=>{if(e.isTrusted)stopT=true;},{once:true});
      d.addEventListener('input',e=>{if(e.isTrusted)stopD=true;},{once:true});
    });
  }

  /* ===== SIM TICKET VIEW ===== */
  function sendSlack(title,url){
    if(!SLACK_WEBHOOK)return;
    GM_xmlhttpRequest({method:'POST',url:SLACK_WEBHOOK,headers:{'Content-Type':'application/json'},
      data:JSON.stringify({title,url}),
      onload:r=>{
        if(r.status===200){
          const toast=document.createElement('div');
          toast.textContent='✅ Posted to #tpa4-icqa-tt';
          Object.assign(toast.style,{position:'fixed',bottom:'15px',right:'15px',background:'#2eb67d',color:'#fff',
                                     padding:'8px 12px',borderRadius:'4px',zIndex:99999,font:'12px Arial'});
          document.body.appendChild(toast); setTimeout(()=>toast.remove(),3000);
        }
      }});
  }
  function onSIMView(){
    const tid=location.pathname.match(/V\d+/)?.[0]; if(!tid)return;
    const armed=GM_getValue(ARM_KEY); if(!armed)return;
    const sent=`sent_${tid}`; if(GM_getValue(sent))return;
    if(Date.now()-parseInt(armed.split('_')[1],10)>POST_WINDOW_MS)return;  // time check using key timestamp
    const title=(()=>{const e=document.querySelector('#ticket-title')||document.querySelector('[data-testid="ticket-title"]')||document.querySelector('h1'); return (e?.value||e?.textContent||'').trim().replace(/^\s*\[?\d+\]?\s*/,'');})();
    if(title){
      sendSlack(title,location.href); GM_setValue(sent,true); GM_deleteValue(ARM_KEY);
    }
  }

  /* ===== ROUTER ===== */
  const route=()=>{
    if(location.hostname.includes('fcresearch')) onFC();
    else if(location.hostname.includes('t.corp.amazon.com')){
      if(/create\/copy/.test(location.pathname)) onSIMCopy();
      if(/\/V\d+/.test(location.pathname))       onSIMView();
    }
  };
  route(); let last=location.pathname;
  setInterval(()=>{if(location.pathname!==last){last=location.pathname;route();}},500);
})();
