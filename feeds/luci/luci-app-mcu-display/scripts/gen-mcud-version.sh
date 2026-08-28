#!/bin/sh
# Generate mcud_version.h from mcud-version.json (single source of truth).
set -eu

JSON="${1:?usage: gen-mcud-version.sh mcud-version.json output.h}"
OUT="${2:?usage: gen-mcud-version.sh mcud-version.json output.h}"

node - "$JSON" "$OUT" <<'NODE'
const fs = require('fs');
const [jsonPath, outPath] = process.argv.slice(2);
const j = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const host = j.components?.host || 'mcudd';
const fw = j.components?.firmware || 'esp32-router';
const body = `/* Auto-generated from mcud-version.json — do not edit. */
#ifndef MCUD_VERSION_H
#define MCUD_VERSION_H

#define MCUD_RDCP_VERSION ${j.rdcp}u
#define MCUD_STACK_VERSION "${j.stack}"
#define MCUD_STACK_RELEASE ${j.release}u
#define MCUD_PAGES_SCHEMA ${j.pages_schema}u
#define MCUD_COMPONENT_HOST "${host}"
#define MCUD_COMPONENT_FIRMWARE "${fw}"

const char *mcud_version_string(void);
int mcud_version_compatible(const char *stack, unsigned release, unsigned rdcp);

#endif
`;
fs.writeFileSync(outPath, body);
NODE
