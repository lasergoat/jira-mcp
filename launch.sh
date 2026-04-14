#!/bin/bash
export NODE_EXTRA_CA_CERTS="/Library/Application Support/Netskope/STAgent/netskope-cert-bundle.pem"
export SSL_CERT_FILE="/Library/Application Support/Netskope/STAgent/netskope-cert-bundle.pem"
export REQUESTS_CA_BUNDLE="/Library/Application Support/Netskope/STAgent/netskope-cert-bundle.pem"
exec /Users/danielwalker/.volta/tools/image/node/18.19.0/bin/node /Users/danielwalker/Projects/jira-mcp/build/index.js
