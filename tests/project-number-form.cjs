const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/features/projects/numbering.js'), 'utf8');
const series = [
  ['architecture', 'Архитектура', 'Проект №17326', 173],
  ['interior', 'Дизайн интерьера', 'Проект ДИ №3126', 31],
  ['landscape', 'Ландшафт', 'Проект ЛД №126', 1]
];

function form(category, saved) {
  const fields = Object.fromEntries(['name', 'name-label', 'number-prefix', 'number-hint', 'category'].map(key => [key, {}]));
  fields.category.value = category;
  fields.name.value = ' Дом ';
  const context = vm.createContext({
    state: { projects: saved ? [saved] : [] },
    editingProjectId: saved?.id,
    rows: series.map(([category_id, , prefix]) => ({ category_id, prefix })),
    findCategory: id => ({ name: series.find(row => row[0] === id)?.[1] || '' }),
    document: { getElementById: id => fields[id.slice(3)] }
  });
  vm.runInContext(source, context);
  vm.runInContext('nextProjectNumbers = rows', context);
  context.renderProjectNumberField();
  return { fields, context };
}

for (const [category, label, prefix, sequence] of series) {
  test(label + ' — новая карточка показывает только номер', () => {
    const { fields, context } = form(category);
    assert.equal(fields['number-prefix'].textContent, prefix.slice(prefix.indexOf('№')));
    assert.equal(fields.name.disabled, false);
    assert.equal(context.projectNameForSave(), 'Дом');
  });
  test(label + ' — редактирование сохраняет серверную идентичность', () => {
    const { fields, context } = form(category, { id: 'p', number_series: category, number_year: 2026, number_sequence: sequence });
    assert.equal(fields['number-prefix'].textContent, prefix.slice(prefix.indexOf('№')));
    assert.equal(fields.category.disabled, true);
    assert.equal(context.projectNameForSave(), prefix + ' Дом');
  });
}

test('До выбора направления поле названия заблокировано', () => {
  const { fields } = form('');
  assert.equal(fields.name.disabled, true);
  assert.equal(fields['number-prefix'].hidden, true);
});
test('Строительство сохраняет ручное название', () => {
  const { fields, context } = form('construction');
  assert.equal(fields['number-prefix'].hidden, true);
  assert.equal(context.projectNameForSave(), 'Дом');
});
test('Историческая карточка остаётся доступной для редактирования', () => {
  const { fields } = form('architecture', { id: 'old' });
  assert.equal(fields['number-prefix'].hidden, true);
  assert.equal(fields.category.disabled, false);
});
test('После смены направления название сохраняется', () => {
  const { fields, context } = form('architecture');
  fields.category.value = 'interior';
  context.renderProjectNumberField();
  assert.equal(fields['number-prefix'].textContent, '№3126');
  assert.equal(fields.name.value, ' Дом ');
});
test('При потере ответа сервера показана подсказка для повтора', () => {
  const { fields, context } = form('architecture');
  vm.runInContext('nextProjectNumbers = null', context);
  context.renderProjectNumberField();
  assert.match(fields['number-hint'].textContent, /Проверьте|восстановления связи/);
  assert.equal(fields.name.value, ' Дом ');
});
test('Пока номер загружается, форма показывает ожидание', () => {
  const { fields, context } = form('architecture');
  vm.runInContext('nextProjectNumbers = null; projectNumbersRequest = Promise.resolve()', context);
  context.renderProjectNumberField();
  assert.equal(fields['number-prefix'].textContent, 'Загружаем номер…');
});
