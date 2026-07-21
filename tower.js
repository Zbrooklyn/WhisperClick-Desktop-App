/* Plan Control Tower — single-plan operator tracker.
   Renders one organized markdown plan (the source of truth) into a live visual tracker. */
(function(){
"use strict";
const $ = id => document.getElementById(id);
const esc = s => (s==null?"":String(s)).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
const inline = s => esc(s)
  .replace(/`([^`]+)`/g,'<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
  .replace(/\*([^*]+)\*/g,'<em>$1</em>')
  .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const cap = s => s ? s.charAt(0).toUpperCase()+s.slice(1) : s;

const RESERVED = ["decisions","risks","roadmap","success criteria","notes","overview",
  "activity","timeline","checklist","goal","constraint"];

const params = new URLSearchParams(location.search);
const SRC = params.get("src") || "PLAN.md";

const state = { md:"", model:null, tab:"overview", search:"", remaining:false,
  readerMode:"rendered", firstRender:true, pending:null, lastSync:Date.now(), offline:false };

/* ---------- parsing ---------- */
function parseItem(line){
  const m = line.match(/^\s*-\s*\[([ xX])\]\s*(.+)$/);
  if(!m) return null;
  let text = m[2];
  const done = /x/i.test(m[1]);
  const owner = (text.match(/@(\w+)/)||[])[1] || null;
  const blocked = (text.match(/\(blocked:\s*([^)]*)\)/i)||[])[1] || null;
  const proof = (text.match(/\(proof:\s*([^)]*)\)/i)||[])[1] || null;
  const need = (text.match(/\(need:\s*([^)]*)\)/i)||[])[1] || null;
  const clean = text
    .replace(/\(blocked:\s*[^)]*\)/ig,"")
    .replace(/\(proof:\s*[^)]*\)/ig,"")
    .replace(/\(need:\s*[^)]*\)/ig,"")
    .replace(/@\w+/g,"")
    .replace(/\s{2,}/g," ").trim();
  return { done, owner, blocked, proof, need, text:clean };
}
function parseDecision(line){
  const m = line.match(/^\s*-\s*(.+)$/); if(!m) return null;
  let t = m[1];
  const sm = t.match(/\((resolved|decided|pending|default|declined)(?::\s*([^)]*))?\)/i);
  const status = sm ? sm[1].toLowerCase() : "pending";
  const detail = sm ? (sm[2]||"") : "";
  const name = t.replace(/\((resolved|decided|pending|default|declined)(?::[^)]*)?\)/i,"").replace(/\s{2,}/g," ").trim();
  return { name, status:status==="decided"?"resolved":status, detail };
}
function parseRisk(line){
  const m = line.match(/^\s*-\s*(.+)$/); if(!m) return null;
  let t = m[1];
  const sv = (t.match(/\((critical|high|medium|low)\)/i)||[])[1];
  const severity = sv ? sv.toLowerCase() : "medium";
  const cm = t.match(/containment:\s*(.+)$/i);
  const containment = cm ? cm[1].trim() : "";
  let title = t.replace(/\((critical|high|medium|low)\)/i,"")
    .replace(/[—-]\s*containment:.*$/i,"").replace(/containment:.*$/i,"").replace(/\s{2,}/g," ").trim();
  return { title, severity, containment };
}
function parse(md){
  const lines = md.split(/\r?\n/);
  let title="", desc=[], meta={}, sections=[], cur=null, seenH2=false;
  for(const raw of lines){
    const line = raw.replace(/\s+$/,"");
    let m;
    if(!seenH2){
      if((m=line.match(/^#\s+(.+)/)) && !title){ title=m[1].trim(); continue; }
      if((m=line.match(/^>\s?(.*)/))){ if(m[1].trim())desc.push(m[1].trim()); continue; }
      if((m=line.match(/^([A-Za-z][A-Za-z ]{1,20}):\s+(.+)$/)) && !line.startsWith("- ")){
        meta[m[1].trim().toLowerCase()]=m[2].trim(); continue; }
    }
    if((m=line.match(/^##\s+(.+)/))){ seenH2=true; cur={name:m[1].trim(),slug:slug(m[1].trim()),lines:[]}; sections.push(cur); continue; }
    if(cur) cur.lines.push(line);
  }
  // classify
  const phases=[], decisions=[], risks=[]; let roadmap=null;
  for(const sec of sections){
    const low = sec.name.toLowerCase();
    const hasChecks = sec.lines.some(l=>/^\s*-\s*\[[ xX]\]/.test(l));
    const isReserved = RESERVED.some(r=>low.startsWith(r));
    if(low.startsWith("decisions")){ sec.type="decisions";
      decisions.push(...sec.lines.map(parseDecision).filter(Boolean)); continue; }
    if(low.startsWith("risks")){ sec.type="risks";
      risks.push(...sec.lines.map(parseRisk).filter(Boolean)); continue; }
    if(low.startsWith("roadmap")){ sec.type="roadmap"; roadmap=sec; continue; }
    if((/^phase\b/i.test(sec.name) || (hasChecks && !isReserved))){
      sec.type="phase";
      const objective=(sec.lines.find(l=>/^objective:/i.test(l))||"").replace(/^objective:/i,"").trim();
      const gate=(sec.lines.find(l=>/^gate:/i.test(l))||"").replace(/^gate:/i,"").trim()
        || (sec.name.match(/\(gate:\s*([^)]*)\)/i)||[])[1] || "";
      const items=[]; let lastIt=null;
      for(const l of sec.lines){
        const it=parseItem(l);
        if(it){ items.push(it); lastIt=it; continue; }
        // an indented, non-bullet line after an item is that item's description
        if(lastIt && /^\s{2,}\S/.test(l) && !/^\s*-/.test(l)){
          lastIt.desc=(lastIt.desc?lastIt.desc+" ":"")+l.trim();
        }
      }
      phases.push({ name:sec.name.replace(/^phase\s+\d+\s*[—–-]\s*/i,"").replace(/\(gate:[^)]*\)/i,"").trim(),
        rawname:sec.name, slug:sec.slug, objective, gate, items });
      continue;
    }
    sec.type="section";
  }
  phases.forEach((p,pi)=>{ p.total=p.items.length; p.done=p.items.filter(i=>i.done).length;
    p.pct=p.total?Math.round(p.done/p.total*100):0;
    p.items.forEach((it,ii)=>{ it.id="p"+pi+"i"+ii; it.pi=pi; it.phase=p.name; }); });
  const total=phases.reduce((a,p)=>a+p.total,0);
  const done=phases.reduce((a,p)=>a+p.done,0);
  const pct=total?Math.round(done/total*100):0;
  const curIdx=phases.findIndex(p=>p.done<p.total);
  const allItems=[]; phases.forEach(p=>p.items.forEach(it=>allItems.push(it)));
  const byId={}; allItems.forEach(it=>byId[it.id]=it);
  const waiting=allItems.filter(i=>!i.done && i.owner && i.owner.toLowerCase()==="edward");
  const blocked=allItems.filter(i=>!i.done && i.blocked);
  const unverified=allItems.filter(i=>i.done && !i.proof);
  let next=null;
  if(curIdx>=0){ const p=phases[curIdx];
    next = p.items.find(i=>!i.done && !i.blocked) || p.items.find(i=>!i.done) || null; }
  // resource links from a "## Resources" section — offered in the item drawer
  const resources=[];
  const resSec=sections.find(s=>/^resources\b/i.test(s.name));
  if(resSec) resSec.lines.join("\n").replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,(_,l,u)=>{resources.push({label:l,url:u});return _;});
  return { title, desc:desc.join(" "), meta, sections, phases, decisions, risks, roadmap,
    total, done, pct, curIdx, allItems, byId, waiting, blocked, unverified, next, resources };
}
function signature(md){
  return (md.match(/\[x\]/gi)||[]).length+"/"+(md.match(/\[[ xX]\]/g)||[]).length+":"+md.length;
}

/* ---------- render: header ---------- */
function phaseLabel(M){
  if(M.curIdx<0) return "All phases complete";
  return "Phase "+(M.curIdx+1)+" of "+M.phases.length+" · "+M.phases[M.curIdx].name;
}
function renderHeader(M){
  const status=(M.meta.status||"").trim();
  const approved=/approved/i.test(status) && !/not/i.test(status);
  const R=52,C=2*Math.PI*R;
  return `<div class="hero">
    <div class="hero-top">
      <div class="ring">
        <svg width="120" height="120" viewBox="0 0 120 120">
          <circle class="track" cx="60" cy="60" r="${R}" fill="none" stroke-width="9"></circle>
          <circle class="fill" cx="60" cy="60" r="${R}" fill="none" stroke-width="9"
            stroke-dasharray="${C}" stroke-dashoffset="${C*(1-M.pct/100)}" id="ringfill"></circle>
        </svg>
        <div class="lbl"><span class="figure"><b class="num" id="ringnum">${M.pct}</b><i>%</i></span><span class="cap">Complete</span></div>
      </div>
      <div class="hero-main">
        <div class="hero-eyebrow">
          ${status?`<span class="statuschip ${approved?'approved':''}">${esc(status)}</span>`:''}
          ${M.meta.version?`<span class="ver">${esc(M.meta.version)}</span>`:''}
        </div>
        <h1>${esc(M.title||"Untitled plan")}</h1>
        ${M.desc?`<p class="goal">${esc(M.desc)}</p>`:''}
        <div class="hero-tags">
          <span class="tag phase">${esc(phaseLabel(M))}</span>
          <span class="tag items num">${M.done}/${M.total} items</span>
        </div>
      </div>
    </div>
    <div class="kpis">
      <div class="kpi dup"><b class="num">${M.pct}%</b><span>Complete</span></div>
      <div class="kpi"><b class="num">${M.curIdx>=0?M.curIdx+1:M.phases.length}<span>/${M.phases.length}</span></b><span>Current phase</span></div>
      <div class="kpi"><b class="num">${M.done}</b><span>Items done</span></div>
      <div class="kpi"><b class="num">${M.total-M.done}</b><span>Remaining</span></div>
    </div>
    ${renderAttention(M)}
  </div>`;
}
function renderAttention(M){
  const n=M.waiting.length;
  if(n>0){
    return `<div class="attention you"><span class="ic"></span><div>
      <span class="lead">${n} thing${n>1?'s':''} need${n>1?'':'s'} you</span>
      ${M.next?`<span class="next clickable" data-item="${esc(M.next.id)}"><b>Next:</b> ${inline((M.next.owner?'@'+M.next.owner+' ':'')+M.next.text)} <span class="muted-sm">· ${esc(M.next.phase)}</span></span>`:''}
    </div></div>`;
  }
  return `<div class="attention clear"><span class="ic"></span><div>
    <span class="lead">Nothing needs you — Claude can advance</span>
    ${M.next?`<span class="next clickable" data-item="${esc(M.next.id)}"><b>Next:</b> ${inline(M.next.text)} <span class="muted-sm">· ${esc(M.next.phase)}</span></span>`:''}
  </div></div>`;
}

/* ---------- tabs ---------- */
function tabList(M){
  const t=[{k:"overview",label:"Overview",alert:M.waiting.length}];
  if(M.phases.length) t.push({k:"phases",label:"Phases",n:M.phases.length});
  if(M.total) t.push({k:"checklist",label:"Checklist",n:M.total});
  if(M.phases.length) t.push({k:"timeline",label:"Timeline"});
  if(M.decisions.length) t.push({k:"decisions",label:"Decisions",n:M.decisions.length});
  if(M.risks.length) t.push({k:"risks",label:"Risks",n:M.risks.length});
  t.push({k:"activity",label:"Activity"});
  t.push({k:"full",label:"Full plan"});
  return t;
}
function renderTabs(M){
  const tabs=tabList(M);
  const primary=["overview","phases","checklist"];
  const hasMore = tabs.length>4;
  const btn=t=>`<button class="tab ${state.tab===t.k?'active':''} ${primary.includes(t.k)?'':'sec'}" data-tab="${t.k}">${t.label}${t.n!=null?`<span class="n num">${t.n}</span>`:''}${t.alert?`<span class="alert">●${t.alert}</span>`:''}</button>`;
  const secTabs=tabs.filter(t=>!primary.includes(t.k));
  return `<div class="tabbar ${hasMore?'hasmore':''}">
    ${tabs.map(btn).join("")}
    <div class="morewrap"><button class="morebtn" id="moreBtn">More ▾</button>
      <div class="moremenu" id="moreMenu">${secTabs.map(t=>`<button data-tab="${t.k}">${t.label}${t.n!=null?`<span class="n num">${t.n}</span>`:''}</button>`).join("")}</div>
    </div>
  </div>`;
}

/* ---------- item rows ---------- */
function itemRow(it){
  const owner = it.owner ? `<span class="owner ${it.owner.toLowerCase()==='edward'?'':'claude'}">@${esc(it.owner)}</span>` : "";
  let tail="";
  if(it.blocked) tail=`<div class="subnote block">blocked: ${esc(it.blocked)}</div>`;
  else if(it.proof) tail=`<div class="subnote">proof: ${esc(it.proof)}</div>`;
  else if(it.done && !it.proof) tail=`<div class="subnote"><span class="chip unver">unverified</span></div>`;
  return `<div class="${"row "+(it.done?"done ":"")+(it.id?"clickable":"")}"${it.id?` data-item="${esc(it.id)}"`:""}><span class="box">${it.done?'✓':''}</span>
    <div class="txt">${owner}${inline(it.text)}${tail}</div>${it.id?'<span class="rowgo" aria-hidden="true">›</span>':''}</div>`;
}

/* ---------- panels ---------- */
function panelOverview(M){
  const constraint = M.meta.constraint ? `<div class="constraint"><div class="eyebrow">Binding constraint</div><p>${inline(M.meta.constraint)}</p></div>` : "";
  const needList = M.waiting.length
    ? M.waiting.map(itemRow).join("")
    : `<div class="empty">Nothing is waiting on you right now.</div>`;
  const blockedCard = M.blocked.length ? `<div class="card"><div class="card-h"><h2>Blocked <span class="n num" style="color:var(--danger)">${M.blocked.length}</span></h2></div><div class="card-b"><div class="list-rows">${M.blocked.map(itemRow).join("")}</div></div></div>` : "";
  const unverCard = M.unverified.length ? `<div class="card"><div class="card-h"><h2>Unverified <span class="n num" style="color:var(--warn)">${M.unverified.length}</span></h2><p class="lead">Marked done with no proof noted.</p></div><div class="card-b"><div class="list-rows">${M.unverified.slice(0,8).map(itemRow).join("")}</div></div></div>` : "";
  const goal = M.meta.goal ? `<div class="aside-card"><div class="eyebrow">Goal</div><div class="big">${inline(M.meta.goal)}</div><div class="goalbar"><i style="width:${M.pct}%"></i></div><div class="muted-sm" style="margin-top:6px">${M.pct}% of plan complete</div></div>` : "";
  const nextCard = M.next ? `<div class="aside-card clickable" data-item="${esc(M.next.id)}"><div class="eyebrow">Next action</div><div style="margin-top:6px;font-size:14px">${inline((M.next.owner?'@'+M.next.owner+' ':'')+M.next.text)}</div><div class="muted-sm" style="margin-top:4px">${esc(M.next.phase)} ›</div></div>` : "";
  const donePh=M.phases.filter(p=>p.pct===100).length;
  const phasesCard = `<div class="aside-card clickable" data-goto="phases"><div class="eyebrow">Phases ›</div><div class="big num">${donePh}<span style="font-size:.5em;color:var(--faint)">/${M.phases.length}</span></div><div class="muted-sm">phases complete${M.curIdx>=0?` · now on <b>${esc(M.phases[M.curIdx].name)}</b>`:''}</div></div>`;
  return `<div class="panel" data-p="overview">
    ${constraint}
    <div class="ov-grid">
      <div>
        <div class="card"><div class="card-h"><h2>Waiting on you${M.waiting.length?` <span class="n num" style="color:var(--danger)">${M.waiting.length}</span>`:''}</h2></div><div class="card-b"><div class="list-rows">${needList}</div></div></div>
        ${blockedCard}${unverCard}
      </div>
      <div>${nextCard}${goal}${phasesCard}</div>
    </div>
  </div>`;
}
function phaseCard(p,i,M){
  const isDone=p.pct===100, isCur=i===M.curIdx;
  const cls=(isDone?"done":"")+(isCur?" current":"")+((!isDone&&!isCur&&p.done===0)?" ph-collapsed":"");
  return `<div class="phase ${cls}" data-ph data-pi="${i}">
    <div class="ph-head" data-toggle>
      <div class="ph-idx">${isDone?'✓':i+1}</div>
      <div class="ph-title"><b>${esc(p.name)}</b>${isCur?'<div class="sub">Current phase</div>':(p.gate&&!isDone?`<div class="sub">gate: ${esc(p.gate)}</div>`:'')}</div>
      <div class="ph-meta"><span class="ph-count num">${p.done}/${p.total}</span></div>
    </div>
    <div class="ph-bar"><i data-w="${p.pct}" style="transform:scaleX(${p.pct/100})"></i></div>
    <div class="ph-items">
      ${p.objective?`<div class="ph-obj">${esc(p.objective)}</div>`:''}
      ${p.items.map(itemRow).join("")}
    </div>
  </div>`;
}
function panelPhases(M){
  return `<div class="panel" data-p="phases" hidden>${M.phases.map((p,i)=>phaseCard(p,i,M)).join("")}</div>`;
}
function panelChecklist(M){
  const groups=M.phases.map(p=>`<div class="card"><div class="card-h" style="padding-bottom:12px"><h2>${esc(p.name)} <span class="n num">${p.done}/${p.total}</span></h2></div><div class="card-b" data-items>${p.items.map(itemRow).join("")}</div></div>`).join("");
  return `<div class="panel" data-p="checklist" hidden>
    <div class="controls">
      <input class="search" id="clSearch" placeholder="Search all ${M.total} items…" value="${esc(state.search)}">
      <label class="toggle"><input type="checkbox" id="clRemain" ${state.remaining?'checked':''}> Remaining only</label>
    </div>
    <div id="clList">${groups}</div>
  </div>`;
}
function panelTimeline(M){
  const nodes=M.phases.map((p,i)=>{
    const st=p.pct===100?"done":(i===M.curIdx?"current":"upcoming");
    return `<div class="tl-node ${st} clickable" data-phase="${i}"><div class="tl-dot"></div>
      <div class="tl-name">${esc(p.name)}</div>
      <div class="tl-meta">${p.done}/${p.total} done · ${st==='done'?'complete':st==='current'?'in progress':'upcoming'}${p.objective?` — ${esc(p.objective)}`:''}</div>
      ${p.gate&&st!=='done'?`<div class="tl-gate">gate: ${esc(p.gate)}</div>`:''}
    </div>`;
  }).join("");
  return `<div class="panel" data-p="timeline" hidden><div class="card"><div class="card-h"><h2>Roadmap</h2><p class="lead">Phase sequence, gates, and what's next.</p></div><div class="card-b"><div class="tl">${nodes}</div></div></div></div>`;
}
function panelDecisions(M){
  const rows=M.decisions.map(d=>`<div class="reg-row"><div class="reg-main"><b>${inline(d.name)}</b>${d.detail?`<div class="d">${inline(d.detail)}</div>`:''}</div><span class="badge ${d.status}">${cap(d.status)}</span></div>`).join("");
  return `<div class="panel" data-p="decisions" hidden><div class="card"><div class="card-h"><h2>Decisions</h2><p class="lead">What's settled, pending, or a working default.</p></div><div class="card-b">${rows}</div></div></div>`;
}
function panelRisks(M){
  const rows=M.risks.map(r=>`<div class="reg-row"><div class="reg-main"><b>${inline(r.title)}</b>${r.containment?`<div class="d"><b style="color:var(--muted)">Containment:</b> ${inline(r.containment)}</div>`:''}</div><span class="badge ${r.severity}">${cap(r.severity)}</span></div>`).join("");
  return `<div class="panel" data-p="risks" hidden><div class="card"><div class="card-h"><h2>Risks</h2><p class="lead">Ranked by severity, each with its containment.</p></div><div class="card-b">${rows}</div></div></div>`;
}
function panelActivity(M){
  const doneItems=M.allItems.filter(i=>i.done);
  const events=(state.activity||[]).map(e=>`<div class="act-row"><span class="act-dot edit"></span><div><div>${esc(e.text)}</div><div class="act-time">${esc(e.when)}</div></div></div>`).join("");
  const derived=doneItems.slice().reverse().map(i=>`<div class="act-row"><span class="act-dot"></span><div><div>Completed — ${inline(i.text)}</div><div class="act-time">${esc(i.phase)}</div></div></div>`).join("");
  return `<div class="panel" data-p="activity" hidden><div class="card">
    <div class="card-h"><h2>Activity</h2><p class="lead">${state.activity?'Recent edits and completions.':'Completed so far — live edit history appears once the tracker is served.'}</p></div>
    <div class="card-b">${events}${derived||'<div class="empty">Nothing completed yet.</div>'}</div></div></div>`;
}
/* full markdown renderer */
function renderMarkdown(md){
  const lines=md.split(/\r?\n/); let out=[], inList=false, para=[];
  const flush=()=>{ if(para.length){ out.push(`<p>${inline(para.join(" "))}</p>`); para=[]; } };
  const endList=()=>{ if(inList){ out.push("</ul>"); inList=false; } };
  for(const raw of lines){
    const l=raw.replace(/\s+$/,""); let m;
    if(!l.trim()){ flush(); endList(); continue; }
    if((m=l.match(/^#\s+(.+)/))){ flush();endList(); out.push(`<h1>${inline(m[1])}</h1>`); continue; }
    if((m=l.match(/^##\s+(.+)/))){ flush();endList(); out.push(`<h2 id="s-${slug(m[1])}">${inline(m[1])}</h2>`); continue; }
    if((m=l.match(/^###\s+(.+)/))){ flush();endList(); out.push(`<h3 id="s-${slug(m[1])}">${inline(m[1])}</h3>`); continue; }
    if(/^(---+|___+)$/.test(l)){ flush();endList(); out.push("<hr>"); continue; }
    if((m=l.match(/^>\s?(.*)/))){ flush();endList(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
    if((m=l.match(/^\s*-\s*\[([ xX])\]\s*(.+)/))){ flush(); if(!inList){out.push("<ul>");inList=true;}
      const it=parseItem(l); const own=it.owner?`<span class="owner ${it.owner.toLowerCase()==='edward'?'':'claude'}">@${esc(it.owner)}</span>`:"";
      out.push(`<li class="${it.done?'done':''}"><span class="b">${it.done?'✓':''}</span><span>${own}${inline(it.text)}</span></li>`); continue; }
    if((m=l.match(/^\s*-\s+(.+)/))){ flush(); if(!inList){out.push("<ul>");inList=true;}
      out.push(`<li class="plain">${inline(m[1])}</li>`); continue; }
    if((m=l.match(/^([A-Za-z][A-Za-z ]{1,20}):\s+(.+)$/))){ flush();endList();
      out.push(`<div class="meta-line"><strong>${esc(m[1])}:</strong> ${inline(m[2])}</div>`); continue; }
    if(inList && /^\s{2,}\S/.test(l) && !/^\s*-/.test(l)){ out.push(`<li class="desc-line">${inline(l.trim())}</li>`); continue; }
    para.push(l);
  }
  flush(); endList();
  return out.join("\n");
}
function panelFull(M){
  const heads=M.sections.map(s=>`<button data-jump="s-${s.slug}">${esc(s.name)}</button>`).join("");
  const body = state.readerMode==="raw"
    ? `<pre class="raw">${esc(state.md)}</pre>`
    : renderMarkdown(state.md);
  return `<div class="panel" data-p="full" hidden>
    <div class="reader-tools">
      <div class="seg"><button class="${state.readerMode==='rendered'?'on':''}" data-mode="rendered">Rendered</button><button class="${state.readerMode==='raw'?'on':''}" data-mode="raw">Raw</button></div>
      ${M.sections.length?`<div class="jump"><button class="jumpbtn" id="jumpBtn">Sections ▾</button><div class="jumpmenu" id="jumpMenu">${heads}</div></div>`:''}
    </div>
    <div class="reader" id="reader">${body}</div>
  </div>`;
}

/* ---------- assemble ---------- */
function panelFor(k,M){
  return ({overview:panelOverview,phases:panelPhases,checklist:panelChecklist,timeline:panelTimeline,
    decisions:panelDecisions,risks:panelRisks,activity:panelActivity,full:panelFull}[k]||panelOverview)(M);
}
function render(){
  const M=state.model; if(!M){return;}
  $("brandSub").textContent = M.title||"";
  const tabs=tabList(M);
  if(!tabs.find(t=>t.k===state.tab)) state.tab="overview";
  const app=$("app");
  app.innerHTML = renderHeader(M)+renderTabs(M)
    +`<div class="stalebanner" id="stale">Plan changed on disk · load latest</div>`
    +tabs.map(t=>panelFor(t.k,M)).join("");
  // show active panel
  app.querySelectorAll(".panel").forEach(p=>p.hidden=p.dataset.p!==state.tab);
  animateHeader(M);
  bindPanel();
}
function animateHeader(M){
  const fill=$("ringfill"), numEl=$("ringnum"); if(!fill||!numEl) return;
  const R=52,C=2*Math.PI*R;
  if(state.firstRender){
    state.firstRender=false;
    const t0=performance.now(),dur=900,ease=p=>1-Math.pow(1-p,3);
    const step=now=>{ const t=Math.min(1,(now-t0)/dur),v=M.pct*ease(t);
      fill.style.strokeDashoffset=C*(1-v/100); numEl.textContent=Math.round(v);
      if(t<1)requestAnimationFrame(step); };
    requestAnimationFrame(step);
  } else { fill.style.strokeDashoffset=C*(1-M.pct/100); numEl.textContent=M.pct; }
}

/* ---------- interactions ---------- */
function switchTab(k){ state.tab=k;
  document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("active",t.dataset.tab===k));
  document.querySelectorAll(".panel").forEach(p=>p.hidden=p.dataset.p!==k);
  const mm=$("moreMenu"); if(mm)mm.classList.remove("open");
}
function itemStatus(it){
  if(it.done) return {k:"done",label:"Done"};
  if(it.blocked) return {k:"blocked",label:"Blocked"};
  if(it.owner && it.owner.toLowerCase()==="edward") return {k:"waiting",label:"Waiting on you"};
  return {k:"open",label:"Open"};
}
function itemHint(it,st){
  if(st.k==="blocked") return "See ‘Blocked by’ below for what has to clear before this can move.";
  if(st.k==="waiting") return "This needs your decision or input to move.";
  if(st.k==="done") return it.proof?"Completed and verified.":"Marked done — no proof recorded yet.";
  return "Ready to work — nothing is gating it.";
}
function linksIn(text){ const out=[]; String(text).replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,(_,l,u)=>{out.push({label:l,url:u});return _;}); return out; }
function openDrawer(id){
  const M=state.model; if(!M) return; const it=M.byId&&M.byId[id]; if(!it) return;
  const st=itemStatus(it);
  const ilinks=linksIn(it.text), res=M.resources||[];
  const linkList=ls=>ls.map(l=>`<a href="${esc(l.url)}" target="_blank" rel="noopener" class="dr-link">${esc(l.label)} ↗</a>`).join("");
  const dr=$("drawer"); if(!dr) return;
  dr.innerHTML=`<div class="dr-head"><span class="dr-status ${st.k}">${st.label}</span>
      <button class="dr-close" data-drclose aria-label="Close">✕</button></div>
    <div class="dr-body">
      <div class="dr-item">${inline(it.text)}</div>
      ${it.desc?`<div class="dr-desc">${inline(it.desc)}</div>`:''}
      ${(()=>{ const need=it.need||(it.desc?"":itemHint(it,st));
        return need?`<div class="dr-hint"><span class="dr-lbl">What's needed</span>${inline(need)}</div>`:""; })()}
      <div class="dr-metagrid">
        <div class="dr-mcell"><span class="dr-lbl">Phase</span><button class="dr-phase" data-phase="${it.pi}">Open ${esc(it.phase)} phase →</button></div>
        <div class="dr-mcell"><span class="dr-lbl">Owner</span><span class="dr-owner">${it.owner?('@'+esc(it.owner)):'—'}</span></div>
      </div>
      ${it.blocked?`<div class="dr-note block"><span class="dr-lbl">Blocked by</span>${esc(it.blocked)}</div>`:''}
      ${it.proof?`<div class="dr-note ok"><span class="dr-lbl">Proof</span>${esc(it.proof)}</div>`:''}
      ${(it.done&&!it.proof)?`<div class="dr-note warn"><span class="dr-lbl">Note</span>Marked done with no proof recorded.</div>`:''}
      ${ilinks.length?`<div class="dr-sec"><div class="eyebrow">Links in this item</div>${linkList(ilinks)}</div>`:''}
      ${res.length?`<div class="dr-sec"><div class="eyebrow">Resources &amp; references</div><div class="dr-seclead">Everything this plan points to — opens in a new tab.</div>${linkList(res)}</div>`:''}
    </div>`;
  dr.setAttribute("aria-hidden","false");
  const bk=$("drawerBk"); if(bk)bk.hidden=false;
  requestAnimationFrame(()=>document.body.classList.add("drawer-open"));
}
function closeDrawer(){
  document.body.classList.remove("drawer-open");
  const dr=$("drawer"); if(dr)dr.setAttribute("aria-hidden","true");
  setTimeout(()=>{ const bk=$("drawerBk"); if(bk)bk.hidden=true; },200);
}
function goToPhase(pi){
  closeDrawer(); switchTab("phases");
  requestAnimationFrame(()=>{
    const card=document.querySelector('.phase[data-pi="'+pi+'"]');
    if(card){ card.classList.remove("ph-collapsed");
      card.scrollIntoView({behavior:"smooth",block:"start"});
      card.classList.add("flash"); setTimeout(()=>card.classList.remove("flash"),1200); }
  });
}
function bindPanel(){
  const app=$("app");
  app.onclick=e=>{
    if(e.target.closest("a")) return;                 // let real links open
    const di=e.target.closest("[data-item]");
    if(di){ openDrawer(di.dataset.item); return; }
    const gp=e.target.closest("[data-phase]");
    if(gp){ goToPhase(+gp.dataset.phase); return; }
    const gt=e.target.closest("[data-goto]");
    if(gt){ switchTab(gt.dataset.goto); window.scrollTo({top:0,behavior:"smooth"}); return; }
    const tab=e.target.closest("[data-tab]");
    if(tab){ switchTab(tab.dataset.tab); return; }
    const more=e.target.closest("#moreBtn");
    if(more){ $("moreMenu").classList.toggle("open"); return; }
    const head=e.target.closest("[data-toggle]");
    if(head){ head.closest("[data-ph]").classList.toggle("ph-collapsed"); return; }
    const mode=e.target.closest("[data-mode]");
    if(mode){ state.readerMode=mode.dataset.mode;
      const M=state.model; const panel=app.querySelector('[data-p="full"]');
      panel.outerHTML=panelFull(M); const np=app.querySelector('[data-p="full"]'); np.hidden=false;
      bindPanel(); return; }
    const jb=e.target.closest("#jumpBtn");
    if(jb){ $("jumpMenu").classList.toggle("open"); return; }
    const jump=e.target.closest("[data-jump]");
    if(jump){ const el=document.getElementById(jump.dataset.jump);
      $("jumpMenu").classList.remove("open"); if(el)el.scrollIntoView({behavior:"smooth",block:"start"}); return; }
    const stale=e.target.closest("#stale");
    if(stale){ applyPending(); return; }
  };
  const s=$("clSearch"); if(s) s.oninput=()=>{ state.search=s.value; filterChecklist(); };
  const r=$("clRemain"); if(r) r.onchange=()=>{ state.remaining=r.checked; filterChecklist(); };
  filterChecklist();
}
function filterChecklist(){
  const list=$("clList"); if(!list) return;
  const q=state.search.trim().toLowerCase();
  list.querySelectorAll(".card").forEach(card=>{
    let shown=0;
    card.querySelectorAll(".row").forEach(row=>{
      const txt=row.textContent.toLowerCase();
      const isDone=row.classList.contains("done");
      let ok=true;
      if(q && !txt.includes(q)) ok=false;
      if(state.remaining && isDone) ok=false;
      row.style.display=ok?"":"none"; if(ok)shown++;
    });
    card.style.display=shown?"":"none";
  });
}
document.addEventListener("click",e=>{
  if(!e.target.closest("#moreBtn")&&!e.target.closest("#moreMenu")){ const m=$("moreMenu"); if(m)m.classList.remove("open"); }
  if(!e.target.closest("#jumpBtn")&&!e.target.closest("#jumpMenu")){ const m=$("jumpMenu"); if(m)m.classList.remove("open"); }
});

/* ---------- theme ---------- */
function initTheme(){
  const saved=localStorage.getItem("pct-theme");
  if(saved) document.documentElement.setAttribute("data-theme",saved);
  $("themeBtn").onclick=()=>{
    const cur=document.documentElement.getAttribute("data-theme")
      || (matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light");
    const next=cur==="dark"?"light":"dark";
    document.documentElement.setAttribute("data-theme",next);
    localStorage.setItem("pct-theme",next);
  };
}

/* ---------- freshness + live poll ---------- */
function setFresh(){
  const f=$("fresh"),t=$("freshTxt");
  if(state.offline){ f.className="freshness offline"; t.textContent="offline"; return; }
  const s=Math.round((Date.now()-state.lastSync)/1000);
  const label = s<8?"live":s<60?`${s}s ago`:`${Math.round(s/60)}m ago`;
  f.className="freshness"+(s>90?" stale":""); t.textContent=label;
}
function applyPending(){
  if(!state.pending) return;
  state.md=state.pending.md; state.model=state.pending.model; state.pending=null;
  render();
}
async function fetchPlan(){
  try{
    const res=await fetch(SRC+"?_="+Date.now(),{cache:"no-store"});
    if(!res.ok) throw 0;
    const md=await res.text();
    state.offline=false; state.lastSync=Date.now();
    if(md!==state.md){
      const model=parse(md);
      if(state.tab==="full"){ // don't yank the reader
        state.pending={md,model};
        const sb=$("stale"); if(sb)sb.classList.add("show");
        // still update header/tabs live
        state.md=state.md; updateProgressLive(model);
      } else {
        state.md=md; state.model=model; render();
      }
    }
  }catch(_){ state.offline=true; }
  setFresh();
}
function updateProgressLive(model){
  // update ring/kpis/attention/tab counts without touching the reader
  const M=state.model; if(!M) return;
  // cheap approach: patch header block only
  const app=$("app"); const hero=app.querySelector(".hero");
  if(hero){ const tmp=document.createElement("div"); tmp.innerHTML=renderHeader(model); hero.replaceWith(tmp.firstElementChild); state.firstRender=false; animateHeader(model); }
}
async function fetchActivity(){
  try{ const res=await fetch("__activity?src="+encodeURIComponent(SRC),{cache:"no-store"});
    if(res.ok){ const j=await res.json(); if(Array.isArray(j)&&j.length) state.activity=j; } }catch(_){}
}
async function initBacklink(){
  if(!params.get("src")) return;              // only when opened from the master dashboard
  try{
    const r=await fetch("plans-index.html",{cache:"no-store"});
    if(!r.ok) return;
    const bar=document.querySelector(".topbar .brand");
    const a=document.createElement("a");
    a.href="plans-index.html"; a.textContent="← All plans";
    a.style.cssText="color:var(--muted);font-weight:600;font-size:13px;margin-right:4px;text-decoration:none;white-space:nowrap";
    bar.parentNode.insertBefore(a, bar);
  }catch(_){}
}
async function boot(){
  initTheme();
  initBacklink();
  const bk=$("drawerBk"), dr=$("drawer");
  if(bk) bk.onclick=closeDrawer;
  if(dr) dr.onclick=e=>{
    if(e.target.closest("a")) return;
    if(e.target.closest("[data-drclose]")){ closeDrawer(); return; }
    const ph=e.target.closest("[data-phase]"); if(ph){ goToPhase(+ph.dataset.phase); return; }
  };
  document.addEventListener("keydown",e=>{ if(e.key==="Escape") closeDrawer(); });
  let md="";
  try{ const res=await fetch(SRC+"?_="+Date.now(),{cache:"no-store"}); if(res.ok) md=await res.text(); }catch(_){}
  if(!md){ const emb=document.getElementById("embedded-plan"); md=emb?emb.textContent:""; }
  state.md=md; state.model=parse(md); state.lastSync=Date.now();
  render();
  await fetchActivity(); if(state.activity) render();
  setInterval(fetchPlan,10000);
  setInterval(setFresh,1000);
}
boot();
})();
