// Checks that the browser (js/rules.js) and the database (resolve_questions) build the same checklists.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync, existsSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveQuestions} from '../js/rules.js';

const pg = process.env.PGBIN || '/usr/lib/postgresql/16/bin';
const fx = JSON.parse(readFileSync(new URL('../fixtures/parity.json', import.meta.url), 'utf8'));

test('browser and database build identical checklists', {skip: !existsSync(pg) && 'Postgres not installed'}, () => {
  const out = join(mkdtempSync(join(tmpdir(), 'nlh-')), 'parity.txt');
  execFileSync('bash', [new URL('./sql/run.sh', import.meta.url).pathname], {env: {...process.env, PARITY_OUT: out}, stdio: 'ignore'});
  const rows = readFileSync(out, 'utf8').trim().split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l));
  assert.equal(rows.length, 2 + 4 + 8);
  for (const row of rows) {
    const [kind, id] = row.case.split(':');
    const args = {questions: fx.questions, overrides: fx.overrides, includeHidden: row.hidden};
    if (kind === 'group') args.groupId = id;
    if (kind === 'person') { args.personId = id; args.groupId = fx.people.find(p => p.id === id).group_id; }
    const js = resolveQuestions(args).map(q => ({...q, sort_order: Number(q.sort_order)}));
    const db = row.out.map(q => ({...q, sort_order: Number(q.sort_order)}));
    assert.deepEqual(js, db, row.case + (row.hidden ? ' (with hidden)' : ''));
  }
});
