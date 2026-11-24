const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'catalog.html'), 'utf8');
const match = html.match(/function contactUrl\(number,title\)\{[\s\S]*?\n\}/);
assert(match, 'Expected WhatsApp URL formatter in client catalog');

function message(number, title, query = '?utm_source=instagram') {
  const context = {
    URLSearchParams,
    encodeURIComponent,
    location: {search: query},
  };
  vm.createContext(context);
  vm.runInContext(match[0] + '\nthis.getContactUrl = contactUrl;', context);
  const url = new URL(context.getContactUrl(number, title));
  assert.equal(url.origin, 'https://wa.me');
  assert.equal(url.pathname, '/79226593872');
  return url.searchParams.get('text');
}

const cases = [
  {
    number: '13525',
    title: 'Проект №13525 – Двухэтажный дом',
    expected: 'Здравствуйте! Я из Instagram. Меня заинтересовал проект №13525 — Двухэтажный дом из каталога ARHITTEK.',
  },
  {
    number: '13525',
    title: 'Проект №13525 — Двухэтажный дом',
    expected: 'Здравствуйте! Я из Instagram. Меня заинтересовал проект №13525 — Двухэтажный дом из каталога ARHITTEK.',
  },
  {
    number: '13525',
    title: 'Двухэтажный дом',
    expected: 'Здравствуйте! Я из Instagram. Меня заинтересовал проект №13525 — Двухэтажный дом из каталога ARHITTEK.',
  },
  {
    number: '13525',
    title: 'Проект №13525',
    expected: 'Здравствуйте! Я из Instagram. Меня заинтересовал проект №13525 из каталога ARHITTEK.',
  },
  {
    number: 'Проект №13525',
    title: '№13525 — Двухэтажный дом',
    expected: 'Здравствуйте! Я из Instagram. Меня заинтересовал проект №13525 — Двухэтажный дом из каталога ARHITTEK.',
  },
];

for (const c of cases) {
  const actual = message(c.number, c.title);
  assert.equal(actual, c.expected);
  assert.equal((actual.match(/13525/g) || []).length, 1, 'Project number must appear exactly once');
}
assert.equal(message('13525', 'Проект №13525 — Двухэтажный дом', ''), 'Здравствуйте! Меня заинтересовал проект №13525 — Двухэтажный дом из каталога ARHITTEK.');
assert.equal(message('', '', ''), 'Здравствуйте! Пишу из каталога ARHITTEK.');
console.log('Catalog WhatsApp project number: 7 cases passed');
