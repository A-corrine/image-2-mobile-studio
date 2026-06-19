const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

function createStore(databasePath) {
  const resolvedPath = path.resolve(databasePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

  const db = new DatabaseSync(resolvedPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      email TEXT,
      credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS credit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL,
      reference TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(reason, reference)
    );

    CREATE TABLE IF NOT EXISTS payments (
      session_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      amount_total INTEGER NOT NULL,
      currency TEXT NOT NULL,
      credits INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trial_claims (
      claim_key TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS login_codes (
      email TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
  `);

  const accountColumns = db.prepare("PRAGMA table_info(accounts)").all();
  if (!accountColumns.some((column) => column.name === "email")) {
    db.exec("ALTER TABLE accounts ADD COLUMN email TEXT");
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS accounts_email_unique ON accounts(email) WHERE email IS NOT NULL");

  const getAccountStatement = db.prepare("SELECT id, email, credits, created_at, updated_at FROM accounts WHERE id = ?");
  const getAccountByEmailStatement = db.prepare(
    "SELECT id, email, credits, created_at, updated_at FROM accounts WHERE email = ?"
  );
  const insertAccountStatement = db.prepare(
    "INSERT OR IGNORE INTO accounts (id, credits, created_at, updated_at) VALUES (?, ?, ?, ?)"
  );
  const claimTrialStatement = db.prepare(
    "INSERT OR IGNORE INTO trial_claims (claim_key, account_id, created_at) VALUES (?, ?, ?)"
  );
  const debitStatement = db.prepare(
    "UPDATE accounts SET credits = credits - ?, updated_at = ? WHERE id = ? AND credits >= ?"
  );
  const creditStatement = db.prepare(
    "UPDATE accounts SET credits = credits + ?, updated_at = ? WHERE id = ?"
  );
  const eventStatement = db.prepare(
    "INSERT INTO credit_events (account_id, delta, reason, reference, created_at) VALUES (?, ?, ?, ?, ?)"
  );
  const paymentStatement = db.prepare(
    "INSERT OR IGNORE INTO payments (session_id, account_id, amount_total, currency, credits, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const saveLoginCodeStatement = db.prepare(`
    INSERT INTO login_codes (email, code_hash, expires_at, attempts, created_at)
    VALUES (?, ?, ?, 0, ?)
    ON CONFLICT(email) DO UPDATE SET
      code_hash = excluded.code_hash,
      expires_at = excluded.expires_at,
      attempts = 0,
      created_at = excluded.created_at
  `);
  const getLoginCodeStatement = db.prepare(
    "SELECT email, code_hash, expires_at, attempts, created_at FROM login_codes WHERE email = ?"
  );
  const incrementLoginAttemptStatement = db.prepare(
    "UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?"
  );
  const deleteLoginCodeStatement = db.prepare("DELETE FROM login_codes WHERE email = ?");

  function ensureAccount(accountId, initialCredits, trialKey) {
    const now = Date.now();
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = insertAccountStatement.run(accountId, 0, now, now);
      if (Number(result.changes) === 1 && initialCredits > 0 && trialKey) {
        const claim = claimTrialStatement.run(trialKey, accountId, now);
        if (Number(claim.changes) === 1) {
          creditStatement.run(initialCredits, now, accountId);
          eventStatement.run(accountId, initialCredits, "welcome", accountId, now);
        }
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return getAccount(accountId);
  }

  function getAccount(accountId) {
    return getAccountStatement.get(accountId) || null;
  }

  function getAccountByEmail(email) {
    return getAccountByEmailStatement.get(email) || null;
  }

  function debitCredits(accountId, amount, reference) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const now = Date.now();
      const result = debitStatement.run(amount, now, accountId, amount);
      if (Number(result.changes) !== 1) {
        db.exec("ROLLBACK");
        return false;
      }
      eventStatement.run(accountId, -amount, "generation", reference, now);
      db.exec("COMMIT");
      return true;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function refundCredits(accountId, amount, reference) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const now = Date.now();
      creditStatement.run(amount, now, accountId);
      eventStatement.run(accountId, amount, "generation_refund", reference, now);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function recordPayment({ sessionId, accountId, amountTotal, currency, credits }) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const now = Date.now();
      const payment = paymentStatement.run(
        sessionId,
        accountId,
        amountTotal,
        currency,
        credits,
        "paid",
        now
      );
      if (Number(payment.changes) !== 1) {
        db.exec("ROLLBACK");
        return false;
      }
      creditStatement.run(credits, now, accountId);
      eventStatement.run(accountId, credits, "payment", sessionId, now);
      db.exec("COMMIT");
      return true;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function saveLoginCode(email, codeHash, expiresAt) {
    saveLoginCodeStatement.run(email, codeHash, expiresAt, Date.now());
  }

  function getLoginCode(email) {
    return getLoginCodeStatement.get(email) || null;
  }

  function incrementLoginAttempt(email) {
    incrementLoginAttemptStatement.run(email);
  }

  function deleteLoginCode(email) {
    deleteLoginCodeStatement.run(email);
  }

  function linkEmail(accountId, email) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const source = getAccountStatement.get(accountId);
      if (!source) {
        throw new Error("Account not found");
      }

      const existing = getAccountByEmailStatement.get(email);
      if (!existing || existing.id === accountId) {
        db.prepare("UPDATE accounts SET email = ?, updated_at = ? WHERE id = ?").run(email, Date.now(), accountId);
        deleteLoginCodeStatement.run(email);
        db.exec("COMMIT");
        return accountId;
      }

      const now = Date.now();
      if (source.credits > 0) {
        db.prepare("UPDATE accounts SET credits = credits + ?, updated_at = ? WHERE id = ?").run(
          source.credits,
          now,
          existing.id
        );
        db.prepare("UPDATE accounts SET credits = 0, updated_at = ? WHERE id = ?").run(now, source.id);
        const reference = `${source.id}->${existing.id}`;
        eventStatement.run(source.id, -source.credits, "account_merge_out", reference, now);
        eventStatement.run(existing.id, source.credits, "account_merge_in", reference, now);
      }
      deleteLoginCodeStatement.run(email);
      db.exec("COMMIT");
      return existing.id;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    ensureAccount,
    getAccount,
    getAccountByEmail,
    debitCredits,
    refundCredits,
    recordPayment,
    saveLoginCode,
    getLoginCode,
    incrementLoginAttempt,
    deleteLoginCode,
    linkEmail
  };
}

module.exports = { createStore };
