import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const dockerfile = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");

const REQUIRED_LABELS = [
  "org.opencontainers.image.title=google-mcp",
  "org.opencontainers.image.revision=$SOURCE_REVISION",
  "org.opencontainers.image.version=$SOURCE_VERSION",
  "org.opencontainers.image.source=$SOURCE_REPOSITORY",
];

describe("Dockerfile image contract", () => {
  test("declares the required OCI labels sourced from build args", () => {
    for (const label of REQUIRED_LABELS) {
      expect(dockerfile).toContain(`LABEL ${label}`);
    }
    for (const arg of ["SOURCE_REVISION", "SOURCE_VERSION", "SOURCE_REPOSITORY"]) {
      expect(dockerfile).toMatch(new RegExp(`^ARG ${arg}=`, "m"));
    }
  });

  test("keeps the unprivileged process and exposed port", () => {
    expect(dockerfile).toContain("USER bun");
    expect(dockerfile).toContain("EXPOSE 8090");
  });

  test("bakes no runtime secrets into labels or environment", () => {
    for (const secret of ["GOOGLE_CLIENT_SECRET=", "GOOGLE_REFRESH_TOKEN=", "GOOGLE_MCP_TOKEN="]) {
      expect(dockerfile).not.toContain(secret);
    }
    for (const line of dockerfile.split("\n")) {
      if (line.startsWith("LABEL ")) {
        expect(line).not.toMatch(/(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)/);
      }
    }
  });
});
