// Publish the original, ordered classic scripts/HTML without rewriting any bytes.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name));
const entries = dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true });
const isOutput = name => /^(?:[\w-]+\.(?:html|js|css)|manifest\.json)$/.test(name);

function* sources(dir) {
  for (const entry of entries(dir)) {
    const name = dir + '/' + entry.name;
    if (entry.isDirectory()) yield* sources(name);
    else if (entry.isFile() && name !== 'src/manifest.json' && /\.(html|js|css|json)$/.test(name)) yield name;
  }
}

function build(check) {
  const { version, outputs } = JSON.parse(read('src/manifest.json'));
  if (version !== 1 || !outputs || typeof outputs !== 'object' || Array.isArray(outputs) || !Object.keys(outputs).length) {
    throw new Error('Некорректный src/manifest.json');
  }
  const available = new Set(sources('src'));
  const used = new Set();
  const changed = new Map();
  for (const [name, parts] of Object.entries(outputs)) {
    if (!isOutput(name) || !Array.isArray(parts) || !parts.length || new Set(parts).size !== parts.length) {
      throw new Error('Некорректная цель или список фрагментов: ' + name);
    }
    const expected = Buffer.concat(parts.map(part => {
      if (!available.has(part)) throw new Error(name + ': не найден исходник ' + part);
      used.add(part);
      return read(part);
    }));
    if (!fs.existsSync(path.join(root, name)) || !expected.equals(read(name))) changed.set(name, expected);
  }
  const orphan = [...available].filter(name => !used.has(name));
  if (orphan.length) throw new Error('Исходники вне манифеста: ' + orphan.join(', '));
  const unlisted = entries('.').filter(e => e.isFile() && isOutput(e.name) && !Object.hasOwn(outputs, e.name));
  if (unlisted.length) throw new Error('Публичные файлы вне манифеста: ' + unlisted.map(e => e.name).join(', '));
  if (check && changed.size) {
    throw new Error('Файлы отличаются от исходников или отсутствуют: ' + [...changed.keys()].join(', ') + '. Выполните npm run build.');
  }
  for (const [name, bytes] of changed) fs.writeFileSync(path.join(root, name), bytes);
  console.log('Публичных файлов: %d. Обновлено: %d.', Object.keys(outputs).length, changed.size);
}

try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || args[0] !== '--check')) throw new Error('Использование: node scripts/build.cjs [--check]');
  build(args[0] === '--check');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
