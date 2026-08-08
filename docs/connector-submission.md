# Anthropic connector submission

Everything the submission form at
[claude.com/docs/connectors/building/submission](https://claude.com/docs/connectors/building/submission)
asks for, in one place, so the form can be filled without re-deriving any of it.
[docs/REGISTRY.md](./REGISTRY.md) is the wider listing strategy; this file is only the
Anthropic queue.

## Server identity

| Field | Value |
|---|---|
| Name | SuperMCP |
| MCP URL | `https://supermcp.web.app/mcp` (Streamable HTTP) |
| Website | `https://supermcp.web.app` |
| Privacy policy | `https://supermcp.web.app/privacy` |
| Support contact | `nitaiaharoni1@gmail.com` |
| Category | Shopping / commerce |
| Icon | `https://supermcp.web.app/icon-512.png` (also advertised in `serverInfo.icons`) |
| Registry entry | `io.github.nitaiaharoni1/super-mcp`, published 2026-08-08 |

Short description (the 98-character one the MCP registry also carries):

> Israeli online supermarket pricing: the cheapest delivered basket for a shopping list and address.

Longer description, if the form allows one:

> SuperMCP prices a whole shopping list across every Israeli online supermarket that
> delivers to a given address, and ranks them on what the order actually costs once the
> delivery fee and the order minimum are taken into account. Prices come from the price
> transparency feeds the chains are legally required to publish. Items a storefront does
> not carry are reported as missing rather than quietly dropped, and every price carries
> the date it was last seen.

## Authentication

The server runs with `SUPER_MCP_ALLOW_ANONYMOUS=1`, so **a reviewer needs no credential
and no test account**. Point a client at the URL and it answers. Rate limiting is 300
requests per minute per client address.

There is an API-key mode (`Authorization: Bearer`) used for higher limits, and
administrative routes always require a master key, but neither is on the reviewer's path.

## Tool annotations: the surface is read-only

All six tools are annotated `readOnlyHint: true` and `openWorldHint: true`. This is a
statement of fact, not a posture. No tool places an order, holds a basket, or writes
anything a caller can observe later; the server answers questions about a catalogue that
a separate ingestion job maintains. `destructiveHint` and `idempotentHint` are absent
because the spec defines both as meaningful only when `readOnlyHint` is false.

The annotations are set centrally in `services/api/src/mcp/tools/register.ts`, and
`services/api/tests/mcp/serverIdentity.test.ts` asserts it over the whole advertised tool
list, so the claim cannot quietly stop being true.

| Tool | What it does |
|---|---|
| `optimize_delivery` | Prices a whole list at every storefront that delivers to an address |
| `list_delivery_options` | Who delivers here, with fees and minimums, without pricing a basket |
| `get_delivery_terms` | One storefront's fee schedule, minimum and slots |
| `search_products` | Finds products by Hebrew or English name |
| `get_product` | One product by id or barcode |
| `get_promotions` | Current promotions behind a price |

## Reviewer test instructions

### Natural language, in a client

Connect the URL, then ask, in Hebrew or English:

> "מה יעלה לי להזמין 2 חלב 3%, לחם אחיד, ביצים L וקילו בננות לדיזנגוף 100, תל אביב?"

> "What would it cost to have 2 milk, a loaf of bread, a dozen eggs and a kilo of bananas
> delivered to Dizengoff 100, Tel Aviv?"

Expect a ranked list of storefronts with a delivered total per storefront, the cheapest
one named, and any item a storefront does not stock called out as missing.

### Raw call, if the reviewer prefers curl

Verified against production on 2026-08-08: `status: complete`, 4 of 4 lines priced, 12
storefront plans, 52 storefronts correctly reported as not serving that address, 2.7s.

```bash
curl -s -X POST https://supermcp.web.app/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"optimize_delivery","arguments":{"items":[{"query":"חלב 3%","pack_qty":2},{"query":"לחם אחיד","pack_qty":1},{"query":"ביצים L","pack_qty":1},{"query":"בננות","amount":1,"unit":"kg"}],"address":"דיזנגוף 100, תל אביב"}}}'
```

Every item needs exactly one quantity: `pack_qty` for counts of a pack, or `amount` +
`unit` for weighed goods. Omitting both is a validation error, not a default.

### Negative cases worth showing

- An address outside every delivery area returns `unavailableStores` with a reason per
  storefront, not an empty success.
- An ambiguous line returns `status: needs_confirmation` with questions rather than
  guessing a product. Answer them and call again with `{continuation, answers}`.
- A storefront held back only by its order minimum still appears, after every orderable
  one, with `meetsMinimum: false` and the shekels needed to reach it.

## Privacy policy, in English

The hosted policy at `/privacy` is Hebrew, matching the rest of the site. This is a
faithful translation for reviewers, not a second published page. If the Hebrew changes,
change this with it.

> **What you send us.** Your shopping list and the delivery address or city. It reaches us
> from the AI tool you are talking to, each time you ask for a comparison.
>
> **What we do with it.** We turn the address into a point on the map, match each line of
> the list to real products, and work out what the basket costs at each chain including
> delivery. The answer goes back to you, and that is the end of it.
>
> **What we do not keep.** Your list, as a list, is not stored and is not linked to you.
> The address is not stored. When we remember an address lookup so as not to repeat it,
> only a one-way encrypted fingerprint of it is stored, which cannot be turned back into
> the address. When a clarifying question is needed mid-request, the basket state goes back
> to you signed rather than sitting with us.
>
> **What we do keep.** One technical usage row per request: which key, which route, the
> response code, and how long it took. It contains no item, address, or content. It exists
> to spot faults and load.
>
> **The search dictionary.** When someone searches a phrase not seen here before, the
> phrase itself is stored once in a shared dictionary alongside its numeric
> representation, so the next search for the same phrase is instant. That dictionary holds
> no address, no record of who searched, and no link between one phrase and another, so
> nobody's list can be reassembled from it.
>
> **Who else sees anything.** The OpenStreetMap Nominatim mapping service receives the
> address itself, in order to turn it into a point, because without that there is no way
> to know who delivers to you. The PostHog analytics service, in Europe, receives technical
> measurements only: which tool ran, which kind of AI assistant it came from, how many
> items, how long it took, whether an address was present, and whether it succeeded. Never
> the items themselves and never the address. To count returning visitors without knowing
> who you are, that carries an opaque identifier derived one way from connection details,
> which is not a name, an email, or an address. No data is sold and no advertising profile
> is built.
>
> **If you left an email.** The access request form stores the email address and what you
> wrote about your use, and sends us a notification through the Resend mail service, which
> sees the address in transit. It is kept until you ask us to delete it.
>
> **Deletion and questions.** Write to us and we delete. Same address for any question
> about this page: nitaiaharoni1@gmail.com
>
> **Prices.** Prices come from the transparency price lists the chains are required to
> publish. They are not information about you, and they are always shown with the date
> they were last seen.

Each claim is checkable in code, which is the reason the policy is worth trusting:

| Claim | Where it is true |
|---|---|
| The address is never stored raw | `packages/db/src/queries/geocodeCache.ts` HMACs it and stores only the digest |
| Analytics carry no content | `services/api/src/analytics/metadata.ts` is metadata-only by construction |
| Usage rows carry no content | `INSERT INTO usage_event` in `services/api/src/auth.ts` writes four columns |
| The basket is not held server-side | `services/api/src/services/basket/continuation.ts` signs it back to the caller |
| Logs carry no list or address | `logToolFailure` in `services/api/src/mcp/tools/register.ts` deliberately omits arguments |
| Search phrases **are** kept, unlinked | `semantic_query_embedding` (migration `008`) holds `normalized_query`, its vector, a hit count and a timestamp, with no caller identity and no row-to-row link |
| Analytics carry a pseudonymous id | `anonymousAnalyticsId` in `services/api/src/auth.ts` is an HMAC over client address + user agent, truncated to 16 hex; key holders are identified by key id instead |
| The access email transits Resend | `notifyOperator` in `services/api/src/routes/access/index.ts` POSTs it to `api.resend.com`, fire-and-forget, and is a no-op when the env vars are unset |
| No user text reaches an LLM at request time | Product classification runs offline in `services/ingestion` and `packages/db/src/scripts/classifyProducts.ts`; the API has no Vertex, OpenAI, or Anthropic call path |

That last row is the reason the policy says the list is not kept **as a list**, rather than
the cleaner-sounding claim that nothing is kept. The first draft of this page said the
shopping list is not stored full stop, which was false: `scoredSearch.ts` embeds a line and
`putCachedQueryEmbedding` writes the phrase. Dropping the column would not have rescued the
stronger claim either, because the stored vector is derived from the phrase.

## Still open before submitting

- **Retention is built but not switched on.** `purgeOldUsageEvents` and
  `purgeIdleQueryEmbeddings` run from the nightly ingest job, both gated on an env var that
  is currently unset, so today the honest answer to "how long do you keep it" is still
  "until you ask". Turning them on means setting the windows, re-pointing the pinned ingest
  job at an image that has them, and then saying so on `/privacy`. See docs/DEPLOY.md.
- **Keyless abuse ceiling.** Anonymous access is what makes review frictionless; it is
  also what a reviewer may ask about. The answer is the 300/min per-address limit plus a
  global ceiling, in `services/api/src/auth.ts`.
