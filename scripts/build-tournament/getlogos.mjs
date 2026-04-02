#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { pipeline } from "node:stream/promises";

import pg from "pg";
const { Client: PgClient } = pg;

// ---------- CONFIG ----------
const EVENT_ID = process.argv[2];
if (!EVENT_ID) {
  console.error("Uso: node logo-backfill.mjs <eventId>");
  process.exit(1);
}

const AWS_REGION = process.env.AWS_REGION || "sa-east-1";
const TABLE_TEAMS = process.env.TEAMS_TABLE || "Teams";
const S3_BUCKET = process.env.S3_BUCKET || "axl-media";

const PG_URL = process.env.PG_URL;
if (!PG_URL) {
  console.error("Falta PG_URL");
  process.exit(1);
}

const PUBLIC_DIR = path.resolve(process.cwd(), "public");
const BASE_FS_DIR = path.join(PUBLIC_DIR, "images/team-logos/teams");
const BASE_DB_PATH = "images/team-logos/teams";
const DRY_RUN = (process.env.DRY_RUN ?? "false") === "true";
const OVERWRITE = (process.env.OVERWRITE_EXISTING ?? "false") === "true";

// ---------- AWS ----------
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: AWS_REGION }));
const s3 = new S3Client({ region: AWS_REGION });

// ---------- HELPERS ----------
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function getTeam(teamId) {
  const res = await ddb.send(
    new GetCommand({
      TableName: TABLE_TEAMS,
      Key: { teamId },
    })
  );
  return res.Item ?? null;
}

async function downloadLogo(teamId, logoKey) {
  if (!logoKey) return null;

  const ext = path.extname(logoKey) || ".png";

  // 📁 ruta física (archivo real)
  const dir = path.join(BASE_FS_DIR, teamId);
  const fileName = `logo${ext}`;
  const fsPath = path.join(dir, fileName);

  // 🌐 ruta que va a la DB (la importante)
  const dbPath = `${BASE_DB_PATH}/${teamId}/${fileName}`;

  ensureDir(dir);

  if (fs.existsSync(fsPath) && !OVERWRITE) {
    return dbPath;
  }

  try {
    const res = await s3.send(
      new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: logoKey,
      })
    );

    await pipeline(res.Body, fs.createWriteStream(fsPath));

    console.log(`⬇️ Logo ${teamId} guardado en ${dbPath}`);
    return dbPath; // 👈 CLAVE: devolvés la ruta web, no la física
  } catch (e) {
    console.warn(`⚠️ Error bajando logo ${teamId}:`, e.message);
    return null;
  }
}

// ---------- MAIN ----------
async function main() {
  console.log("=== BACKFILL LOGOS ===");
  console.log("eventId:", EVENT_ID);

  const pgClient = new PgClient({ connectionString: PG_URL });
  await pgClient.connect();

  try {
    // 1. Traer matches
    const res = await pgClient.query(
      `SELECT match_id, left_team_id, right_team_id 
       FROM matches 
       WHERE event_id = $1`,
      [EVENT_ID]
    );

    const matches = res.rows;

    const teamIds = new Set();
    for (const m of matches) {
      if (m.left_team_id !== "BYE") teamIds.add(m.left_team_id);
      if (m.right_team_id !== "BYE") teamIds.add(m.right_team_id);
    }

    console.log("Teams detectados:", teamIds.size);

    // 2. Cargar info teams
    const teamInfo = new Map();
    for (const teamId of teamIds) {
      const t = await getTeam(teamId);
      teamInfo.set(teamId, t);
    }

    // 3. Descargar logos
    const logoPaths = new Map();
    for (const [teamId, t] of teamInfo.entries()) {
      const path = await downloadLogo(teamId, t?.logoKey);
      if (path) logoPaths.set(teamId, path);
    }

    // 4. Update matches
    let updated = 0;

    for (const m of matches) {
      const leftPath = logoPaths.get(m.left_team_id) ?? null;
      const rightPath = logoPaths.get(m.right_team_id) ?? null;

      if (!leftPath && !rightPath) continue;

      if (DRY_RUN) {
        console.log("DRY:", m.match_id, leftPath, rightPath);
        continue;
      }

      await pgClient.query(
        `UPDATE matches
         SET left_team_logo_path = $1,
             right_team_logo_path = $2
         WHERE match_id = $3`,
        [leftPath, rightPath, m.match_id]
      );

      updated++;
    }

    console.log(`✅ Matches actualizados: ${updated}`);
  } finally {
    await pgClient.end();
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});