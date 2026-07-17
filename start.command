#!/bin/zsh
# COMMIT CITY launcher — double-click to serve & open
cd "$(dirname "$0")"
# reuse a running server, else start one
if ! curl -s -o /dev/null "http://localhost:8777/index.html"; then
  /usr/bin/python3 serve.py >/dev/null 2>&1 &
  sleep 1
fi
open "http://localhost:8777"
