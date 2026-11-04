#!/bin/sh
set -eu

# Socket access grants host-root authority. This is for trusted local development.
socket_gid=$(stat -c '%g' /var/run/docker.sock)
if ! getent group "$socket_gid" >/dev/null; then
  groupadd --gid "$socket_gid" docker-host
fi
usermod -aG "$socket_gid" node

# Only the cache volume needs ownership changes. Never chown the host workspace.
store=/home/node/.local/share/pnpm
if [ "$(stat -c '%u' "$store")" != "$(id -u node)" ]; then
  chown -R node:node "$store"
fi

exec gosu node "$@"
