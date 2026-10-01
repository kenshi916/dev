import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
if (!existsSync(".dev.vars")) {
  writeFileSync(
    ".dev.vars",
    "CREDENTIAL_SECRET=" + randomBytes(32).toString("hex") + "\n",
    { mode: 0o600 },
  );
  console.log(
    "Created local credential-encryption secret. Keep .dev.vars private and backed up.",
  );
} else console.log("Existing local encryption secret preserved.");
