// Approved by ARHITTEK owner 2026-11-24. Match only these literal words/phrases,
// not their stems, unrelated synonyms, emojis, or any other previously recognized keywords.
export const INSTAGRAM_CATALOG_KEYWORDS = Object.freeze([
  "проект",
  "хочу проект",
  "проэкт",
  "дом",
  "цена",
  "стоимость",
  "сколько",
  "почём",
  "прайс",
  "план",
  "планировка",
  "размеры",
  "площадь",
  "метраж",
  "купить",
  "покупка",
  "заказать",
  "хочу",
  "каталог",
  "скинь",
  "пришли",
  "отправь",
  "price",
  "project",
  "house",
  "plan",
  "+"
]);
const instagramKeywordMatcher = new RegExp(
  '(?:^|[^\\p{L}\\p{N}_])(?:' +
  INSTAGRAM_CATALOG_KEYWORDS.filter(word => word !== '+').sort((a,b) => b.length-a.length).join('|') +
  ')(?=$|[^\\p{L}\\p{N}_])', 'iu'
);
export const hasProjectKeyword = text => {
  const normalized = String(text ?? '').normalize('NFKC');
  return /^\s*\+\s*$/u.test(normalized) || instagramKeywordMatcher.test(normalized);
};
