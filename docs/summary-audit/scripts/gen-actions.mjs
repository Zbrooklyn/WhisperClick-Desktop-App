import fs from 'fs';
const BASE = 'C:/Users/EDWAR/AppData/Local/Temp/claude/C--Users-EDWAR-Dropbox-Claude-Folder-Brain/eda818a5-cdf6-4821-a514-915844af83ea/scratchpad/';
const ID = '1784499018527-7925f3df0090';
const S = 'http://127.0.0.1:8793';
const post = async (p, body) => (await fetch(S + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
const rows = await (await fetch(S + '/api/history?limit=5')).json();
const item = (Array.isArray(rows)?rows:rows.items||rows.rows).find(r => r.id === ID);
const text = item.text;
console.log('transcript chars:', text.length, '(run_action truncates to 12000)');
const presets = [
  ['bullet_points', 'Rewrite this as a tight bulleted list of the key points. No preamble.'],
  ['action_items', 'Extract a checklist of concrete action items and to-dos as Markdown checkboxes (- [ ] ...). If there are none, reply exactly: No action items.'],
  ['key_takeaways', 'List the 3–5 most important takeaways as short bullets.'],
  ['chapters', 'Split this into logical chapters. For each chapter give a bold short title on its own line followed by a 1–2 sentence summary. Keep chronological order.'],
];
const out = {};
for (const [name, action] of presets) {
  process.stdout.write('run ' + name + ' ... ');
  const r = await post('/api/action', { transcript: text, action });
  out[name] = { action, result: r.result || '', error: r.error || null };
  console.log('len', (r.result||'').length, r.error?('ERR '+r.error):'');
}
fs.writeFileSync(BASE + 'gen-actions.json', JSON.stringify(out, null, 2), 'utf8');
console.log('DONE');
