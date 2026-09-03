# Factory categories

The twelve categories a fresh installation is seeded with, exactly as they stood
in a production installation on 2026-09-02, read with the read-only query
`SELECT id, name, icon, "order" FROM grocery_categories ORDER BY "order"`.

That is where this file's authority comes from: these rows are an observation,
not a list somebody drafted here. `prisma/seed-data.ts` and the migration's
`name_key` back-fill are checked against it in `prisma/migration.test.ts`,
because both have to match, character for character, what an existing
installation already stores.

None of the twelve had been renamed, so in that installation the `name_key`
back-fill claims all of them. The `AND name = '<canonical>'` condition is still
needed for every other installation: where somebody has renamed a category, that
one is left without a key and keeps the name their household chose.

The `name (es)` column below is product data, not prose — it is the Spanish half
of a bilingual interface, and `prisma/migration.test.ts` parses these rows.

| id | name (es) | icon | order |
|---|---|---|---|
| gcat-frutas-verduras | Frutas y verduras | 🥬 | 1 |
| gcat-carne-pescado | Carne y pescado | 🥩 | 2 |
| gcat-lacteos | Lácteos | 🥛 | 3 |
| gcat-panaderia | Panadería | 🥖 | 4 |
| gcat-congelados | Congelados | ❄️ | 5 |
| gcat-bebidas | Bebidas | 🥤 | 6 |
| gcat-despensa | Despensa | 🥫 | 7 |
| gcat-limpieza | Limpieza | 🧴 | 8 |
| gcat-higiene | Higiene | 🧼 | 9 |
| gcat-hogar | Hogar | 🏠 | 10 |
| gcat-mascotas | Mascotas | 🐾 | 11 |
| gcat-otros | Otros | 📦 | 12 |

The Frozen icon is two code points, not one: ❄️ is U+2744 followed by the
variation selector U+FE0F.

The English names are written from scratch, not translated word by word:
Fruit & veg / Meat & fish / Dairy / Bakery / Frozen / Drinks / Pantry / Cleaning /
Personal care / Household / Pets / Other.

---

*This file is the reference, not a summary of the code. If it disagrees with
`prisma/seed-data.ts` or with the migration, the code is what is wrong: this
file is not edited to make the tests pass.*
