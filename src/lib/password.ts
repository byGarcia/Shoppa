// The implementation lives in `scripts/lib/password.mjs`, not here.
//
// The runner image copies `node_modules`, `prisma`, `ops` and `src/entorno.ts`
// — nothing else from `src`. The password-rescue script and the
// database seed run inside that image with plain `node`, where this file does
// not exist and where the `@/` alias is a tsconfig fiction. So the code sits in
// a plain ESM file that the image copies explicitly, and this module is the door
// the application and its tests come in through: one implementation, both worlds.
export * from "../../scripts/lib/password.mjs";
