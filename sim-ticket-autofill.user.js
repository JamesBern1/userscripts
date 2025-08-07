// ==UserScript==
// @name         SIM Ticket Autofill + Slack Post
// @downloadURL  https://portal.mycompany.net/userscripts/sim-autofill.user.js
// @updateURL    https://raw.githubusercontent.com/JamesBern1/userscripts/main/sim-ticket-autofill.user.js
// @version      1.5.2
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

(() => {
/* ---------------------------- CONFIG ---------------------------- */
const FIELDS         = ['ASIN','Title','Binding','Publisher','Vendor Code',
                        'Weight','Dimensions','List Price'];

const SIM_TITLE_ID   = 'ticket-title';
const SIM_DESC_ID    = 'markdown-editor';
const RADIO_INDEX    = 1;            // 2nd radio button
const REFILL_MS      = 6000;         // keep refilling 6 s
const REFILL_INT     = 150;          // every 150 ms

const SLACK_WEBHOOK  =
  'https://hooks.slack.com/triggers/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';

const POST_WINDOW_MS = 90 * 1000;    // 1 ½ min
const PENDING_KEY    = 'tm_postNext_key';

/* ----------------------------- UTILS ---------------------------- */
const waitFor = (test, cb, int=200, max=60) => {
  let n = 0;
  const id = setInterval(() => {
    if (test()) { clearInterval(id); cb(); }
    else if (++n > max) clearInterval(id);
  }, int);
};

const nativeSet = (el,val)=>{
  if(!el) return;
  const proto = el.tagName==='TEXTAREA'
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto,'value').set.call(el,val);
  el.dispatchEvent(new Event('input',{bubbles:true}));
  el.dispatchEvent(new Event('change',{bubbles:true}));
};

const keyGen = () => `tm_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const q      = k => new URLSearchParams(location.search).get(k);
const armPost = tplKey => GM_setValue(PENDING_KEY,String(tplKey));

/* ----------------------- FC-RESEARCH PAGE ----------------------- */
function onFC(){
  GM_addStyle(`
    .tm-btn{position:fixed;right:20px;z-index:99999;
      background:#ff9900;color:#fff;border-radius:4px;box-shadow:0 2px 6px rgba(0,0,0,.3);
      padding:8px 12px;font:12px/1 Arial;cursor:pointer;}
    .tm-btn:hover{background:#e88a00}
    #tm-btn-master{top:20px} #tm-btn-broken{top:60px}
  `);

  const makeBtn=(id,txt,fn)=>{const b=document.createElement('div');
    b.id=id;b.textContent=txt;b.className='tm-btn';b.onclick=fn;document.body.appendChild(b);};

  const createTicket=(template,prefix)=>{
    const rows=[...document.querySelectorAll('table tr')];
    const get=v=>{
      const r=rows.find(tr=>tr.cells?.[0]?.textContent.trim().toLowerCase()===v.toLowerCase());
      return r?(r.cells[1]?.innerText||'').trim().replace(/\s+/g,' '):'';
    };
    const d=Object.fromEntries(FIELDS.map(f=>[f.replace(/\s+/g,''),get(f)]));
    const desc=`ASIN - ${d.ASIN}
Title - ${d.Title}
Binding - ${d.Binding}
Publisher - ${d.Publisher}
Vendor code - ${d.VendorCode}
Weight - ${d.Weight}
Dimensions - ${d.Dimensions}
List Price - ${d.ListPrice}`;
    const key=keyGen(); GM_setValue(key,{title:`${prefix}${d.ASIN}`,desc}); armPost(key);
    window.open(`https://t.corp.amazon.com/create/copy/${template}?tmk=${encodeURIComponent(key)}`,'_blank');
  };

  makeBtn('tm-btn-master','MasterPack Ticket',()=>createTicket('V1861702570','Master Pack - '));
  makeBtn('tm-btn-broken','BrokenSet Ticket', ()=>createTicket('V1879253931','Broken Set - '));
}

/* ------------------------- SIM COPY PAGE ------------------------ */
function onSIMCopy(){
  const key=q('tmk'); const payload=key?GM_getValue(key):null; if(!payload) return;

  waitFor(()=>document.querySelectorAll('input[type="radio"]').length>=2,()=>{
    const r=document.querySelectorAll('input[type="radio"]')[RADIO_INDEX];
    if(r){r.click();r.dispatchEvent(new Event('change',{bubbles:true}));}
    const c=[...document.querySelectorAll('button')].find(b=>/confirm/i.test(b.textContent));
    if(c) c.click();
  });

  waitFor(()=>document.getElementById(SIM_TITLE_ID)&&document.getElementById(SIM_DESC_ID),()=>{
    const t=document.getElementById(SIM_TITLE_ID);
    const d=document.getElementById(SIM_DESC_ID);
    const tplT=t.value.trim(), tplD=d.value.replace(/\s+/g,' ').trim();
    nativeSet(t,payload.title); nativeSet(d,payload.desc);

    let stopT=false,stopD=false; const end=Date.now()+REFILL_MS;
    const loop=setInterval(()=>{
      if(Date.now()>end) return clearInterval(loop);
      if(!stopT && (!t.value.trim()||t.value.trim()===tplT)) nativeSet(t,payload.title);
      const cur=d.value.replace(/\s+/g,' ').trim();
      if(!stopD && (cur===tplD||cur.length<15)) nativeSet(d,payload.desc);
    },REFILL_INT);
    t.addEventListener('input',e=>{if(e.isTrusted)stopT=true;},{once:true});
    d.addEventListener('input',e=>{if(e.isTrusted)stopD=true;},{once:true});
  });

  setTimeout(()=>{if(key)GM_deleteValue(key);},30000);
}

/* -------------- SIM TICKET VIEW → POST TO SLACK -------------- */
function sendSlack (title, url) {
  if (!SLACK_WEBHOOK) return;
  GM_xmlhttpRequest({
    method:  'POST',
    url:     SLACK_WEBHOOK,
    headers: { 'Content-Type':'application/json' },
    data:    JSON.stringify({ title, url }),
    onload: r => {
      if (r.status === 200) {
        const t=document.createElement('div');
        t.textContent='✅ Posted to #tpa4-icqa-tt'; Object.assign(t.style,{position:'fixed',bottom:'15px',right:'15px',background:'#2eb67d',color:'#fff',padding:'8px 12px',borderRadius:'4px',zIndex:99999,font:'12px Arial'}); document.body.appendChild(t); setTimeout(()=>t.remove(),3000);
      }
    }
  });
}


function onSIMTicketView(){
  if(/\/create\/copy\//i.test(location.pathname)) return;
  const tid=location.pathname.match(/V\d+/)?.[0]; if(!tid) return;

  const armedKey=GM_getValue(PENDING_KEY);        // **relaxed check**
  if(!armedKey) return;

  const sentKey=`sent_${tid}`; if(GM_getValue(sentKey)) return;
  if(Date.now()-performance.timeOrigin>POST_WINDOW_MS) return;

  const getTitle=()=>{
    const el=document.querySelector('#ticket-title')||
             document.querySelector('[data-testid="ticket-title"]')||
             document.querySelector('h1');
    return (el?.value||el?.textContent||'').trim().replace(/^\s*\[?\d+\]?\s*/,'');
  };

  const push=()=>{
    const title=getTitle(); if(!title) return;
    sendSlack(title,location.href);
    GM_setValue(sentKey,true); GM_deleteValue(PENDING_KEY);
  };
  getTitle()?push():waitFor(()=>!!getTitle(),push,200,50);
}

/* ---------------------------- ROUTER --------------------------- */
const route=()=>{
  if(/fcresearch/i.test(location.hostname)) onFC();
  else if(location.hostname.includes('t.corp.amazon.com')){
    if(/create\/copy/i.test(location.pathname)) onSIMCopy();
    if(/\/V\d+/i.test(location.pathname))      onSIMTicketView();
  }
};
route();
let last=location.pathname;
setInterval(()=>{if(location.pathname!==last){last=location.pathname;route();}},500);
})();
