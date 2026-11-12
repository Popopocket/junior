FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git gosu openssh-client \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
    && chmod a+r /etc/apt/keyrings/docker.asc \
    && . /etc/os-release \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $VERSION_CODENAME stable" > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@11.8.0 \
    && mkdir -p /home/node/.local/share/pnpm/store \
    && chown -R node:node /home/node/.local

COPY entrypoint.sh /usr/local/bin/junior-devcontainer
RUN chmod 0755 /usr/local/bin/junior-devcontainer

ENV PNPM_HOME=/home/node/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /workspaces/junior
ENTRYPOINT ["/usr/local/bin/junior-devcontainer"]
CMD ["sleep", "infinity"]
