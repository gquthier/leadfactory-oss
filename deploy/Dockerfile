FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node package.json server.mjs LICENSE ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node public ./public
COPY --chown=node:node vault ./vault
COPY --chown=node:node skills ./skills
RUN mkdir /app/data && chown node:node /app/data
USER node
ENV DATA_DIR=/app/data PORT=4310 ADMIN_HOST=0.0.0.0 PORTAL_PORT=4311 PORTAL_HOST=0.0.0.0
EXPOSE 4310 4311
CMD ["node", "server.mjs"]
