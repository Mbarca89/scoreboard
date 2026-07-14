import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import fs from "node:fs";
import path from "node:path";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const AWS_REGION = process.env.AWS_REGION || "sa-east-1";
const USERS_TABLE = process.env.USERS_TABLE || "Users";

const VALID_RANKS = new Set(["D3", "D4", "D5", "D6", "UNRANKED"]);

const csvPath = process.argv[2];
if (!csvPath) {
  throw new Error("Uso: node update-user-ranks.mjs <ruta-al-csv>");
}

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: AWS_REGION })
);

function parseCsvLine(line) {
  const out = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  out.push(current);
  return out.map((v) => v.trim());
}

function parseCsv(content) {
  const lines = content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (!lines.length) return [];

  const headers = parseCsvLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row = {};

    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? "";
    }

    rows.push(row);
  }

  return rows;
}

function normalizeRank(value) {
  return String(value || "").trim().toUpperCase();
}

async function updateUserRank(userId, currentRank) {
  const now = new Date().toISOString();

  await ddb.send(
    new UpdateCommand({
      TableName: USERS_TABLE,
      Key: { userId },
      UpdateExpression: "SET currentRank = :rank, updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":rank": currentRank,
        ":updatedAt": now,
      },
      ConditionExpression: "attribute_exists(userId)",
    })
  );
}

async function main() {
  const absolutePath = path.resolve(csvPath);
  const content = fs.readFileSync(absolutePath, "utf8");
  const rows = parseCsv(content);

  console.log(`Archivo: ${absolutePath}`);
  console.log(`Filas encontradas: ${rows.length}`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const userId = String(row.userId || "").trim();
    const currentRank = normalizeRank(row.currentRank);

    if (!userId) {
      console.warn("⚠️ Fila sin userId, se saltea:", row);
      skipped++;
      continue;
    }

    if (!VALID_RANKS.has(currentRank)) {
      console.warn(
        `⚠️ currentRank inválido para userId=${userId}: "${row.currentRank}". Se saltea.`
      );
      skipped++;
      continue;
    }

    try {
      await updateUserRank(userId, currentRank);
      console.log(`✅ ${userId} -> ${currentRank}`);
      updated++;
    } catch (err) {
      console.error(`❌ Error actualizando ${userId}:`, err.message);
      failed++;
    }
  }

  console.log("\nResumen:");
  console.log({
    totalRows: rows.length,
    updated,
    skipped,
    failed,
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});