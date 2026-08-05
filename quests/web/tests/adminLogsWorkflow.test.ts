import assert from "node:assert/strict";
import test from "node:test";
import { formatAdminLogBytes, filenameFromDisposition } from "../src/lib/adminLogs.ts";

test("admin log helpers format sizes and safe download names", () => {
  assert.equal(formatAdminLogBytes(0), "0 B");
  assert.equal(formatAdminLogBytes(1024), "1.0 KB");
  assert.equal(formatAdminLogBytes(1536), "1.5 KB");
  assert.equal(filenameFromDisposition('attachment; filename="logs.zip"', "fallback.zip"), "logs.zip");
  assert.equal(filenameFromDisposition(null, "fallback.zip"), "fallback.zip");
});
