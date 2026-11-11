FROM node:22-bookworm-slim
WORKDIR /app
COPY bridge.mjs .
USER node
EXPOSE 8787
CMD ["node", "bridge.mjs"]
