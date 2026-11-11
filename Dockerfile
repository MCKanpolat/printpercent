FROM node:22-alpine3.23 AS node

FROM alpine:3.23
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/lib/libgcc_s.so.1 /usr/lib/libstdc++.so.6* /usr/lib/
WORKDIR /app
COPY bridge.mjs .
COPY src ./src
USER 1000:1000
EXPOSE 8787
CMD ["node", "bridge.mjs"]
