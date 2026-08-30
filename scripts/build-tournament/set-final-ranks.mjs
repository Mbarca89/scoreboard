#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(scriptDir, ".env.local") });

const EVENT_ID = process.argv[2];
const ranksFile = path.resolve(process.argv[3] || path.join(scriptDir, "final-ranks.json"));
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "sa-east-1";
const TABLE_REGISTRATIONS = process.env.EVENT_REGISTRATIONS_TABLE;
const NON_SEASON_CATEGORIES = new Set(["3v3 Open"]);

if (!EVENT_ID) {
  throw new Error(
    "Uso: node set-final-ranks.mjs <eventId> [archivo-json]\n" +
      "Ejemplo: node set-final-ranks.mjs axl-2026-fecha-2"
  );
}
if (!TABLE_REGISTRATIONS) throw new Error("Falta EVENT_REGISTRATIONS_TABLE");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

async function getRegistrations() {
  const items = [];
  let lastKey;

  do {
    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE_REGISTRATIONS,
        KeyConditionExpression: "eventId = :eventId AND begins_with(sk, :teamPrefix)",
        ExpressionAttributeValues: {
          ":eventId": EVENT_ID,
          ":teamPrefix": "TEAM#",
        },
        ExclusiveStartKey: lastKey,
      })
    );
    items.push(...(result.Items || []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return items;
}

function teamIdOf(registration) {
  return registration.teamId || registration.sk?.replace(/^TEAM#/, "") || null;
}

function parseRankRows(config) {
  if (!config || Array.isArray(config) || typeof config !== "object") {
    throw new Error("El JSON debe ser un objeto cuyas claves sean las categorías");
  }

  const rows = [];
  const seenTeamIds = new Set();

  for (const [rawCategory, teamIds] of Object.entries(config)) {
    const category = rawCategory.trim();
    if (!category) throw new Error("El JSON contiene una categoría vacía");
    if (NON_SEASON_CATEGORIES.has(category)) {
      throw new Error(`${category} no suma puntos de temporada y no debe incluirse`);
    }
    if (!Array.isArray(teamIds) || teamIds.length === 0) {
      throw new Error(`La categoría ${category} debe contener al menos un teamId`);
    }

    teamIds.forEach((rawTeamId, index) => {
      const teamId = typeof rawTeamId === "string" ? rawTeamId.trim() : "";
      if (!teamId || teamId.startsWith("PEGAR_TEAM_ID_")) {
        throw new Error(`Falta completar ${category}, puesto ${index + 1}`);
      }
      if (seenTeamIds.has(teamId)) {
        throw new Error(`El teamId ${teamId} aparece más de una vez en el JSON`);
      }
      seenTeamIds.add(teamId);
      rows.push({ category, finalRank: index + 1, teamId });
    });
  }

  if (!rows.length) throw new Error("El JSON no contiene posiciones");
  return rows;
}

function validateAgainstRegistrations(rows, registrations) {
  if (!registrations.length) {
    throw new Error(`No hay EventRegistrations para ${EVENT_ID}`);
  }

  const registrationsByTeamId = new Map(
    registrations.map((registration) => [teamIdOf(registration), registration])
  );

  for (const row of rows) {
    const registration = registrationsByTeamId.get(row.teamId);
    if (!registration) {
      throw new Error(`El teamId ${row.teamId} no está inscripto en ${EVENT_ID}`);
    }
    const registeredCategory = String(registration.category || "").trim();
    if (registeredCategory && registeredCategory !== row.category) {
      throw new Error(
        `${row.teamId} está inscripto en ${registeredCategory}, pero figura bajo ${row.category} en el JSON`
      );
    }
  }

  const rankedIds = new Set(rows.map((row) => row.teamId));
  const missing = registrations
    .filter((registration) => {
      const category = String(registration.category || "").trim();
      return !NON_SEASON_CATEGORIES.has(category);
    })
    .filter((registration) => !rankedIds.has(teamIdOf(registration)))
    .map((registration) => `${registration.teamNameSnapshot || teamIdOf(registration)} (${registration.category})`);

  if (missing.length) {
    throw new Error(`Faltan equipos inscriptos en el JSON:\n- ${missing.join("\n- ")}`);
  }

  return registrationsByTeamId;
}

async function writeRanks(rows, registrationsByTeamId) {
  if (rows.length > 100) {
    throw new Error("El evento supera el límite de 100 equipos para una escritura transaccional");
  }

  await ddb.send(
    new TransactWriteCommand({
      TransactItems: rows.map((row) => {
        const registration = registrationsByTeamId.get(row.teamId);
        return {
          Update: {
            TableName: TABLE_REGISTRATIONS,
            Key: { eventId: EVENT_ID, sk: registration.sk },
            UpdateExpression: "SET #category = :category, #finalRank = :finalRank",
            ConditionExpression: "attribute_exists(eventId) AND attribute_exists(sk)",
            ExpressionAttributeNames: {
              "#category": "category",
              "#finalRank": "finalRank",
            },
            ExpressionAttributeValues: {
              ":category": row.category,
              ":finalRank": row.finalRank,
            },
          },
        };
      }),
    })
  );
}

async function main() {
  const config = JSON.parse(await readFile(ranksFile, "utf8"));
  const rows = parseRankRows(config);
  const registrations = await getRegistrations();
  const registrationsByTeamId = validateAgainstRegistrations(rows, registrations);

  console.log(`Evento: ${EVENT_ID}`);
  for (const row of rows) {
    const registration = registrationsByTeamId.get(row.teamId);
    console.log(
      `${row.category} | ${row.finalRank}° | ${registration.teamNameSnapshot || row.teamId} | ${row.teamId}`
    );
  }

  await writeRanks(rows, registrationsByTeamId);
  console.log(`\nPosiciones actualizadas: ${rows.length}`);
  console.log("Ya podés ejecutar close-event.mjs.");
}

main().catch((error) => {
  console.error("\nERROR set-final-ranks\n");
  console.error(error);
  process.exit(1);
});
