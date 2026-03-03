import postgres from "postgres"

// Si la URL trae sslmode=require (Neon), activamos SSL; si no, no.
const needsSSL =
  (process.env.DATABASE_URL ?? "").includes("sslmode=require") ||
  process.env.PGSSL === "true"

export const sql = postgres(process.env.DATABASE_URL!, {
  ssl: needsSSL ? "require" : false,
  max: 10, // pool simple
})