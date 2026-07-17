/**
 * Seeds demo data so API/MCP work without live feed pulls.
 * Real ingestion upserts into the same schema.
 */
import { closePool, getPool, withTransaction } from "../client/index.js";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

async function seed(): Promise<void> {
  const pool = getPool();

  await withTransaction(async (client) => {
    await client.query(`
      INSERT INTO chain (id, source_id, market, name_he, name_en)
      VALUES
        ('7290027600007', 'il-shufersal', 'IL', 'שופרסל', 'Shufersal'),
        ('7290058140886', 'il-cerberus', 'IL', 'רמי לוי', 'Rami Levy'),
        ('7290803800003', 'il-cerberus', 'IL', 'יוחננוף', 'Yohananof'),
        ('7290103152017', 'il-cerberus', 'IL', 'אושר עד', 'Osher Ad'),
        ('7290873255550', 'il-cerberus', 'IL', 'טיב טעם', 'Tiv Taam')
      ON CONFLICT (id) DO UPDATE SET name_he = EXCLUDED.name_he, updated_at = now();
    `);

    const stores = [
      { chain: "7290027600007", code: "001", name: "שופרסל דיל תל אביב", city: "תל אביב", address: "דיזנגוף 50", lat: 32.078, lng: 34.774 },
      { chain: "7290027600007", code: "042", name: "שופרסל שלי ירושלים", city: "ירושלים", address: "יפו 100", lat: 31.785, lng: 35.213 },
      { chain: "7290058140886", code: "001", name: "רמי לוי תל אביב", city: "תל אביב", address: "הארבעה 19", lat: 32.07, lng: 34.786 },
      { chain: "7290058140886", code: "012", name: "רמי לוי חיפה", city: "חיפה", address: "הנשיא 10", lat: 32.82, lng: 34.99 },
      { chain: "7290803800003", code: "003", name: "יוחננוף ראשון לציון", city: "ראשון לציון", address: "רוטשילד 1", lat: 31.97, lng: 34.79 },
      { chain: "7290103152017", code: "007", name: "אושר עד פתח תקווה", city: "פתח תקווה", address: "ז'בוטינסקי 5", lat: 32.09, lng: 34.88 },
      { chain: "7290873255550", code: "002", name: "טיב טעם הרצליה", city: "הרצליה", address: "סוקולוב 20", lat: 32.16, lng: 34.84 },
    ];

    for (const s of stores) {
      await client.query(
        `INSERT INTO store (chain_id, store_code, name, address, city, lat, lng)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (chain_id, store_code) DO UPDATE SET
           name = EXCLUDED.name, city = EXCLUDED.city, address = EXCLUDED.address,
           lat = EXCLUDED.lat, lng = EXCLUDED.lng, updated_at = now()`,
        [s.chain, s.code, s.name, s.address, s.city, s.lat, s.lng],
      );
    }

    const products = [
      { gtin: "7290000173199", name: "חלב תנובה 3% 1 ליטר", brand: "תנובה", qty: 1000, unit: "ml", cat1: "dairy", cat2: "milk" },
      { gtin: "7290110114853", name: "קוטג' 5% תנובה 250 גרם", brand: "תנובה", qty: 250, unit: "g", cat1: "dairy", cat2: "cheese" },
      { gtin: "7290003029776", name: "לחם אחיד פרוס 750 גרם", brand: "אנגל", qty: 750, unit: "g", cat1: "bakery", cat2: "bread" },
      { gtin: "7290112490463", name: "שמן זית כתית מעולה יד מרדכי 750 מ\"ל", brand: "יד מרדכי", qty: 750, unit: "ml", cat1: "pantry", cat2: "oil" },
      { gtin: "7290000066323", name: "ביצים L ארוז 12 יח", brand: "תנובה", qty: 12, unit: "unit", cat1: "dairy", cat2: "eggs" },
      { gtin: "7290119381234", name: "אורז בסמטי סוגת 1 ק\"ג", brand: "סוגת", qty: 1000, unit: "g", cat1: "pantry", cat2: "rice" },
      { gtin: "7290004135076", name: "פסטה ספגטי אסם 500 גרם", brand: "אסם", qty: 500, unit: "g", cat1: "pantry", cat2: "pasta" },
      { gtin: "7290110571234", name: "קפה נמס עלית 200 גרם", brand: "עלית", qty: 200, unit: "g", cat1: "pantry", cat2: "coffee" },
      { gtin: "7290005431877", name: "נייר טואלט לילי 24 גלילים", brand: "לילי", qty: 24, unit: "unit", cat1: "household", cat2: "paper" },
      { gtin: "7290019056123", name: "מיץ תפוזים פריגת 1.5 ליטר", brand: "פריגת", qty: 1500, unit: "ml", cat1: "drinks", cat2: "juice" },
      { gtin: "7290004681223", name: "יוגורט דנונה טבעי 8*150ג", brand: "דנונה", qty: 1200, unit: "g", cat1: "dairy", cat2: "yogurt" },
      { gtin: "7290112345678", name: "חומוס אחלה 750 גרם", brand: "אחלה", qty: 750, unit: "g", cat1: "refrigerated", cat2: "salads" },
      { gtin: "7290008765432", name: "טחינה גולמית יד מרדכי 500ג", brand: "יד מרדכי", qty: 500, unit: "g", cat1: "pantry", cat2: "spreads" },
      { gtin: "7290011122334", name: "עגבניות שרי ארוז 500ג", brand: null, qty: 500, unit: "g", cat1: "produce", cat2: "vegetables" },
      { gtin: "7290099887766", name: "בננה בתפזורת", brand: null, qty: 1000, unit: "g", cat1: "produce", cat2: "fruit" },
    ] as const;

    const productIds = new Map<string, string>();
    for (const p of products) {
      const res = await client.query<{ id: string }>(
        `INSERT INTO product (gtin, name, brand, category_l1, category_l2, size_qty, size_unit)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (gtin) DO UPDATE SET
           name = EXCLUDED.name, brand = EXCLUDED.brand,
           category_l1 = EXCLUDED.category_l1, category_l2 = EXCLUDED.category_l2,
           size_qty = EXCLUDED.size_qty, size_unit = EXCLUDED.size_unit, updated_at = now()
         RETURNING id`,
        [p.gtin, p.name, p.brand, p.cat1, p.cat2, p.qty, p.unit === "ml" ? "ml" : p.unit === "g" ? "g" : "unit"],
      );
      productIds.set(p.gtin, res.rows[0]!.id);
    }

    // Per-chain listings + store prices with slight variance
    const chainIds = ["7290027600007", "7290058140886", "7290803800003", "7290103152017", "7290873255550"];
    const basePrices: Record<string, number> = {
      "7290000173199": 7.9,
      "7290110114853": 5.5,
      "7290003029776": 8.9,
      "7290112490463": 32.9,
      "7290000066323": 14.9,
      "7290119381234": 12.9,
      "7290004135076": 6.5,
      "7290110571234": 28.9,
      "7290005431877": 39.9,
      "7290019056123": 11.9,
      "7290004681223": 15.9,
      "7290112345678": 13.5,
      "7290008765432": 16.9,
      "7290011122334": 12.9,
      "7290099887766": 7.9,
    };

    const storeRows = await client.query<{ id: string; chain_id: string; store_code: string; city: string }>(
      `SELECT id, chain_id, store_code, city FROM store`,
    );

    let listingCount = 0;
    for (const chainId of chainIds) {
      for (const p of products) {
        const productId = productIds.get(p.gtin)!;
        const unitPrice =
          p.unit === "unit"
            ? basePrices[p.gtin]! / p.qty
            : (basePrices[p.gtin]! / p.qty) * 100;

        const listingRes = await client.query<{ id: string }>(
          `INSERT INTO listing (
             product_id, chain_id, item_code, item_type, is_gtin, name, brand,
             qty, unit, canonical_qty, canonical_unit, measure_unparseable
           ) VALUES ($1,$2,$3,1,true,$4,$5,$6,$7,$8,$9,false)
           ON CONFLICT (chain_id, item_code) DO UPDATE SET
             product_id = EXCLUDED.product_id, name = EXCLUDED.name,
             brand = EXCLUDED.brand, updated_at = now()
           RETURNING id`,
          [
            productId,
            chainId,
            p.gtin,
            p.name,
            p.brand,
            p.qty,
            p.unit,
            p.unit === "unit" ? p.qty : p.qty,
            p.unit === "ml" ? "ml" : p.unit === "g" ? "g" : "unit",
          ],
        );
        const listingId = listingRes.rows[0]!.id;
        listingCount++;

        for (const store of storeRows.rows.filter((s) => s.chain_id === chainId)) {
          const jitter = ((store.store_code.charCodeAt(0) + chainId.length) % 7) * 0.1;
          const price = Math.round((basePrices[p.gtin]! + jitter) * 100) / 100;
          const sourceTs = new Date();
          await client.query(
            `INSERT INTO store_price (listing_id, store_id, price, unit_price, source_ts, ingested_at)
             VALUES ($1,$2,$3,$4,$5,now())
             ON CONFLICT (listing_id, store_id) DO UPDATE SET
               price = EXCLUDED.price, unit_price = EXCLUDED.unit_price,
               source_ts = EXCLUDED.source_ts, ingested_at = now()`,
            [listingId, store.id, price, unitPrice, sourceTs],
          );
          await client.query(
            `INSERT INTO price_point (listing_id, store_id, price, unit_price, source_ts)
             VALUES ($1,$2,$3,$4,$5)`,
            [listingId, store.id, price, unitPrice, sourceTs],
          );
        }
      }
    }

    // Sample promos
    const rlStore = storeRows.rows.find((s) => s.chain_id === "7290058140886" && s.city === "תל אביב");
    if (rlStore) {
      const promo = await client.query<{ id: string }>(
        `INSERT INTO promotion (
           chain_id, store_id, store_code, promo_code, description,
           mechanic_type, mechanic_params, raw_text, club_only, start_ts, end_ts, source_ts
         ) VALUES (
           '7290058140886', $1, '001', 'DEMO-2FOR20', '2 ב-20 חלב תנובה',
           'n_for_price', '{"n":2,"price":20,"minQty":2}'::jsonb, '2 ב-20 חלב תנובה', false,
           now() - interval '1 day', now() + interval '14 days', now()
         )
         ON CONFLICT (chain_id, store_code, promo_code) DO UPDATE SET
           description = EXCLUDED.description, mechanic_params = EXCLUDED.mechanic_params
         RETURNING id`,
        [rlStore.id],
      );
      await client.query(
        `INSERT INTO promotion_item (promotion_id, item_code)
         VALUES ($1, '7290000173199')
         ON CONFLICT DO NOTHING`,
        [promo.rows[0]!.id],
      );
    }

    // API key
    const rawKey = `smcp_dev_${randomBytes(24).toString("hex")}`;
    const prefix = rawKey.slice(0, 12);
    await client.query(`DELETE FROM api_key WHERE name = 'local-dev'`);
    await client.query(
      `INSERT INTO api_key (name, key_hash, key_prefix, rate_limit_per_minute)
       VALUES ('local-dev', $1, $2, 120)`,
      [hashKey(rawKey), prefix],
    );

    await fs.mkdir(path.join(rootDir, ".local"), { recursive: true });
    await fs.writeFile(path.join(rootDir, ".local/api-key.txt"), rawKey + "\n", "utf8");

    console.log(JSON.stringify({
      ok: true,
      chains: chainIds.length,
      products: products.length,
      listings: listingCount,
      stores: storeRows.rows.length,
      apiKey: rawKey,
      apiKeyFile: ".local/api-key.txt",
      hint: "Authorization: Bearer <apiKey>",
    }, null, 2));
  });

  void pool;
}

seed()
  .then(async () => {
    await closePool();
  })
  .catch(async (err) => {
    console.error(err);
    await closePool();
    process.exit(1);
  });
