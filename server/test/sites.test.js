// Тесты адаптеров LinkedIn, Upwork и маршрутизатора. Без сети и без браузера:
// bridge подменён, sleep пустой.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createLinkedin } from '../src/sites/linkedin.js';
import { createUpwork } from '../src/sites/upwork.js';
import { createSites } from '../src/sites/index.js';

const noSleep = async () => {};
// waitMs / pollMs = 2 попытки опроса
const opts = { waitMs: 1000, pollMs: 500, sleep: noSleep };

// Ответы evaluate идут по очереди; последний ответ повторяется, когда очередь кончилась.
function fakeBridge(replies) {
  const queue = replies.map((r) => (typeof r === 'string' ? r : JSON.stringify(r)));
  const navigated = [];
  const evaluated = [];
  return {
    navigated,
    evaluated,
    async navigate(url) {
      navigated.push(url);
      return { url, tabId: 1 };
    },
    async evaluate(code) {
      evaluated.push(code);
      return queue.length > 1 ? queue.shift() : queue[0];
    },
  };
}

const LI_EMPTY = { url: 'https://www.linkedin.com/jobs/view/1/', title: 'Dev', company: '', salary: '', description: '' };

describe('linkedin: id parsing', () => {
  test('/jobs/view/<id> gives the id and drops the query', async () => {
    const b = fakeBridge([{ url: 'x', title: 'T', company: 'C', salary: '', description: 'D' }]);
    const v = await createLinkedin(b, opts).getVacancy(
      'https://www.linkedin.com/jobs/view/3912345678/?refId=abc&trk=public',
    );
    assert.equal(v.id, '3912345678');
    assert.equal(v.url, 'https://www.linkedin.com/jobs/view/3912345678/');
    assert.deepEqual(b.navigated, ['https://www.linkedin.com/jobs/view/3912345678/']);
  });

  test('?currentJobId= gives the id and keeps the URL intact', async () => {
    const raw = 'https://www.linkedin.com/jobs/collections/recommended/?currentJobId=3900000001&refId=q';
    const b = fakeBridge([{ url: 'x', title: 'T', company: '', salary: '', description: 'D' }]);
    const v = await createLinkedin(b, opts).getVacancy(raw);
    assert.equal(v.id, '3900000001');
    assert.equal(v.url, raw);
  });

  test('URL without an id gives bad_id and no navigation', async () => {
    const b = fakeBridge([LI_EMPTY]);
    await assert.rejects(createLinkedin(b, opts).getVacancy('https://www.linkedin.com/feed/'), { code: 'bad_id' });
    assert.equal(b.navigated.length, 0);
  });

  test('non-numeric currentJobId and garbage input give bad_id', async () => {
    const li = createLinkedin(fakeBridge([LI_EMPTY]), opts);
    await assert.rejects(li.getVacancy('https://www.linkedin.com/jobs/?currentJobId=abc'), { code: 'bad_id' });
    await assert.rejects(li.getVacancy('not a url'), { code: 'bad_id' });
  });

  test('a foreign host gives bad_id even with a jobs path', async () => {
    const li = createLinkedin(fakeBridge([LI_EMPTY]), opts);
    await assert.rejects(li.getVacancy('https://evil.example/jobs/view/123/'), { code: 'bad_id' });
  });
});

describe('upwork: id parsing', () => {
  test('~<hex> token gives the id and the URL drops the query', async () => {
    const b = fakeBridge([{ url: 'x', title: 'T', company: '', salary: '', description: 'D', skills: [] }]);
    const v = await createUpwork(b, opts).getVacancy(
      'https://www.upwork.com/jobs/Build-Landing-Page_~01abcdef0123/?sort=recency',
    );
    assert.equal(v.id, '~01abcdef0123');
    assert.equal(v.url, 'https://www.upwork.com/jobs/Build-Landing-Page_~01abcdef0123/');
  });

  test('URL without a token gives bad_id and no navigation', async () => {
    const b = fakeBridge([{ url: 'x', title: '', company: '', salary: '', description: 'D', skills: [] }]);
    const up = createUpwork(b, opts);
    await assert.rejects(up.getVacancy('https://www.upwork.com/nx/find-work/'), { code: 'bad_id' });
    await assert.rejects(up.getVacancy('https://www.upwork.com/jobs/Build-Landing-Page/'), { code: 'bad_id' });
    assert.equal(b.navigated.length, 0);
  });
});

describe('getVacancy success', () => {
  test('linkedin waits for a non-empty description, not only a title', async () => {
    const b = fakeBridge([
      { url: 'https://www.linkedin.com/jobs/view/42/', title: 'Senior Dev', company: 'Acme', salary: 'Full-time', description: '' },
      { url: 'https://www.linkedin.com/jobs/view/42/', title: 'Senior Dev', company: 'Acme', salary: 'Full-time · 200k', description: 'Build things' },
    ]);
    const v = await createLinkedin(b, opts).getVacancy('https://www.linkedin.com/jobs/view/42/');
    assert.deepEqual(v, {
      id: '42',
      source: 'linkedin',
      url: 'https://www.linkedin.com/jobs/view/42/',
      title: 'Senior Dev',
      company: 'Acme',
      salary: 'Full-time · 200k',
      experience: '',
      description: 'Build things',
      skills: [],
    });
    assert.equal(b.evaluated.length, 2);
  });

  test('upwork appends skills to the description as the extractor does', async () => {
    const b = fakeBridge([
      { url: 'https://www.upwork.com/jobs/X_~ab12/', title: 'Build', company: '', salary: '', description: '', skills: [] },
      { url: 'https://www.upwork.com/jobs/X_~ab12/', title: 'Build landing', company: 'Client', salary: '$500', description: 'Need a page', skills: ['React', 'CSS'] },
    ]);
    const v = await createUpwork(b, opts).getVacancy('https://www.upwork.com/jobs/X_~ab12/');
    assert.deepEqual(v, {
      id: '~ab12',
      source: 'upwork',
      url: 'https://www.upwork.com/jobs/X_~ab12/',
      title: 'Build landing',
      company: 'Client',
      salary: '$500',
      experience: '',
      description: 'Need a page\n\nSkills: React, CSS',
      skills: [],
    });
  });
});

describe('login redirect', () => {
  for (const url of [
    'https://www.linkedin.com/login?session_redirect=x',
    'https://www.linkedin.com/authwall?trk=x',
    'https://www.linkedin.com/ab/account-security/verify',
  ]) {
    test(`linkedin redirect to ${new URL(url).pathname} gives login_required`, async () => {
      const b = fakeBridge([{ ...LI_EMPTY, url }]);
      await assert.rejects(createLinkedin(b, opts).getVacancy('https://www.linkedin.com/jobs/view/1/'), { code: 'login_required' });
    });
  }

  test('upwork redirect to /login gives login_required', async () => {
    const b = fakeBridge([{ url: 'https://www.upwork.com/login', title: '', company: '', salary: '', description: '', skills: [] }]);
    await assert.rejects(createUpwork(b, opts).getVacancy('https://www.upwork.com/jobs/X_~ab12/'), { code: 'login_required' });
  });
});

describe('timeout', () => {
  test('linkedin with a title but no description times out after the attempts', async () => {
    const b = fakeBridge([LI_EMPTY]);
    await assert.rejects(createLinkedin(b, opts).getVacancy('https://www.linkedin.com/jobs/view/1/'), { code: 'timeout' });
    assert.equal(b.evaluated.length, 2);
  });

  test('upwork without a description times out', async () => {
    const b = fakeBridge([{ url: 'https://www.upwork.com/jobs/X_~ab12/', title: 'Build', company: '', salary: '', description: '', skills: [] }]);
    await assert.rejects(createUpwork(b, opts).getVacancy('https://www.upwork.com/jobs/X_~ab12/'), { code: 'timeout' });
  });
});

describe('createSites routing', () => {
  const sites = createSites(fakeBridge(['{}']), opts);

  test('exposes the three adapters', () => {
    assert.equal(typeof sites.hh.getVacancy, 'function');
    assert.equal(typeof sites.linkedin.getVacancy, 'function');
    assert.equal(typeof sites.upwork.getVacancy, 'function');
  });

  test('forUrl routes by hostname', () => {
    assert.equal(sites.forUrl('https://hh.ru/vacancy/139138141'), sites.hh);
    assert.equal(sites.forUrl('https://spb.hh.ru/vacancy/1'), sites.hh);
    assert.equal(sites.forUrl('https://www.linkedin.com/jobs/view/1/'), sites.linkedin);
    assert.equal(sites.forUrl('https://linkedin.com/jobs/view/1/'), sites.linkedin);
    assert.equal(sites.forUrl('https://www.upwork.com/jobs/X_~ab12/'), sites.upwork);
  });

  test('forUrl returns null for unknown hosts and lookalikes', () => {
    assert.equal(sites.forUrl('https://example.com/vacancy/1'), null);
    assert.equal(sites.forUrl('https://nothh.ru/vacancy/1'), null);
    assert.equal(sites.forUrl('https://hh.ru.example.com/vacancy/1'), null);
    assert.equal(sites.forUrl('https://notlinkedin.com/jobs/view/1/'), null);
    assert.equal(sites.forUrl('https://upwork.com.evil.example/jobs/X_~ab12/'), null);
  });

  test('forUrl returns null for unparseable input', () => {
    assert.equal(sites.forUrl('not a url'), null);
    assert.equal(sites.forUrl(''), null);
    assert.equal(sites.forUrl(undefined), null);
  });

  test('forSource maps the three source strings', () => {
    assert.equal(sites.forSource('hh.ru'), sites.hh);
    assert.equal(sites.forSource('linkedin'), sites.linkedin);
    assert.equal(sites.forSource('upwork'), sites.upwork);
  });

  test('forSource returns null for unknown or inherited names', () => {
    assert.equal(sites.forSource('hh'), null);
    assert.equal(sites.forSource('indeed'), null);
    assert.equal(sites.forSource('constructor'), null);
    assert.equal(sites.forSource('__proto__'), null);
    assert.equal(sites.forSource(undefined), null);
  });
});
