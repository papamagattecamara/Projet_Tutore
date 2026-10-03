#!/usr/bin/env sh
# Lance TV Monde (Linux / macOS) puis ouvre le navigateur.
cd "$(dirname "$0")" && exec python3 server.py "$@"
