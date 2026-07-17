import { closePool, getPool } from "../client/index.js";
import { runMigrations } from "../schema/migrate.js";

runMigrations(getPool(), {
  onProgress: ({ type, id }) => {
    console.log(type === "applied" ? `applied ${id}` : `skip ${id}`);
  },
})
  .then(async () => {
    await closePool();
    console.log("migrations complete");
  })
  .catch(async (err) => {
    console.error(err);
    await closePool();
    process.exit(1);
  });
