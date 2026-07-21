import fs from 'fs';
const BASE = 'C:/Users/EDWAR/AppData/Local/Temp/claude/C--Users-EDWAR-Dropbox-Claude-Folder-Brain/eda818a5-cdf6-4821-a514-915844af83ea/scratchpad/';
const ID = '1784499018527-7925f3df0090';
const S = 'http://127.0.0.1:8793';
const post = async (p, body) => (await fetch(S + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();

const hist = await (await fetch(S + '/api/history?limit=5')).json();
const rows = hist.items || hist.rows || hist;
const it = rows.find(r => r.id === ID);
const transcript = it.text;
const summary = it.summary || '';
const actions = it.action_items || [];

console.log('fetching decisions, quotes, followups...');
const [rd, kq, fu] = await Promise.all([
  post('/api/review-details', { transcript }),
  post('/api/key-quotes', { transcript }),
  post('/api/followups', { transcript, summary }),
]);
const decisions = rd.decisions || [];
const quotes = kq.quotes || [];
const questions = fu.questions || [];

const bul = (arr) => arr.map(x => '- ' + String(x).trim()).join('\n');
const sumLines = summary.split(/\n|(?<=\.)\s+-\s+/).map(s => s.replace(/^-\s*/, '').trim()).filter(Boolean);

let md = '';
md += '# So You Want to Be an AI Consultant? Start With These 10 Questions\n\n';
md += '**Speaker:** Ashley Gross (AI Workforce Alliance)  \n';
md += '**Source:** https://youtu.be/uZyq1p9kRDU  ·  **Duration:** 18:14  \n';
md += '**Transcribed & analyzed with WhisperClick**\n\n';
md += '---\n\n';
md += '## Summary\n\n' + (sumLines.length ? bul(sumLines) : summary) + '\n\n';
if (decisions.length) md += '## Decisions\n\n' + bul(decisions) + '\n\n';
md += '## Action Items\n\n' + (actions.length ? bul(actions) : '_None_') + '\n\n';
if (quotes.length) md += '## Key Quotes\n\n' + quotes.map(q => '> ' + String(q).trim()).join('\n\n') + '\n\n';
if (questions.length) md += '## Ask Next\n\n' + bul(questions) + '\n\n';
md += '---\n\n## Full Transcript\n\n' + transcript.trim() + '\n';

fs.writeFileSync(BASE + 'ashley-gross-ai-consultant-FULL.md', md, 'utf8');
console.log('done:', { summaryBullets: sumLines.length, decisions: decisions.length, actions: actions.length, quotes: quotes.length, questions: questions.length, chars: md.length });
