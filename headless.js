const fs = require('fs');
const fetch = require('node-fetch');
const args = require('minimist')(process.argv.slice(2));

const THREADS = args.threads || 100;
const SOURCE_FILE = args.source || 'source.txt';
const OUTPUT_FILE = args.output || 'output.json';

/**
 *
 * @param {string[]} dictionary
 */
const parseDictionary = async (dictionary) => {
  let isFullParsed = false;

  const prepareThread = () => {
    const isAvailableOnHover = async (domain) => {
      try {
        const res = await fetch(
          `https://www.hover.com/api/lookup?q=${domain}.com&exact_search=${domain}.com`,
          {
            method: 'GET',
            mode: 'cors',
          }
        );
        const data = await res.json();
        const result = !data.taken.includes(domain + '.com');
        return result;
      } catch (e) {
        return false;
      }
    };

    const makeRequest = async (domainName) => {
      const resp = await fetch(
        `https://instantdomainsearch.com/services/name/${domainName}?hash=${hash(
          domainName
        )}&limit=1000&tldTags=all&country=&city=`,
        {
          credentials: 'omit',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:81.0) Gecko/20100101 Firefox/81.0',
            Accept: '*/*',
            'Accept-Language': 'en-US,ru-RU;q=0.8,ru;q=0.5,en;q=0.3',
          },
          referrer: 'https://instantdomainsearch.com/domain/extensions/',
          method: 'GET',
        }
      );

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
        const isComPotentiallyAvailable = domainNames.includes('com');
        const isComAvailable = isComPotentiallyAvailable
          ? isAvailableOnHover(domainName)
          : false;
        if (await isComAvailable) console.log(`${domainName}.com is available`);
        return domainNames;
      } catch (e) {
        console.log('e: ', e);
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
  const left = dictionary.length - parsedWords.length;
  console.log('Left to parse: ', left);
  if (left <= 0) {
    console.log('Full list parsed');
    return;
  }
  /**
   * @type {{parseDomain: Function}[]} pages
   */
  const threads = [];

  console.log('Setting up threads...');
  for (let i = 0; i < THREADS; i++) {
    threads.push(prepareThread());
  }
  console.log('Set up ' + threads.length + ' threads');

  console.log('Starting parsing...');
  let i = 0;
  const enqueueNext = async (thread) => {
    const current = dictionary[i] && dictionary[i].toLowerCase();
    if (!current) {
      if (!isFullParsed) {
        console.log('Full list parsed');
        isFullParsed = true;
      }
      return;
    }
    i++;
    if (!parsedWords.includes(current)) {
      const promise = thread.parseDomain(current);
      /** @type {string[]} */
      const tldList = await promise;
      parsedWords.push(current);
      const allData = JSON.parse(
        fs.readFileSync(OUTPUT_FILE, { encoding: 'utf8' })
      );
      allData.availableDomains[current] = tldList.slice(0, 2);
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
  const dictionary = data.split('\n').filter((w) => w.length < 8);
  console.log('dictionary.length: ', dictionary.length);
  parseDictionary(dictionary).catch(console.error);
});

function hash(e, t = 42) {
  void 0 === t && (t = 0);
  for (var n = t, r = e.length, o = 0; o < r; o += 1)
    (n = (n << 5) - n + e.charCodeAt(o)), (n &= n);
  return n;
}
