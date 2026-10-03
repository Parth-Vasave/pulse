FROM node:22-alpine AS deps
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
# Next.js bakes rewrites into the build, so the API's internal address is a build argument.
ARG INTERNAL_API_URL=http://backend:8000
ENV INTERNAL_API_URL=$INTERNAL_API_URL NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules node_modules
COPY frontend .
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# The runtime only needs `node`; drop npm/yarn (and their bundled, scanner-flagged dependencies) from the final image.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /opt/yarn* /usr/local/bin/yarn* \
 && addgroup -S app && adduser -S app -G app && chown -R app /app
USER app
EXPOSE 3000
CMD ["node", "server.js"]
