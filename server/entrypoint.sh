#!/bin/sh
set -e
# Fix ownership of the data volume mount (may be root-owned from a prior run)
chown -R node:node /app/data
exec gosu node "$@"
