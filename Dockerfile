# super-mcp API + MCP server (also reused for the ingestion Cloud Run Job).
# Debian slim (glibc) is required: @huggingface/transformers pulls onnxruntime-node,
# whose prebuilt binaries do not run on Alpine/musl.
FROM node:22-slim

ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Install deps first for layer caching. Copy every workspace manifest so pnpm can
# resolve the workspace graph, then install the whole (dev included) tree — we need
# tsx to run the services and typescript to build shared/db.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY services/api/package.json services/api/
COPY services/ingestion/package.json services/ingestion/
RUN pnpm install --frozen-lockfile

# Bring in the source and build the dist/ that @super-mcp/{shared,db} export from.
COPY . .
RUN pnpm -r build

# Pre-download the embedding model into the library-relative transformers cache so
# cold starts never reach out to the HuggingFace Hub. Runs inside @super-mcp/db so
# @huggingface/transformers resolves; the cache lands next to the library and is
# reused verbatim at runtime.
ENV SUPER_MCP_EMBED_MODEL=Xenova/paraphrase-multilingual-MiniLM-L12-v2
RUN pnpm --filter @super-mcp/db exec node -e "import('@huggingface/transformers').then(async ({pipeline})=>{await pipeline('feature-extraction', process.env.SUPER_MCP_EMBED_MODEL, {dtype:'fp32'}); console.log('embedding model cached');}).catch((e)=>{console.error(e); process.exit(1);})"

ENV NODE_ENV=production
ENV HOST=0.0.0.0
# Cloud Run injects PORT (defaults to 8080); the app reads process.env.PORT.
EXPOSE 8080

CMD ["pnpm", "--filter", "@super-mcp/api", "start"]
