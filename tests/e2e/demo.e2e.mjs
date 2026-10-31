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
const URL_ = `http://127.0.0.1:${PORT}/index.html`;

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
  for (let i = 0; i < 6 && await tour.isVisible(); i++) await page.locator('#tour-next').click();
};
const groupRow = name => page.locator('.people li', {has: page.locator('strong', {hasText: new RegExp('^' + name + '$')})});
const tab = name => page.locator('nav.tabs').getByRole('button', {name, exact: true}).click();
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
  await page.getByRole('button', {name: 'Send report'}).click();
  await page.getByText('Please answer the highlighted questions.').waitFor();
  assert.equal(await page.locator('fieldset.has-error').count(), 3);
  const focused = await page.evaluate(() => document.activeElement.closest('fieldset')?.innerText || '');
  assert.match(focused, /Restrooms/, 'focus moves to the first unanswered question');
  await answer('Restrooms', 'No');
  await answer('Doors locked', 'Not completed');
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
  assert.match(await page.locator('fieldset', {hasText: 'Shift notes'}).innerText(), /Required/);
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
  assert.equal(await page.locator('nav.tabs button').count(), 4);
  await signOut();

  await page.locator('#su-name').fill('Sneaky');
  await page.locator('#su-is-rod').check();
  await page.locator('#su-code').fill(code);
  await page.getByRole('button', {name: 'Create account'}).click();
  await page.getByText('didn’t work').waitFor();
  assert.equal(await page.locator('nav.tabs button').count(), 4 - 1 + 0, 'used code gives a Night Lead account');
});

test('Small phone (320px): no sideways scrolling', async () => {
  await fresh({viewport: {width: 320, height: 640}});
  await noSideScroll('sign-in 320');
  await signInDemo('Demo Supervisor');
  await finishTour();
  for (const name of ['Reports', 'Checklists', 'Team', 'Help']) { await tab(name); await page.waitForTimeout(100); await noSideScroll(name + ' 320'); }
});

test('no JavaScript errors on any page', () => assert.deepEqual(pageErrors, []));
