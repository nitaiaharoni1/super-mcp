# Pressure Test Output
**Generated:** 2026-07-17
**Idea:** An AI-agent-native API + MCP server that lets agents query Israeli supermarket data (products, prices, promos) and recommend the cheapest place to buy a user's basket in their area.

## Idea Restatement
Expose the Israeli government-mandated supermarket price-transparency feed to AI agents through a normalized REST + MCP interface, so an agent can answer "where should I buy this list of groceries near me for the lowest total?"

## Red Flags Found

1. **"Nothing exists — that's why the opportunity is big" — FALSE, and the opposite is fatal.** The exact product already exists:
   - `@skills-il/supermarket-prices-mcp` (npm, `@skills-il` org) is an **MCP server over the same government data**, exposing the same tools: list chains, get chain files, search products, compare prices across stores, check promotions. One-command install: `claude mcp add supermarket-prices npx -- -y @skills-il/supermarket-prices-mcp`.
   - The ingestion/normalization "hard part" is already solved by `OpenIsraeliSupermarkets` / `israeli-supermarket-data` (Python) and a **daily-updated Kaggle dataset**.
   - Consumer demand is already captured by **CHP (chp.co.il)** and **PriceZ** — free apps, barcode scan, basket comparison, "cheapest store within 10km." These are mature and widely used.
   You are not entering a vacuum. You are entering a solved problem with a free open-source clone of your exact architecture.

2. **No data moat.** The data is a legally-mandated free public feed (2014 Food Act). You cannot own it, and neither can a competitor. When the raw asset is free and public, the only defensible layer is normalization quality, freshness, or a distribution/UX advantage — none of which an MCP wrapper provides over an existing MCP wrapper.

3. **"It's for AI agents" — the customer is undefined and probably doesn't pay.** An AI agent is not a buyer. The buyer is a developer building a grocery agent for the Israeli market. Name one. The TAM of "developers building Israeli grocery-shopping agents who would pay for a data API" is plausibly in the dozens, and they'll reach for the free npm MCP first.

4. **"The market is $X billion" (grocery is huge) — irrelevant.** Grocery spend is enormous; demand for *this data product* is not. The money in grocery is in the **transaction** (basket handoff, delivery affiliate, retail media), which this project does not touch. Comparison data itself monetizes weakly — even CHP, with real distribution, barely monetizes.

5. **No transaction / checkout layer.** You can tell an agent "Rami Levy is 12₪ cheaper," but the agent can't *act* on it — there's no ordering API to hand the basket to. Without the action, this is a read-only novelty, and read-only price data is already a commodity.

## Evidence Extracted

### Existing Workarounds
Strong and mature: CHP app, PriceZ app, government price portal, Kaggle daily dataset, OpenIsraeliSupermarkets scraper, and an existing open-source MCP server. Price-conscious Israelis already have free tools; developers already have free libraries.

### Workaround Cost
Effectively **zero** for the incremental user. The free apps and free datasets already deliver the outcome. There is no expensive workaround to displace — which means no wedge to charge for.

### Named Customer
**None provided.** "AI agents" is not a customer. No named developer, no named consumer, no interview, no willingness-to-pay signal. This is the single biggest gap.

### Contrarian Truth
**None identified yet.** "AI agents will shop for us" is consensus/hype, already priced in. A real contrarian truth would be something like: "Israeli retailers will expose ordering APIs to agents before US retailers do" or "CPG brands will pay for agent-grade normalized price intelligence" — but neither is asserted or evidenced.

### Job-to-Be-Done
Attempted framing: "When I need to do my weekly grocery shop, I want to know the cheapest store near me for my whole basket, so I can save money." **This job is already hired out to CHP/PriceZ.** The agent-mediated version ("...so my AI assistant can do it in a chat") is a nicer interface, not a new job.

## Demand Verdict
**WEAK**

The problem is real but already solved by free apps, free datasets, and a free open-source MCP server that is architecturally identical to this project. There is no data moat (mandated public feed), no named paying customer, no quantified workaround cost to displace, and no transaction layer to capture value. As a *portfolio / learning project or a personal tool*, it's perfectly good. As a *venture*, it is undifferentiated commodity-data plumbing in a market where the same plumbing is given away.

**The only narrow paths that could earn a second look:**
- **B2B price intelligence**, not agent-facing: sell normalized, histor-tracked, SLA'd price/promo data to CPG brands, retail-media teams, researchers, or inflation/macro desks. That's a data-vendor business (real buyers, real budgets) — the MCP is at most a demo skin on it.
- **Agentic commerce, if you own the action**: become the layer that actually *places* the order (delivery integration / basket handoff / affiliate), where the price comparison is the hook, not the product. This requires retailer/delivery partnerships you don't have yet.
- **Global-first arbitrage**: the Israel feed is a free training ground, but the defensible version is being first to normalize *many countries'* fragmented grocery data for agents. That's a much bigger, harder bet — and needs the transaction layer to matter.

## Pipeline Status
**Demand:** WEAK
**Recommended Next:** Before writing another line of code, do `/customer-archetype` to force a single named buyer, then `/pressure-test` again in a fresh session with a real customer conversation. If no buyer survives that, this stays a great personal tool, not a company.
