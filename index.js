// index.js
import 'dotenv/config';
import fs from 'node:fs';
import puppeteer from 'puppeteer';

const defaults = {
  SIMPEG_LOGIN_URL: process.env.SIMPEG_LOGIN_URL ?? 'https://simpeg.kemenkum.go.id/devp/siap/signin.php',
  SIMPEG_JOURNAL_URL: process.env.SIMPEG_JOURNAL_URL ?? 'https://simpeg.kemenkum.go.id/devp/siap/skp_journal.php',
  NIP: process.env.NIP,
  PASSWORD: process.env.PASSWORD,
  JOURNAL_TEXT: process.env.JOURNAL_TEXT ?? 'Melaksanakan tugas teknologi informasi sesuai SKP dan perintah atasan',
  JAM_MULAI: process.env.JAM_MULAI ?? '06',
  MENIT_MULAI: process.env.MENIT_MULAI ?? '25',
  JAM_SELESAI: process.env.JAM_SELESAI ?? '17',
  MENIT_SELESAI: process.env.MENIT_SELESAI ?? '35',
  JUMLAH: process.env.JUMLAH ?? '1',
  SATUAN: process.env.SATUAN ?? '1',
  BIAYA: process.env.BIAYA ?? '0',
  // SKP pilihan: 'lainlain' | '2' (Tugas Tambahan) | '3' (Kreatifitas) | atau value lain yang tersedia
  SKP_VALUE: process.env.SKP_VALUE ?? 'lainlain',
  HEADLESS: process.env.HEADLESS ?? 'true',
  JOURNAL_TIMEZONE: process.env.JOURNAL_TIMEZONE ?? 'Asia/Jakarta'
};

function today_ddmmyyyy(timeZone) {
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
    const parts = formatter.formatToParts(new Date());
    const lookup = type => parts.find(p => p.type === type)?.value ?? '';
    const dd = lookup('day');
    const mm = lookup('month');
    const yyyy = lookup('year');
    if (!dd || !mm || !yyyy) throw new Error('Missing date parts');
    return `${dd}-${mm}-${yyyy}`;
  } catch (err) {
    console.warn(`Failed to format date with timezone "${timeZone}", falling back to system timezone.`, err);
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  }
}

async function selectWithFallback(page, selector, desiredValue) {
  await page.waitForSelector(selector, { visible: true });
  const hasValue = await page.$eval(selector, (el, val) => {
    const opt = Array.from(el.options).find(o => o.value === val);
    if (opt) { el.value = val; el.dispatchEvent(new Event('change', { bubbles: true })); return true; }
    return false;
  }, desiredValue);
  if (!hasValue) {
    // pick first option
    await page.$eval(selector, el => {
      if (el.options.length > 0) {
        el.selectedIndex = 0;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }
}

function parseAccountsOverrides() {
  const raw = process.env.ACCOUNTS_JSON;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Failed to parse ACCOUNTS_JSON. Provide a valid JSON array string.', err);
    return [];
  }
}

function resolveAccounts() {
  const extras = parseAccountsOverrides();

  const primary = defaults.NIP && defaults.PASSWORD ? [defaults] : [];
  const mergedAccounts = [...primary, ...extras].map((accountOverrides, index) => ({
    ...defaults,
    ...accountOverrides,
    __index: index + 1
  })).filter(acc => acc.NIP && acc.PASSWORD);

  if (mergedAccounts.length === 0) {
    console.error('No valid accounts found. Provide NIP/PASSWORD in .env or through ACCOUNTS_JSON/ACCOUNTS_FILE.');
    process.exit(1);
  }

  const seen = new Set();
  const deduped = [];
  for (const account of mergedAccounts) {
    const key = `${account.NIP}-${account.PASSWORD}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(account);
  }
  return deduped;
}

function screenshotNameFor(account, total) {
  if (total === 1) return 'proof.png';
  const safeSuffix = (account.NIP ?? `account-${account.__index ?? 'x'}`).replace(/[^0-9A-Za-z_-]/g, '') || `account-${account.__index ?? 'x'}`;
  return `proof-${safeSuffix}.png`;
}

async function runForAccount(account, screenshotPath) {
  const browser = await puppeteer.launch({
    headless: account.HEADLESS === 'true',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1366, height: 900 }
  });

  const page = await browser.newPage();
  try {
    await page.emulateTimezone(account.JOURNAL_TIMEZONE);
  } catch (err) {
    console.warn(`Failed to emulate browser timezone "${account.JOURNAL_TIMEZONE}". Continuing with default timezone.`, err);
  }

  // 1) Open login page
  await page.goto(account.SIMPEG_LOGIN_URL, { waitUntil: 'networkidle2' });

  // 2) Type NIP, click "Masuk" to open password modal
  await page.waitForSelector('#user_nip', { visible: true });
  await page.type('#user_nip', account.NIP, { delay: 20 });
  const getVisibleMasuk =
    `(() => {
      const candidates = Array.from(document.querySelectorAll('#masuk'));
      return candidates.find((btn) => {
        if (!(btn instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(btn);
        return style && style.display !== 'none' && style.visibility !== 'hidden' && btn.offsetParent !== null;
      }) ?? null;
    })()`;
  await page.waitForFunction(getVisibleMasuk);
  await Promise.all([
    page.waitForSelector('#frminput', { visible: true }), // modal shows
    page.evaluate((fnSource) => {
      const resolver = eval(fnSource);
      const btn = resolver;
      if (btn instanceof HTMLElement) {
        btn.click();
      } else {
        throw new Error('#masuk visible button not found');
      }
    }, getVisibleMasuk)
  ]);

  // 3) Type password inside modal and click Login
  await page.waitForSelector('#vpassword', { visible: true });
  await page.type('#vpassword', account.PASSWORD, { delay: 20 });

  // The "Login" button has id #btnsimpan in the modal
  // After AJAX validation, it submits a hidden form which triggers a navigation.
  await page.waitForSelector('#btnsimpan', { visible: true });
  const navPromise = page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => null);
  await page.evaluate(() => {
    const btn = document.querySelector('#btnsimpan');
    if (btn instanceof HTMLElement) {
      btn.click();
    } else {
      throw new Error('#btnsimpan button not found');
    }
  });
  await navPromise;

  // 4) Go directly to the Jurnal Harian page
  await page.goto(account.SIMPEG_JOURNAL_URL, { waitUntil: 'networkidle2' });

  // 5) Set the date (dd-mm-yyyy) then wait for the table to reload
  const tgl = today_ddmmyyyy(account.JOURNAL_TIMEZONE);
  console.log('Using journal date:', tgl);
  await page.waitForSelector('#tgla');
  await page.$eval('#tgla', (el, val) => { el.value = val; el.dispatchEvent(new Event('change', { bubbles: true })); }, tgl);

  // Wait for list(s) to be populated (any of the tables should render rows or become empty)
  await page.waitForSelector('#data tbody', { visible: true });

  // 6) Open "Tambah" (add journal)
  await Promise.all([
    page.click('#tambah'),
    page.waitForSelector('#editBox', { visible: true })
  ]);

  // 7) Fill the modal form
  await selectWithFallback(page, '#jammulai', account.JAM_MULAI.padStart(2, '0'));
  await selectWithFallback(page, '#menitmulai', account.MENIT_MULAI.padStart(2, '0'));
  await selectWithFallback(page, '#jamselesai', account.JAM_SELESAI.padStart(2, '0'));
  await selectWithFallback(page, '#menitselesai', account.MENIT_SELESAI.padStart(2, '0'));

  // SKP category (fallback to first option if provided value not present)
  await selectWithFallback(page, '#skpkgid', account.SKP_VALUE);

  // Kegiatan
  await page.$eval('#keterangan', (el, val) => { el.value = val; }, account.JOURNAL_TEXT);

  // Numbers
  await page.$eval('#jumlah', (el, val) => { el.value = val; }, account.JUMLAH);
  await page.$eval('#satuan', (el, val) => { el.value = val; }, account.SATUAN);
  await page.$eval('#biaya', (el, val) => { el.value = val; }, account.BIAYA);

  // 8) Save
  // Clicking #btnsimpan closes the modal and triggers AJAX save, then an "Information" modal (#infoBox) appears
  await page.click('#btnsimpan');

  // Wait for info modal and acknowledge
  await page.waitForSelector('#infoBox', { visible: true, timeout: 30000 });
  const infoText = await page.$eval('#infoBox #msgInfo', el => el.innerText.trim());
  console.log('Server message:', infoText);
  await page.click('#infoBox #btnok');

  // 9) Take a proof screenshot
  await new Promise(resolve => setTimeout(resolve, 800)); // tiny settle
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`Saved screenshot => ${screenshotPath}`);

  await browser.close();
}

async function runAll() {
  const accounts = resolveAccounts();
  const results = [];

  for (const [idx, account] of accounts.entries()) {
    console.log('='.repeat(64));
    console.log(`Account ${idx + 1}/${accounts.length} — NIP ${account.NIP}`);
    console.log('='.repeat(64));
    const screenshotPath = screenshotNameFor(account, accounts.length);
    await runForAccount(account, screenshotPath);
    results.push({ screenshotPath });
  }

  const finalScreenshot = results.length > 0 ? results[results.length - 1].screenshotPath : undefined;
  if (results.length > 1 && finalScreenshot && finalScreenshot !== 'proof.png') {
    try {
      fs.copyFileSync(finalScreenshot, 'proof.png');
      console.log(`Copied ${finalScreenshot} to proof.png for compatibility with run.sh`);
    } catch (err) {
      console.warn('Failed to copy consolidated proof.png', err);
    }
  }
}

runAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
