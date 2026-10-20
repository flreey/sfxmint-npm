# The stdio MCP server in a container, for directories that start and inspect it (Glama).
# No dependencies to install; tools/list answers from the bundled tools when offline.
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY bin ./bin
COPY src ./src
ENTRYPOINT ["node", "bin/sfxmint.mjs", "mcp"]
