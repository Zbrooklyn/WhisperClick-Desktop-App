import fs from 'fs';
const BASE = 'C:/Users/EDWAR/AppData/Local/Temp/claude/C--Users-EDWAR-Dropbox-Claude-Folder-Brain/eda818a5-cdf6-4821-a514-915844af83ea/scratchpad/';
const ID = '1784499018527-7925f3df0090';
const S = 'http://127.0.0.1:8793';
const post = async (p, body) => (await fetch(S + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
const hist = await (await fetch(S + '/api/history?limit=5')).json();
const rows = hist.items || hist.rows || hist;
const it = (rows.items||rows).find ? (rows.find?rows:rows.items).find(r=>r.id===ID) : null;
const item = (Array.isArray(rows)?rows:[]).find(r => r.id === ID);
const text = item.text;
const styles = ['brief', 'bullets', 'detailed'];
const types = ['auto', 'meeting', 'idea', 'call'];
const out = {};
for (const style of styles) {
  for (const note_type of types) {
    const key = `${style}__${note_type}`;
    process.stdout.write('gen ' + key + ' ... ');
    try {
      const r = await post('/api/summarize', { text, style, note_type });
      out[key] = { style, note_type, summary: r.summary || '', action_items: r.action_items || [], error: r.error || null };
      console.log('summaryLen', (r.summary||'').length, 'actions', (r.action_items||[]).length);
    } catch (e) { out[key] = { style, note_type, error: String(e) }; console.log('ERR', e.message); }
  }
}
fs.writeFileSync(BASE + 'gen-summaries.json', JSON.stringify(out, null, 2), 'utf8');
console.log('DONE ->', Object.keys(out).length, 'combos');
