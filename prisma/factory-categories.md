# Categorías de fábrica

Las doce categorías con las que se siembra una instalación nueva, tal y como
estaban en una instalación en producción el 2026-09-02, leídas con la consulta
de solo lectura `SELECT id, name, icon, "order" FROM grocery_categories ORDER BY "order"`.

De ahí le viene la autoridad a este fichero: estas filas son un dato observado,
no una lista que alguien redactara aquí. `prisma/seed-data.ts` y el relleno de
`name_key` de la migración se contrastan contra él en `prisma/migration.test.ts`,
porque los dos tienen que coincidir carácter a carácter con lo que una
instalación existente ya guarda.

Ninguna de las doce estaba renombrada, así que ahí el relleno de `name_key` las
reclama todas. La condición `AND name = '<canónico>'` sigue haciendo falta por
las demás instalaciones: donde alguien haya renombrado una categoría, esa se
queda sin clave y conserva el nombre que su hogar eligió.

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

El icono de Congelados son dos puntos de código, no uno: ❄️ es U+2744 seguido del
selector de variación U+FE0F.

Los nombres en inglés se escriben de cero, no se traducen palabra por palabra:
Fruit & veg / Meat & fish / Dairy / Bakery / Frozen / Drinks / Pantry / Cleaning /
Personal care / Household / Pets / Other.

---

*Este fichero es la referencia, no un resumen del código. Si discrepa de
`prisma/seed-data.ts` o de la migración, quien se equivoca es el código: no se
edita para que las pruebas pasen.*
