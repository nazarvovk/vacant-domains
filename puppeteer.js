// @ts-check
const puppeteer = require('puppeteer');
const fs = require('fs');
const args = require('minimist')(process.argv.slice(2));

const THREADS = args.threads || 10;
const SOURCE_FILE = args.source ||'source.txt';
const OUTPUT_FILE = args.output || 'output.json';

const parseDictionary = async (words) => {
  const browser = await puppeteer.launch({ headless: true });
  process.on('SIGINT', () => browser.close());

  const prepareThread = async () => {
    const page = await browser.newPage();
    await page.goto('https://instantdomainsearch.com/domain/extensions/');
    const input = await page.$('#search');

    /**
     * @function makeRequest
     * @param {string} domainName
     * @returns {Promise<{}[]>}
     */
    const makeRequest = async (domainName) => {
      await input.click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      input.type(domainName);
      const resp = await page.waitForResponse((resp) => {
        const url = resp.request().url();
        return (
          url.includes(domainName) &&
          url.includes('tldTags') &&
          url.includes('/services/name/')
        );
      });
      const text = await resp.text();
      const withCommas = text.replace(/\n/g, ',');
      const json = `[${withCommas.slice(0, withCommas.length - 1)}]`;
      return JSON.parse(json);
    };

    const parseDomain = async (domainName) => {
      try {
        const details = await makeRequest(domainName);
        const available = details.filter((el) => !el.isRegistered);
        const sorted = available.sort((a, b) => b.rank - a.rank);
        const domainNames = sorted.map((el) => el.tld);
        const isComAvailable = domainNames.includes('com');
        if (isComAvailable) console.log(`${domainName}.com is available`);
        // console.log(domainName + ' parsed');
        return domainNames;
      } catch (e) {
        return await parseDomain(domainName);
      }
    };

    return { parseDomain };
  };

  if (!fs.existsSync(OUTPUT_FILE)) {
    fs.writeFileSync(
      OUTPUT_FILE,
      JSON.stringify({
        availableTld: {},
        availableDomains: {},
      })
    );
  }

  const parsed = JSON.parse(fs.readFileSync(OUTPUT_FILE, { encoding: 'utf8' }));
  const parsedWords = Object.keys(parsed.availableDomains);

  /**
   * @type {{parseDomain: Function}[]} pages
   */
  const threads = [];

  console.log('Setting up threads...');
  for (let i = 0; i < THREADS; i++) {
    threads.push(await prepareThread());
  }

  console.log('Starting parsing...');
  let i = 0;
  const enqueueNext = async (thread) => {
    const current = words[i];
    i++;
    if (!parsedWords.includes(current)) {
      const promise = thread.parseDomain(current);
      /** @type {string[]} */
      const tldList = await promise;
      parsedWords.push(current);
      const allData = JSON.parse(
        fs.readFileSync(OUTPUT_FILE, { encoding: 'utf8' })
      );
      allData.availableDomains[current] = tldList.slice(0, 3);
      if (tldList.includes('com')) {
        allData.availableTld.com = [
          ...(allData.availableTld.com || []),
          current,
        ];
      }
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allData));
    }
    enqueueNext(thread);
  };

  threads.forEach(async (thread) => {
    await enqueueNext(thread);
  });
};

fs.readFile(SOURCE_FILE, 'utf8', async (err, data) => {
  if (err) throw err;
  const dictionary = data.split('\n');
  console.log('dictionary length: ', dictionary.length);
  parseDictionary(dictionary);
});
