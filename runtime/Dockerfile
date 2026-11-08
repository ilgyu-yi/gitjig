FROM node@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5
ARG GITJIG_EXTRA_PACKAGES=""
RUN apt-get update && apt-get install -y --no-install-recommends git curl util-linux ca-certificates $GITJIG_EXTRA_PACKAGES && rm -rf /var/lib/apt/lists/*
COPY io-helper.mjs /opt/gitjig/io-helper.mjs
RUN chmod 0555 /opt/gitjig/io-helper.mjs
USER node
WORKDIR /workspace
