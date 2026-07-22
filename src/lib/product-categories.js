export const PRODUCT_CATEGORY_ORDER = Object.freeze([
  "Momos Signature",
  "Cajas y Combos",
  "Momos Cuchara",
  "Momos Antojos",
  "Momos Bebidas",
]);

export const PRODUCT_CATEGORY_EMOJI = Object.freeze({
  "Momos Signature": "🐱",
  "Cajas y Combos": "🎁",
  "Momos Cuchara": "🥄",
  "Momos Antojos": "🥞",
  "Momos Bebidas": "🥤",
  Otros: "🍰",
});

const clean = (value) => String(value || "").trim();

export function orderedProductCategories(categories = []) {
  const present = new Set(categories.map(clean).filter(Boolean));
  const canonical = PRODUCT_CATEGORY_ORDER.filter((category) => present.has(category));
  const additional = [...present]
    .filter((category) => !PRODUCT_CATEGORY_ORDER.includes(category))
    .sort((left, right) => left.localeCompare(right, "es"));
  return [...canonical, ...additional];
}

export function groupOrderCatalogChoices(choices = []) {
  const groups = new Map();
  for (const choice of choices) {
    const category = clean(choice?.category || choice?.product?.cat) || "Otros";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(choice);
  }
  return orderedProductCategories([...groups.keys()]).map((category) => ({
    category,
    emoji: PRODUCT_CATEGORY_EMOJI[category] || PRODUCT_CATEGORY_EMOJI.Otros,
    choices: groups.get(category) || [],
  }));
}
