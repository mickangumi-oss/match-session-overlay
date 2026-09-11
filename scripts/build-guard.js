"use strict";

const expectedUnlock = String(process.env.MATCH_OVERLAY_BUILD_UNLOCK ?? "").trim();

if (!expectedUnlock) {
  process.stderr.write(
    "[build-guard] BUILD_LOCKED: explicit temporary approval is required.\n",
  );
  process.exit(1);
}

process.stdout.write("[build-guard] temporary approval accepted.\n");
