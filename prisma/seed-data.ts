/**
 * What a fresh installation is born with: the twelve factory categories and the
 * starting categorization dictionary, in Spanish and English. No stores — those
 * belong to each household. prisma/seed.ts is the only writer.
 *
 * The ids are literal and load-bearing: src/lib/category-visuals.ts keys the
 * colour palette off these exact strings, so a fresh installation only gets the
 * intended colours if the seed reuses them. They double as translation keys —
 * a category's name_key is its id — which is why there is no separate field.
 *
 * `es` values must match, character for character, what an existing
 * installation holds for an un-renamed category — the migration's name_key
 * back-fill compares against them. They were read from a production
 * installation on 2026-09-02 and recorded in prisma/factory-categories.md; the
 * icon of Congelados is U+2744 U+FE0F, with its variation selector.
 *
 * Data only, and deliberately free of any Prisma import: the seed runs from the
 * runner image, which never receives the generated client, so it reads this
 * module and writes through `pg` instead.
 */
export interface FactoryCategory {
  id: string;
  es: string;
  en: string;
  icon: string | null;
  order: number;
}

export const FACTORY_CATEGORIES: FactoryCategory[] = [
  {
    id: "gcat-frutas-verduras",
    es: "Frutas y verduras",
    en: "Fruit & veg",
    icon: "🥬",
    order: 1,
  },
  {
    id: "gcat-carne-pescado",
    es: "Carne y pescado",
    en: "Meat & fish",
    icon: "🥩",
    order: 2,
  },
  {
    id: "gcat-lacteos",
    es: "Lácteos",
    en: "Dairy",
    icon: "🥛",
    order: 3,
  },
  {
    id: "gcat-panaderia",
    es: "Panadería",
    en: "Bakery",
    icon: "🥖",
    order: 4,
  },
  {
    id: "gcat-congelados",
    es: "Congelados",
    en: "Frozen",
    icon: "❄️",
    order: 5,
  },
  {
    id: "gcat-bebidas",
    es: "Bebidas",
    en: "Drinks",
    icon: "🥤",
    order: 6,
  },
  {
    id: "gcat-despensa",
    es: "Despensa",
    en: "Pantry",
    icon: "🥫",
    order: 7,
  },
  {
    id: "gcat-limpieza",
    es: "Limpieza",
    en: "Cleaning",
    icon: "🧴",
    order: 8,
  },
  {
    id: "gcat-higiene",
    es: "Higiene",
    en: "Personal care",
    icon: "🧼",
    order: 9,
  },
  {
    id: "gcat-hogar",
    es: "Hogar",
    en: "Household",
    icon: "🏠",
    order: 10,
  },
  {
    id: "gcat-mascotas",
    es: "Mascotas",
    en: "Pets",
    icon: "🐾",
    order: 11,
  },
  {
    id: "gcat-otros",
    es: "Otros",
    en: "Other",
    icon: "📦",
    order: 12,
  },
];

/**
 * One word-to-category pair of the starting dictionary.
 *
 * `normalizedName` is a key, not a label: it is stored in the form
 * src/lib/grocery-match.ts produces — lowercase, unaccented, unpunctuated and
 * naively singularised — because that is the form the matcher compares against.
 * A few entries therefore read as odd singulars ("frozen pea", "olive"); that is
 * the normalizer's spelling, and writing the plural instead would leave the
 * entry reachable only through the fuzzy pass, or not at all.
 */
export interface FactoryHint {
  normalizedName: string;
  categoryId: string;
}

// Keyed by factory category id. prisma/seed.test.ts checks that every key is
// one of the twelve — a typo here would otherwise cost a silently skipped row.
type HintsByCategory = Record<string, string[]>;

/**
 * Spanish: 261 pairs exported from a household installation on 2026-09-02 and
 * reviewed one by one — generic supermarket vocabulary only, no brands and no
 * proper nouns. One row whose category was null was dropped: a hint that points
 * nowhere teaches the matcher nothing.
 */
const HINTS_ES: HintsByCategory = {
  "gcat-frutas-verduras": [
    "acelga", "aguacate", "ajo", "alcachofa", "apio", "berenjena", "boniato", "brocoli",
    "calabacin", "calabaza", "canonigo", "cebolla", "cereza", "champinon", "cilantro",
    "ciruela", "col", "coliflor", "esparrago", "espinaca", "fresa", "granada", "jengibre",
    "judia verde", "kiwi", "lechuga", "limon", "mandarina", "mango", "manzana", "melocoton",
    "melon", "naranja", "nectarina", "patata", "pepino", "pera", "perejil", "pimiento",
    "pina", "platano", "puerro", "rucula", "sandia", "seta", "tomate", "uva", "zanahoria",
  ],
  "gcat-carne-pescado": [
    "alita", "almeja", "atun fresco", "bacalao", "bacon", "boqueron", "calamar",
    "carne picada", "cerdo", "chorizo", "chuleta", "conejo", "cordero", "costilla", "dorada",
    "fuet", "gamba", "hamburguesa", "jamon", "jamon serrano", "jamon york", "langostino",
    "lomo", "lubina", "mejillon", "merluza", "muslo de pollo", "pavo", "pechuga de pollo",
    "pescado", "pollo", "pulpo", "rape", "salchicha", "salchichon", "salmon", "sardina",
    "sepia", "solomillo", "ternera",
  ],
  "gcat-lacteos": [
    "batido", "cuajada", "flan", "huevo", "kefir", "leche", "leche condensada",
    "mantequilla", "margarina", "mozzarella", "nata", "natilla", "queso", "queso crema",
    "queso fresco", "queso rallado", "requeson", "yogur",
  ],
  "gcat-panaderia": [
    "baguette", "barra de pan", "bizcocho", "bolleria", "croissant", "magdalena", "pan",
    "pan de molde", "pan integral", "pan rallado", "pico", "tortilla de trigo", "tostada",
  ],
  "gcat-congelados": [
    "bola de pollo congelada", "croqueta", "empanadilla", "guisante congelado", "helado",
    "hielo", "patata congelada", "pescado congelado", "pizza congelada", "verdura congelada",
  ],
  "gcat-bebidas": [
    "agua", "agua con gas", "cacao soluble", "cafe", "cafe molido", "capsula de cafe",
    "cerveza", "cola", "horchata", "infusion", "mosto", "refresco", "sidra", "te", "tonica",
    "vino", "vino blanco", "vino tinto", "zumo",
  ],
  "gcat-despensa": [
    "aceite", "aceite de girasol", "aceite de oliva", "aceituna", "almendra", "alubia",
    "arroz", "atun", "azucar", "cacahuete", "cacao en polvo", "caldo", "canela", "caramelo",
    "cereal", "chicle", "chocolate", "comino", "conserva", "espagueti", "fideo", "galleta",
    "garbanzo", "gominola", "harina", "ketchup", "lenteja", "levadura", "macarron",
    "mayonesa", "mermelada", "miel", "mostaza", "nuez", "oregano", "pasta", "patata frita",
    "pimenton", "pipa", "pure", "sal", "salsa de soja", "sardina en lata", "sopa",
    "tomate frito", "tomate triturado", "turron", "vinagre",
  ],
  "gcat-limpieza": [
    "abrillantador", "ambientador", "amoniaco", "basura", "bayeta", "desengrasante",
    "detergente", "escoba", "estropajo", "fregona", "friegasuelos", "guante de goma",
    "insecticida", "lavavajillas", "lejia", "limpiacristales", "papel de cocina",
    "quitamanchas", "suavizante",
  ],
  "gcat-higiene": [
    "acondicionador", "algodon", "bastoncillo", "cepillo de dientes", "champu", "colonia",
    "colutorio", "compresa", "crema hidratante", "desodorante", "espuma de afeitar", "gel",
    "gel de ducha", "gomina", "jabon", "jabon de manos", "laca", "maquinilla", "panal",
    "papel higienico", "pasta de dientes", "protector solar", "tampon", "tinte", "toallita",
  ],
  "gcat-hogar": [
    "boligrafo", "bombilla", "cerilla", "cinta adhesiva", "film transparente", "folio",
    "mechero", "papel de aluminio", "papel de horno", "percha", "pila", "pinza",
    "servilleta", "tupper", "vela",
  ],
  "gcat-mascotas": [
    "antiparasitario", "arena de gato", "comida de gato", "comida de perro", "pienso",
    "snack de perro",
  ],

};

/**
 * English: written from scratch rather than translated, because the word a
 * shopper types is not the translation of the word the other one types —
 * "washing up liquid" is not what "lavavajillas" would give, and half the list
 * has no Spanish counterpart at all. Both spellings of the divided words are
 * here ("courgette" and "zucchini", "aubergine" and "eggplant", "cilantro" and
 * "coriander", "nappies" and "diapers"): the dictionary costs one row per word
 * and a missed word costs no category at all.
 *
 * Some words are here twice, singular and plural ("egg" and "eggs",
 * "strawberry" and "strawberries"). That is not redundancy: the normalizer's
 * singulariser is Spanish, so it turns "-ies" into "-ie" and leaves short
 * plurals like "buns" alone, and the fuzzy pass refuses to bridge either. One
 * row is the whole cost of the word people actually type.
 */
const HINTS_EN: HintsByCategory = {
  "gcat-frutas-verduras": [
    "apple", "arugula", "aubergine", "avocado", "banana", "basil", "beetroot", "bell pepper",
    "blueberries", "blueberry", "broccoli", "cabbage", "carrot", "cauliflower", "celery",
    "cherries", "cherry", "cilantro", "coriander", "courgette", "cucumber", "eggplant",
    "garlic", "ginger", "grape", "green bean", "kale", "kiwi", "leek", "lemon", "lettuce",
    "lime", "mango", "melon", "mushroom", "onion", "orange", "parsley", "peach", "pear",
    "pineapple", "plum", "potato", "pumpkin", "raspberries", "raspberry", "rocket", "salad",
    "scallion", "spinach", "spring onion", "strawberries", "strawberry", "sweet potato",
    "sweetcorn", "tomato", "watermelon", "zucchini",
  ],
  "gcat-carne-pescado": [
    "anchovies", "anchovy", "bacon", "beef", "burger", "chicken", "chicken breast",
    "chicken thigh", "chicken wings", "clam", "cod", "crab", "duck", "fish", "fish fillet",
    "fresh tuna", "ground beef", "hake", "ham", "lamb", "liver", "mackerel", "meatballs",
    "mince", "mussel", "octopus", "pork", "pork chop", "prawn", "rabbit", "ribs", "salami",
    "salmon", "sausage", "scallop", "sea bass", "seafood", "shrimp", "squid", "steak",
    "trout", "turkey", "veal",
  ],
  "gcat-lacteos": [
    "butter", "cheddar", "cheese", "cream", "cream cheese", "custard", "egg", "eggs", "feta",
    "grated cheese", "greek yogurt", "kefir", "margarine", "milk", "mozzarella", "oat milk",
    "parmesan", "sour cream", "whipped cream", "yoghurt", "yogurt",
  ],
  "gcat-panaderia": [
    "bagel", "bread", "bread roll", "breadcrumbs", "brioche", "bun", "buns", "cake",
    "doughnut", "muffin", "pastries", "pastry", "pitta bread", "sliced bread", "sourdough",
    "toast", "tortilla wrap", "wholemeal bread",
  ],
  "gcat-congelados": [
    "fish fingers", "frozen berries", "frozen chicken", "frozen chips", "frozen fish",
    "frozen pea", "frozen pizza", "frozen vegetables", "ice", "ice cream", "ice lolly",
  ],
  "gcat-bebidas": [
    "beer", "cider", "coffee", "coffee beans", "coffee pods", "cola", "energy drink",
    "fizzy drink", "ground coffee", "juice", "lemonade", "orange juice", "red wine", "soda",
    "soft drink", "sparkling water", "tea", "tea bags", "tonic water", "water", "white wine",
    "wine",
  ],
  "gcat-despensa": [
    "almond", "baked beans", "baking powder", "biscuit", "black pepper", "candy", "cereal",
    "chewing gum", "chickpea", "chocolate", "cinnamon", "cocoa powder", "coconut milk",
    "cookie", "cooking oil", "cracker", "crisps", "curry powder", "flour", "honey",
    "hot sauce", "jam", "lentil", "mayonnaise", "mustard", "noodle", "oats", "olive",
    "olive oil", "oregano", "paprika", "pasta", "peanut", "peanut butter", "pesto", "rice",
    "salt", "sardines in oil", "soup", "soy sauce", "spaghetti", "stock cube", "sugar",
    "sunflower oil", "sweets", "tinned tomatoes", "tomato puree", "tomato sauce", "tuna",
    "vinegar", "walnut",
  ],
  "gcat-limpieza": [
    "air freshener", "bin bags", "bleach", "broom", "cleaning cloth", "descaler",
    "dish soap", "dishwasher tablets", "disinfectant", "fabric softener", "floor cleaner",
    "glass cleaner", "insect spray", "kitchen roll", "laundry detergent", "mop",
    "oven cleaner", "paper towels", "rubber gloves", "scourer", "sponge", "trash bags",
    "washing up liquid",
  ],
  "gcat-higiene": [
    "aftershave", "body lotion", "conditioner", "cotton buds", "cotton pads", "deodorant",
    "diapers", "face cream", "hair dye", "hair gel", "hairspray", "hand soap", "moisturiser",
    "moisturizer", "mouthwash", "nappies", "perfume", "razor", "razor blades",
    "sanitary pads", "shampoo", "shaving foam", "shower gel", "soap", "sun cream", "tampons",
    "tissues", "toilet paper", "toilet roll", "toothbrush", "toothpaste", "wet wipes",
  ],
  "gcat-hogar": [
    "aluminium foil", "aluminum foil", "baking paper", "batteries", "candle", "cling film",
    "clothes pegs", "coat hanger", "glue", "light bulb", "lighter", "matches", "notebook",
    "paper napkins", "pen", "pens", "plastic wrap", "sandwich bags", "sticky tape",
    "storage box", "storage boxes", "tin foil",
  ],
  "gcat-mascotas": [
    "bird seed", "cat food", "cat litter", "dog food", "dog treats", "flea treatment",
    "pet food",
  ],
};

function flatten(byCategory: HintsByCategory): FactoryHint[] {
  return Object.entries(byCategory).flatMap(([categoryId, names]) =>
    names.map((normalizedName) => ({ normalizedName, categoryId })),
  );
}

export const FACTORY_HINTS_ES: FactoryHint[] = flatten(HINTS_ES);
export const FACTORY_HINTS_EN: FactoryHint[] = flatten(HINTS_EN);

/**
 * The two languages in one table, because the table has no language column and
 * needs none: `normalized_name` is unique, a household writes its list in
 * whichever words it likes, and a bilingual house gets both. Thirteen words are
 * spelled the same in both lists ("chocolate", "kiwi", "salmon"…) and Spanish
 * wins those by arriving first — they agree on the category anyway, and
 * prisma/seed.test.ts fails if a future edit makes them disagree.
 */
export const FACTORY_HINTS: FactoryHint[] = (() => {
  const seen = new Set<string>();
  return [...FACTORY_HINTS_ES, ...FACTORY_HINTS_EN].filter((hint) => {
    if (seen.has(hint.normalizedName)) return false;
    seen.add(hint.normalizedName);
    return true;
  });
})();
