import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAdminAccessStore, hashPassword, readAdminCredentials } from "./adminAccess.js";

const credentials = {
  adminId: "admin-for-test",
  passwordHash: hashPassword("pw-for-test-only"),
  configured: true
};

describe("readAdminCredentials", () => {
  it("is unconfigured when env vars are missing", () => {
    assert.equal(readAdminCredentials({}).configured, false);
  });

  it("accepts a sha256 hash", () => {
    const result = readAdminCredentials({ ADMIN_ID: "admin-for-test", ADMIN_PASSWORD_HASH: hashPassword("pw-for-test-only") });
    assert.equal(result.configured, true);
    assert.equal(result.adminId, "admin-for-test");
  });

  it("hashes a plain ADMIN_PASSWORD fallback", () => {
    const result = readAdminCredentials({ ADMIN_ID: "admin-for-test", ADMIN_PASSWORD: "pw-for-test-only" });
    assert.equal(result.passwordHash, hashPassword("pw-for-test-only"));
  });
});

describe("admin access store", () => {
  it("rejects every login when no credentials are configured (fail-closed)", () => {
    const store = createAdminAccessStore({ credentials: readAdminCredentials({}) });
    const result = store.login({ adminId: "admin-for-test", password: "pw-for-test-only", ip: "1.1.1.1" });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "admin_not_configured");
  });

  it("issues a server-generated token on correct credentials", () => {
    const store = createAdminAccessStore({ credentials });
    const result = store.login({ adminId: "admin-for-test", password: "pw-for-test-only", ip: "1.1.1.1" });

    assert.equal(result.ok, true);
    assert.equal(result.adminId, "admin-for-test");
    assert.match(result.sessionToken, /^geumsan-admin-/);
    assert.equal(store.verify(result.sessionToken).ok, true);
  });

  it("rejects a wrong password and a wrong id", () => {
    const store = createAdminAccessStore({ credentials });

    assert.equal(store.login({ adminId: "admin-for-test", password: "wrong", ip: "1.1.1.1" }).reason, "invalid_credentials");
    assert.equal(store.login({ adminId: "someone", password: "pw-for-test-only", ip: "1.1.1.1" }).reason, "invalid_credentials");
  });

  it("rejects the retired class IDs and reset code", () => {
    const store = createAdminAccessStore({ credentials });

    assert.equal(store.login({ adminId: "M-01", password: "", ip: "1.1.1.1" }).ok, false);
    assert.equal(store.login({ adminId: "M-0000", password: "M-0000", ip: "1.1.1.1" }).ok, false);
  });

  it("rejects a client-forged session token", () => {
    const store = createAdminAccessStore({ credentials });

    assert.equal(store.verify("geumsan-device-anything").ok, false);
    assert.equal(store.verify("geumsan-admin-forged").reason, "invalid_session");
  });

  it("locks out an IP after repeated failures", () => {
    const store = createAdminAccessStore({ credentials });

    for (let attempt = 0; attempt < 8; attempt += 1) {
      store.login({ adminId: "admin-for-test", password: "wrong", ip: "9.9.9.9" });
    }

    // 잠긴 뒤에는 올바른 비밀번호도 잠시 막힌다.
    const result = store.login({ adminId: "admin-for-test", password: "pw-for-test-only", ip: "9.9.9.9" });
    assert.equal(result.reason, "locked_out");

    // 다른 기기(IP)는 영향받지 않는다.
    assert.equal(store.login({ adminId: "admin-for-test", password: "pw-for-test-only", ip: "2.2.2.2" }).ok, true);
  });

  it("expires a session after 12 hours", () => {
    let clock = 0;
    const store = createAdminAccessStore({ credentials, now: () => clock });
    const { sessionToken } = store.login({ adminId: "admin-for-test", password: "pw-for-test-only", ip: "1.1.1.1" });

    clock += 11 * 60 * 60 * 1000;
    assert.equal(store.verify(sessionToken).ok, true);

    clock += 2 * 60 * 60 * 1000;
    assert.equal(store.verify(sessionToken).ok, false);
  });

  it("invalidates a token on logout", () => {
    const store = createAdminAccessStore({ credentials });
    const { sessionToken } = store.login({ adminId: "admin-for-test", password: "pw-for-test-only", ip: "1.1.1.1" });

    store.logout(sessionToken);
    assert.equal(store.verify(sessionToken).ok, false);
  });
});
