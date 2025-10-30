// index.js
import 'dotenv/config';
import puppeteer from 'puppeteer';

const {
  SIMPEG_LOGIN_URL = 'https://simpeg.kemenkum.go.id/devp/siap/signin.php',
  SIMPEG_JOURNAL_URL = 'https://simpeg.kemenkum.go.id/devp/siap/skp_journal.php',
  NIP,
  PASSWORD,
  JOURNAL_TEXT = 'Melaksanakan tugas IT sesuai SKP',
  JAM_MULAI = '06',
  MENIT_MULAI = '25',
  JAM_SELESAI = '17',
  MENIT_SELESAI = '35',
  JUMLAH = '1',
  SATUAN = '1',
  BIAYA = '0',
  // SKP pilihan: 'lainlain' | '2' (Tugas Tambahan) | '3' (Kreatifitas) | atau value lain yang tersedia
  SKP_VALUE = 'lainlain',
  HEADLESS = 'true',
  JOURNAL_TIMEZONE = 'Asia/Jakarta'
} = process.env;

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

async function run() {
  if (!NIP || !PASSWORD) {
    console.error('Please set NIP and PASSWORD in .env');
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    headless: HEADLESS === 'true',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1366, height: 900 }
  });

  const page = await browser.newPage();
  try {
    await page.emulateTimezone(JOURNAL_TIMEZONE);
  } catch (err) {
    console.warn(`Failed to emulate browser timezone "${JOURNAL_TIMEZONE}". Continuing with default timezone.`, err);
  }

  // 1) Open login page
  await page.goto(SIMPEG_LOGIN_URL, { waitUntil: 'networkidle2' });

  // 2) Type NIP, click "Masuk" to open password modal
  await page.waitForSelector('#user_nip', { visible: true });
  await page.type('#user_nip', NIP, { delay: 20 });
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
  await page.type('#vpassword', PASSWORD, { delay: 20 });

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
  await page.goto(SIMPEG_JOURNAL_URL, { waitUntil: 'networkidle2' });

  // 5) Set the date (dd-mm-yyyy) then wait for the table to reload
  const tgl = today_ddmmyyyy(JOURNAL_TIMEZONE);
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
  await selectWithFallback(page, '#jammulai', JAM_MULAI.padStart(2, '0'));
  await selectWithFallback(page, '#menitmulai', MENIT_MULAI.padStart(2, '0'));
  await selectWithFallback(page, '#jamselesai', JAM_SELESAI.padStart(2, '0'));
  await selectWithFallback(page, '#menitselesai', MENIT_SELESAI.padStart(2, '0'));

  // SKP category (fallback to first option if provided value not present)
  await selectWithFallback(page, '#skpkgid', SKP_VALUE);

  // Kegiatan
  await page.$eval('#keterangan', (el, val) => { el.value = val; }, JOURNAL_TEXT);

  // Numbers
  await page.$eval('#jumlah', (el, val) => { el.value = val; }, JUMLAH);
  await page.$eval('#satuan', (el, val) => { el.value = val; }, SATUAN);
  await page.$eval('#biaya', (el, val) => { el.value = val; }, BIAYA);

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
  await page.screenshot({ path: 'proof.png', fullPage: true });
  console.log('Saved screenshot => proof.png');

  await browser.close();
}

run().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
