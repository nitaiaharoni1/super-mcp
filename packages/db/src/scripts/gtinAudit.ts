import { closePool, getPool } from "../client/index.js";

/**
 * Read-only measurement of cross-chain product-identity corruption from
 * over-permissive GTIN classification. Run before and after re-ingesting under
 * the tightened isGtinItem to confirm RCN/short-code merges dropped.
 */
async function count(sql: string): Promise<number> {
  const res = await getPool().query<{ c: string }>(sql);
  return Number(res.rows[0]?.c ?? 0);
}

async function main(): Promise<void> {
  const gtinProducts = await count("SELECT count(*) c FROM product WHERE gtin IS NOT NULL");
  const rcnMergedAcrossChains = await count(
    `SELECT count(*) c FROM (
       SELECT p.id FROM product p JOIN listing l ON l.product_id = p.id
       WHERE p.gtin ~ '^0*2[0-9]{5,}'
       GROUP BY p.id HAVING count(DISTINCT l.chain_id) > 1) x`,
  );
  const shortMergedAcrossChains = await count(
    `SELECT count(*) c FROM (
       SELECT p.id FROM product p JOIN listing l ON l.product_id = p.id
       WHERE length(p.gtin) < 12
       GROUP BY p.id HAVING count(DISTINCT l.chain_id) > 1) x`,
  );

  console.log(
    JSON.stringify({
      event: "gtin_audit",
      gtinProducts,
      rcnMergedAcrossChains,
      shortMergedAcrossChains,
    }),
  );
  await closePool();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : String(err));
  await closePool();
  process.exit(1);
});
