FROM node:24-bookworm-slim
WORKDIR /app
COPY bridge.mjs .
USER node
EXPOSE 8787
CMD ["node", "bridge.mjs"]
