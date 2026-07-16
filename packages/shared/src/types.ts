/** Adapter + normalization shared types (SPEC contract). */

export type MarketCode = string; // "IL" first; not hardcoding only IL

export type CurrencyCode = string; // "ILS"

export interface FeedFile {
  sourceId: string;
  kind: "stores" | "prices" | "pricesfull" | "promos" | "promosfull" | "other";
  remotePath: string;
  fileName: string;
  chainId: string;
  storeId?: string;
  publishedAt?: Date;
  sizeBytes?: number;
}

export interface RawBlob {
  sourceId: string;
  file: FeedFile;
  bytes: Buffer;
  contentType?: string;
  fetchedAt: Date;
  /** Local archive path (GCS equivalent for local/dev). */
  archivePath?: string;
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

export type RawStoreRecord = {
  kind: "store";
  chainId: string;
  storeId: string;
  name: string;
  address?: string;
  city?: string;
  zip?: string;
  geo?: GeoPoint;
  raw?: Record<string, unknown>;
};

export type RawPriceRecord = {
  kind: "price";
  chainId: string;
  storeId: string;
  itemCode: string;
  /** 1 = GTIN/barcode in most Israeli feeds; 0/2 = chain-internal. */
  itemType: number;
  name: string;
  brand?: string;
  qty?: number;
  unit?: string;
  isWeighted?: boolean;
  price: number;
  unitPrice?: number;
  allowDiscount?: boolean;
  currency?: CurrencyCode;
  ts: Date;
  raw?: Record<string, unknown>;
};

export type PromoMechanicType =
  | "simple_discount"
  | "n_for_price"
  | "second_unit_pct"
  | "club_price"
  | "spend_threshold"
  | "other";

export type RawPromoRecord = {
  kind: "promo";
  chainId: string;
  storeId: string;
  promoId: string;
  description: string;
  mechanic: {
    type: PromoMechanicType;
    params: Record<string, number | string | boolean | null>;
    rawText?: string;
  };
  itemCodes: string[];
  startTs: Date;
  endTs: Date;
  clubOnly?: boolean;
  ts: Date;
  raw?: Record<string, unknown>;
};

export type RawRecord = RawStoreRecord | RawPriceRecord | RawPromoRecord;

export interface SourceAdapter {
  sourceId: string;
  market: MarketCode;
  discover(): Promise<FeedFile[]>;
  fetch(file: FeedFile): Promise<RawBlob>;
  parse(blob: RawBlob): AsyncIterable<RawRecord>;
}

export interface FreshnessMeta {
  sourceTs: Date | string;
  ingestedAt: Date | string;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  rateLimitPerMinute: number;
  createdAt: Date;
  revokedAt: Date | null;
}

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}
