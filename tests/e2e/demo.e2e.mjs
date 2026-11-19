// Browser tests of the real pages, run in DEMO mode (no Supabase needed), at iPhone size.
// Run: node --test tests/e2e/demo.e2e.mjs   (needs Playwright + Chromium installed)
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn, execSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try { ({chromium} = require('playwright')); } catch { ({chromium} = require(execSync('npm root -g').toString().trim() + '/playwright')); }
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PORT = 8000 + Math.floor(Math.random() * 900);
const URL_ = `http://127.0.0.1:${PORT}/index.html?demo`;

let server, browser, ctx, page;
const pageErrors = [];
const fresh = async (opts = {}) => {
  if (ctx) await ctx.close();
  ctx = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, acceptDownloads: true, ...opts});
  page = await ctx.newPage();
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'Renamed group' : undefined));
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(URL_);
};
const answer = (legend, choice) => page.locator('fieldset', {hasText: legend}).getByLabel(choice, {exact: true}).click();
const signInDemo = async name => { await page.getByRole('button', {name: new RegExp(name)}).click(); };
const finishTour = async () => {
  const tour = page.getByRole('dialog');
  await tour.waitFor();
  for (let i = 0; i < 12 && await tour.isVisible(); i++) await page.locator('#tour-next').click();
};
const groupRow = name => page.locator('.people li', {has: page.locator('strong', {hasText: new RegExp('^' + name + '$')})});
const tab = name => page.locator('nav.tabs').getByRole('button', {name: new RegExp('^' + name)}).click();
const signOut = async () => { await tab('Help'); await page.getByRole('button', {name: 'Sign out'}).click(); await page.getByText('Pick a demo account').waitFor(); };
const noSideScroll = async label => {
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  assert.ok(w[0] <= w[1], `${label}: page is wider than the phone screen (${w[0]} > ${w[1]})`);
};

test.before(async () => {
  server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {cwd: ROOT, stdio: 'ignore'});
  await new Promise(r => setTimeout(r, 700));
  browser = await chromium.launch();
  await fresh();
});
test.after(async () => { await browser?.close(); server?.kill(); });

test('Night Lead: tour, required answers, honest negatives, confirmation, history', async () => {
  await page.getByText('DEMO MODE').waitFor();
  await noSideScroll('sign-in');
  await signInDemo('Demo Lead A');
  await finishTour();
  await page.getByText('Shift of').waitFor();
  assert.equal(await page.locator('nav.tabs button').count(), 3, 'Night Leads see only Today / My reports / Help');
  await noSideScroll('today');
  await page.getByText('0 of 4 answered').waitFor();
  await page.getByRole('button', {name: 'Send report'}).click();
  await page.getByText('Please answer the highlighted questions.').waitFor();
  assert.equal(await page.locator('fieldset.has-error').count(), 3);
  const focused = await page.evaluate(() => document.activeElement.closest('fieldset')?.innerText || '');
  assert.match(focused, /Restrooms/, 'focus moves to the first unanswered question');
  await answer('Restrooms', 'No');
  await answer('Doors locked', 'Not completed');
  await page.getByText('2 of 4 answered').waitFor();
  // Draft survives a reload.
  await page.reload();
  await page.getByText('Draft on this phone').waitFor();
  assert.equal(await page.locator('fieldset', {hasText: 'Restrooms'}).locator('input:checked').getAttribute('value'), 'no');
  await answer('Floors', 'Needs attention');
  await page.locator('textarea').fill('Leak near gym');
  await page.getByRole('button', {name: 'Send report'}).click();
  await page.getByText('Report sent ✓').waitFor();
  await tab('My reports');
  await page.locator('details.report summary').first().click();
  await page.getByText('Leak near gym').waitFor();
  // Change and resend creates update #2.
  await tab('Today');
  await page.getByRole('button', {name: 'Change and send again'}).click();
  await answer('Restrooms', 'Yes');
  await answer('Doors locked', 'Completed');
  await answer('Floors', 'Done');
  await page.getByRole('button', {name: 'Send report'}).click();
  await page.getByText('Update #2').waitFor();
  await signOut();
});

test('Supervisor: reports, missing list, Excel/CSV/PDF downloads', async () => {
  await signInDemo('Demo Supervisor');
  await finishTour();
  await page.getByText('1 of 2 Night Leads sent a report').waitFor();
  await page.getByText('Not sent yet:').waitFor();
  assert.match(await page.locator('main').innerText(), /Demo Lead B/);
  await noSideScroll('reports');
  const grab = async name => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', {name, exact: true}).click()]);
    return {name: dl.suggestedFilename(), bytes: readFileSync(await dl.path())};
  };
  const csv = await grab('CSV');
  assert.match(csv.name, /\.csv$/);
  const text = csv.bytes.toString('utf8');
  assert.match(text, /Demo Lead A/); assert.match(text, /Completed/); assert.match(text, /Restrooms checked\? \(sample\)/);
  const xlsx = await grab('Excel');
  assert.match(xlsx.name, /\.xlsx$/); assert.equal(xlsx.bytes.subarray(0, 2).toString(), 'PK', 'Excel file is a real .xlsx (zip)');
  const pdf = await grab('PDF');
  assert.match(pdf.name, /\.pdf$/); assert.equal(pdf.bytes.subarray(0, 4).toString(), '%PDF');
  await page.getByLabel('Only reports with issues').check();
  await page.getByText('No reports for these dates.').waitFor();
});

test('Supervisor: group question, personal change, restore, hide', async () => {
  await tab('Checklists');
  await noSideScroll('checklists');
  await page.locator('#target').selectOption({label: 'Building A (sample)'});
  await page.getByRole('button', {name: 'Add question'}).click();
  await page.locator('#qf-label').fill('Gym mopped');
  await page.locator('#qf-label-es').fill('Gimnasio trapeado');
  await page.getByRole('button', {name: 'Save'}).click();
  await page.locator('.qitem', {hasText: 'Gym mopped'}).waitFor();
  // Personal change for Lead B: notes required.
  await page.locator('#target').selectOption({label: 'Demo Lead B'});
  await page.locator('.qitem', {hasText: 'Shift notes'}).getByRole('button', {name: 'Edit'}).click();
  await page.locator('#qf-req').check();
  await page.getByRole('button', {name: 'Save'}).click();
  await page.locator('.qitem', {hasText: 'Shift notes'}).getByText('Changed here').waitFor();
  assert.equal(await page.locator('.qitem', {hasText: 'Gym mopped'}).count(), 0, 'Building A question not in Lead B\'s list');
  // Hide restrooms for Building B.
  await page.locator('#target').selectOption({label: 'Building B (sample)'});
  await page.locator('.qitem', {hasText: 'Restrooms'}).getByRole('button', {name: 'Hide'}).click();
  await page.locator('.qitem', {hasText: 'Restrooms'}).getByText('Hidden').waitFor();
  // Reorder for everyone.
  await page.locator('#target').selectOption({label: 'Everyone'});
  await page.locator('.qitem', {hasText: 'Doors locked'}).getByRole('button', {name: 'Move up'}).click();
  await page.waitForFunction(() => document.querySelector('.qlist .qitem')?.innerText.includes('Doors locked'));
  await page.getByRole('button', {name: 'Preview'}).click();
  await page.getByText('What they see').waitFor();
  await signOut();

  await signInDemo('Demo Lead B');
  await finishTour();
  await page.getByText('Shift of').waitFor();
  assert.equal(await page.locator('fieldset', {hasText: 'Gym mopped'}).count(), 0);
  assert.equal(await page.locator('fieldset', {hasText: 'Restrooms'}).count(), 0, 'hidden for Building B');
  assert.doesNotMatch(await page.locator('fieldset', {hasText: 'Shift notes'}).innerText(), /Optional/, 'made required');
  assert.match(await page.locator('fieldset').first().innerText(), /Doors locked/, 'new order applies');
  await signOut();

  await signInDemo('Demo Lead A');
  await page.getByRole('button', {name: 'Change and send again'}).click();
  await page.locator('fieldset', {hasText: 'Gym mopped'}).waitFor();
  assert.match(await page.locator('fieldset', {hasText: 'Shift notes'}).innerText(), /Optional/, 'Lead B\'s change does not affect Lead A');
  // Spanish: translated labels, English-only marker where missing.
  await page.locator('header.top').getByRole('button', {name: 'ES'}).click();
  await page.getByText('Gimnasio trapeado').waitFor();
  await page.getByRole('button', {name: 'Enviar reporte'}).waitFor();
  await page.locator('header.top').getByRole('button', {name: 'EN'}).click();
  await signOut();

  await signInDemo('Demo Supervisor');
  await tab('Checklists');
  await page.locator('#target').selectOption({label: 'Demo Lead B'});
  await page.locator('.qitem', {hasText: 'Shift notes'}).getByRole('button', {name: 'Undo change'}).click();
  await page.waitForFunction(() => !document.body.innerText.includes('Changed here'));
});

test('Notes and comments: supervisor to Night Lead and back, private to that person', async () => {
  await tab('Reports'); // still signed in as the supervisor from the previous test
  // Comment on Lead A's report: whole report + one answer.
  await page.locator('details.report summary', {hasText: 'Demo Lead A'}).click();
  const rep = page.locator('details.report', {hasText: 'Demo Lead A'});
  await rep.locator('textarea').fill('Good job. Please mop the gym tomorrow.');
  await rep.getByRole('button', {name: 'Send note'}).click();
  await rep.getByText('Good job. Please mop the gym tomorrow.').waitFor();
  await rep.locator('select').selectOption({label: 'Floors (sample)'});
  await rep.locator('textarea').fill('Which floor needed attention?');
  await rep.getByRole('button', {name: 'Send note'}).click();
  await rep.getByText('Which floor needed attention?').waitFor();
  // Pinned note for Building A only.
  await tab('Notes');
  await noSideScroll('notes');
  await page.locator('#n-target').selectOption({label: 'Building A (sample)'});
  await page.locator('#n-body').fill('Starting tonight, lock the side gate too.');
  await page.getByRole('button', {name: 'Post note'}).click();
  await page.getByText('Read by 0 of 1').waitFor();
  // Range buttons and back button.
  await tab('Reports');
  await page.getByRole('button', {name: 'Last 7 days'}).click();
  await page.waitForFunction(() => document.querySelector('#f-from').value !== document.querySelector('#f-to').value);
  await page.goBack();
  await page.getByText('Post note').waitFor();
  await signOut();

  await signInDemo('Demo Lead B');
  await page.getByText('Shift of').waitFor();
  assert.equal(await page.getByText('lock the side gate').count(), 0, 'Building A note not shown to Lead B');
  await tab('My reports');
  assert.equal(await page.getByText('mop the gym').count(), 0);
  await signOut();

  await signInDemo('Demo Lead A');
  await page.getByText('lock the side gate').waitFor();
  assert.match(await page.locator('nav.tabs').innerText(), /Today\s*1/, 'badge on Today for the unread note');
  await page.getByRole('button', {name: 'Got it ✓'}).click();
  await page.getByText('✓ You read this').waitFor();
  assert.match(await page.locator('nav.tabs').innerText(), /My reports\s*2/, 'badge for 2 unread comments');
  await tab('My reports');
  const mine = page.locator('details.report').first();
  await mine.locator('summary').click();
  await mine.getByText('Please mop the gym tomorrow.').waitFor();
  await mine.getByText('Which floor needed attention?').waitFor();
  await mine.locator('textarea').fill('The floor by the gym. It is fixed now.');
  await mine.getByRole('button', {name: 'Send reply'}).click();
  await mine.getByText('It is fixed now.').waitFor();
  await page.waitForFunction(() => !/My reports\s*\d/.test(document.querySelector('nav.tabs').innerText), null, {timeout: 5000});
  await signOut();

  await signInDemo('Demo Supervisor');
  await page.locator('details.report summary', {hasText: 'New reply'}).waitFor();
  await tab('Notes');
  await page.getByText('Read by 1 of 1').waitFor();
});

test('Team: groups, invite codes, supervisor sign-up, last supervisor protected', async () => {
  await tab('Team');
  await noSideScroll('team');
  await page.locator('#g-name').fill('Night crew');
  await page.getByRole('button', {name: 'Add group'}).click();
  await groupRow('Night crew').waitFor();
  await page.locator('#grp-demo-lead-b').selectOption({label: 'Night crew'});
  await groupRow('Night crew').getByRole('button', {name: 'Rename'}).click();
  await groupRow('Renamed group').waitFor();
  await page.locator('.people li', {hasText: 'supervisor@demo.invalid'}).getByRole('button', {name: 'Make Night Lead'}).click();
  await page.getByText('You can’t remove the last supervisor.').waitFor();
  await page.getByRole('button', {name: 'Create invite code'}).click();
  const code = (await page.locator('#new-code').innerText()).trim();
  assert.match(code, /^[A-Z0-9]{12}$/);
  await signOut();

  await page.locator('#su-name').fill('New Boss');
  await page.locator('#su-is-rod').check();
  await page.locator('#su-code').fill(code.toLowerCase());
  assert.equal(await page.locator('#su-name').inputValue(), 'New Boss', 'typed name kept after ticking the box');
  await page.getByRole('button', {name: 'Create account'}).click();
  await finishTour();
  await page.getByText('Supervisor (ROD)').first().waitFor();
  assert.equal(await page.locator('nav.tabs button').count(), 5);
  await signOut();

  await page.locator('#su-name').fill('Sneaky');
  await page.locator('#su-is-rod').check();
  await page.locator('#su-code').fill(code);
  await page.getByRole('button', {name: 'Create account'}).click();
  await page.getByText('didn’t work').waitFor();
  assert.equal(await page.locator('nav.tabs button').count(), 3, 'used code gives a Night Lead account');
});

test('Supervisor: import a checklist from a file, download it again, share links', async () => {
  await fresh({permissions: ['clipboard-read', 'clipboard-write']});
  await signInDemo('Demo Supervisor');
  await finishTour();
  await tab('Checklists');
  await page.locator('details.io summary').click();
  // A CSV with headers, a Spanish column, one unknown answer type, one blank question and one duplicate.
  const csv = ['Question (English),Question (Spanish),Answer type,Required,Allow "Doesn\'t apply"',
    'All exterior doors locked,Todas las puertas exteriores cerradas,Checkmark,Yes,',
    '"Trash, recycling taken out?",¿Basura sacada?,Yes / No,Yes,Yes',
    'Day shift notes,Notas para el turno de día,Short text,No,',
    ',,Yes / No,,', 'Alarm set,,Slider,,', 'Doors locked (sample),,,,'].join('\r\n');
  await page.locator('#io-file').setInputFiles({name: 'our-checklist.csv', mimeType: 'text/csv', buffer: Buffer.from('\ufeff' + csv, 'utf8')});
  const preview = page.locator('#io-preview');
  await preview.waitFor();
  await preview.getByText('3 question(s) ready to add').waitFor();
  const text = await preview.innerText();
  assert.match(text, /3 row\(s\) will be skipped/);
  assert.match(text, /no question text/); assert.match(text, /answer type not recognised/); assert.match(text, /already in the list/);
  await noSideScroll('import preview');
  await page.getByRole('button', {name: 'Add 3 to the end of the list'}).click();
  await page.getByText('3 question(s) added.').waitFor();
  const labels = await page.locator('.qlist .qitem strong').allInnerTexts();
  assert.deepEqual(labels.slice(-3), ['All exterior doors locked', 'Trash, recycling taken out?', 'Day shift notes']);
  await page.locator('.qitem', {hasText: 'Trash, recycling'}).getByText('Yes / No · Required · Doesn’t apply').waitFor();

  // Download gives the same layout back (so it can be edited and imported again).
  await page.locator('details.io summary').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('details.io').getByRole('button', {name: 'CSV', exact: true}).click()]);
  assert.match(dl.suggestedFilename(), /^night-lead-checklist_Everyone\.csv$/);
  const out = readFileSync(await dl.path(), 'utf8');
  assert.match(out, /Question \(English\),Question \(Spanish\),Answer type,Required/);
  assert.match(out, /"Trash, recycling taken out\?",¿Basura sacada\?,Yes \/ No,Yes,Yes/);
  const [tpl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', {name: 'Get a blank template'}).click()]);
  assert.equal(readFileSync(await tpl.path()).subarray(0, 2).toString(), 'PK', 'template is a real .xlsx');

  // Replace asks first and only then swaps the list.
  await page.locator('#io-file').setInputFiles({name: 'short.csv', mimeType: 'text/csv', buffer: Buffer.from('Lights off\r\nGates closed\r\n', 'utf8')});
  await page.getByRole('button', {name: 'Replace the list with these 2'}).click();
  await page.getByText('2 question(s) added.').waitFor();
  assert.deepEqual(await page.locator('.qlist .qitem strong').allInnerTexts(), ['Lights off', 'Gates closed']);

  // Team: one link for Night Leads, and a link with the code for a new supervisor.
  await tab('Team');
  const share = await page.locator('#share-url').inputValue();
  assert.match(share, /index\.html\?join$/);
  await page.locator('.share').getByRole('button', {name: 'Copy link'}).click();
  await page.getByText('Copied!').waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), share);
  await page.getByRole('button', {name: 'Create invite code'}).click();
  const code = (await page.locator('#new-code').innerText()).trim();
  assert.match(await page.locator('#invite-url').inputValue(), new RegExp('\\?invite=' + code + '$'));
  await noSideScroll('team with links');
  await signOut();

  await page.goto(URL_ + '&join');
  await page.getByText('Welcome! Make your account to get started.').waitFor();
  assert.ok(!page.url().includes('join'), 'the link cleans itself from the address bar');
  await page.goto(URL_ + '&invite=' + code.toLowerCase());
  assert.equal(await page.locator('#su-code').inputValue(), code);
  assert.ok(await page.locator('#su-is-rod').isChecked());
  await page.locator('#su-name').fill('Linked Boss');
  await page.getByRole('button', {name: 'Create account'}).click();
  await finishTour();
  await page.getByText('Supervisor (ROD)').first().waitFor();
});

test('Small phone (320px): no sideways scrolling', async () => {
  await fresh({viewport: {width: 320, height: 640}});
  await noSideScroll('sign-in 320');
  await signInDemo('Demo Supervisor');
  await finishTour();
  for (const name of ['Reports', 'Checklists', 'Team', 'Help']) { await tab(name); await page.waitForTimeout(100); await noSideScroll(name + ' 320'); }
  await tab('Checklists');
  await page.locator('details.io summary').click();
  await noSideScroll('import box 320');
  await tab('Reports');
  const poking = await page.evaluate(() => {
    const card = document.querySelector('form.filters').getBoundingClientRect();
    return [...document.querySelectorAll('form.filters input, form.filters select')].filter(e => e.getBoundingClientRect().right > card.right + 0.5).length;
  });
  assert.equal(poking, 0, 'date and filter fields stay inside their card');
});

test('no JavaScript errors on any page', () => assert.deepEqual(pageErrors, []));
