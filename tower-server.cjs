#!/usr/bin/env node
/* Plan Control Tower — static server + live file-watch + activity sidecar.
   Usage: node tower-server.cjs [port]   (default 8770)
   Zero dependencies. Serves this folder; records plan edits to .plan-meta/<file>.activity.json. */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const PORT = parseInt(process.argv[2], 10) || 8770;
const META = path.join(ROOT, ".plan-meta");

const TYPES = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8", ".json":"application/json; charset=utf-8",
  ".md":"text/markdown; charset=utf-8", ".svg":"image/svg+xml", ".ico":"image/x-icon",
  ".png":"image/png", ".woff2":"font/woff2" };

function inside(p){ const r=path.resolve(ROOT, p); return r.startsWith(ROOT) ? r : null; }
function countChecks(s){ return { done:(s.match(/\[x\]/gi)||[]).length, total:(s.match(/\[[ xX]\]/g)||[]).length }; }

/* record an edit event for a plan file when its content changes */
function recordEdit(rel){
  try{
    const abs = inside(rel); if(!abs || !fs.existsSync(abs)) return;
    if(!fs.existsSync(META)) fs.mkdirSync(META, { recursive:true });
    const sidecar = path.join(META, path.basename(rel) + ".activity.json");
    let events = [];
    try { events = JSON.parse(fs.readFileSync(sidecar, "utf8")); } catch(_){}
    const md = fs.readFileSync(abs, "utf8");
    const c = countChecks(md);
    const last = events[0];
    const sig = c.done + "/" + c.total + ":" + md.length;
    if(last && last.sig === sig) return;                 // no real change
    const now = new Date();
    const hh = now.getHours(), mm = String(now.getMinutes()).padStart(2,"0");
    const h12 = ((hh+11)%12)+1, ap = hh<12?"AM":"PM";
    let text = "Plan edited";
    if(last){ const dc = c.done - (last.doneCount||0);
      if(dc>0) text = dc+" item"+(dc>1?"s":"")+" completed";
      else if(dc<0) text = Math.abs(dc)+" item"+(dc<-1?"s":"")+" reopened"; }
    else text = "Tracking started — "+c.done+"/"+c.total+" done";
    events.unshift({ text, when: `${now.toLocaleDateString()} · ${h12}:${mm} ${ap}`,
      sig, doneCount:c.done, total:c.total });
    if(events.length>40) events = events.slice(0,40);
    fs.writeFileSync(sidecar, JSON.stringify(events, null, 2));
  }catch(_){}
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  let pathname = decodeURIComponent(u.pathname);

  // activity endpoint
  if(pathname === "/__activity"){
    const src = u.searchParams.get("src") || "PLAN.md";
    recordEdit(src);
    const sidecar = path.join(META, path.basename(src) + ".activity.json");
    let events = [];
    try { events = JSON.parse(fs.readFileSync(sidecar, "utf8"))
      .map(e => ({ text:e.text, when:e.when })); } catch(_){}
    res.writeHead(200, { "Content-Type":"application/json; charset=utf-8" });
    return res.end(JSON.stringify(events));
  }

  if(pathname === "/") pathname = "/tower.html";
  const abs = inside("." + pathname);
  if(!abs || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()){
    res.writeHead(404, { "Content-Type":"text/plain" }); return res.end("404");
  }
  // record edits whenever the plan markdown is fetched
  if(abs.endsWith(".md")) recordEdit(path.relative(ROOT, abs));
  const ext = path.extname(abs).toLowerCase();
  res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control":"no-store" });
  fs.createReadStream(abs).pipe(res);
});

server.listen(PORT, () => {
  console.log("Plan Control Tower → http://localhost:" + PORT + "/tower.html");
  console.log("  (pair with http://100.120.237.49:" + PORT + "/tower.html for phone)");
  console.log("  serving " + ROOT + " · Ctrl+C to stop");
});
