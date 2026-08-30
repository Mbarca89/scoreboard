#!/usr/bin/env node
/**
 * Regenera únicamente 3v3 D4/D5, conservando los bloques y sus órdenes.
 * Requiere --confirm y se niega a operar si la categoría ya comenzó.
 */
import crypto from "node:crypto";
import process from "node:process";
import dotenv from "dotenv";
import pg from "pg";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

dotenv.config({ path: ".env.local" });

const { Client: PgClient } = pg;
const cliArgs = process.argv.slice(2);
const EVENT_ID = cliArgs.find((arg) => !arg.startsWith("--")) || "axl-2026-fecha-2";
const CONFIRMED = cliArgs.includes("--confirm");
const CATEGORY = "3v3 D4/D5";
const PG_URL = process.env.PG_URL || process.env.DATABASE_URL;
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "sa-east-1";
const TABLE_REGISTRATIONS = process.env.EVENT_REGISTRATIONS_TABLE || "EventRegistrations";
const TABLE_TEAMS = process.env.TEAMS_TABLE || "Teams";
const TABLE_BLOCKS = process.env.FIXTURE_BLOCKS_TABLE || "FixtureBlocks";
const TABLE_MATCHES = process.env.MATCHES_TABLE || "Matches";

if (!PG_URL) throw new Error("Falta PG_URL o DATABASE_URL");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

function deterministicShuffle(values, label) {
  return [...values].sort((a, b) => {
    const hashA = crypto.createHash("sha256").update(`${EVENT_ID}:${CATEGORY}:${label}:${String(a)}`).digest("hex");
    const hashB = crypto.createHash("sha256").update(`${EVENT_ID}:${CATEGORY}:${label}:${String(b)}`).digest("hex");
    return hashA.localeCompare(hashB);
  });
}

function pairKey(a, b) {
  return [a, b].sort().join("::");
}

function buildUniqueMatchups(teamIds) {
  const ids = deterministicShuffle(teamIds, "teams");
  const n = ids.length;
  if (n < 5) throw new Error(`${CATEGORY} requiere al menos 5 equipos para regenerar sin cruces repetidos`);

  if (n === 5) {
    const allPairs = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) allPairs.push([ids[i], ids[j]]);
    }
    return deterministicShuffle(allPairs, "matches");
  }

  const pairs = [];
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    for (const offset of [1, 2]) {
      const pair = [ids[i], ids[(i + offset) % n]];
      const key = pairKey(...pair);
      if (!seen.has(key)) {
        seen.add(key);
        pairs.push(pair);
      }
    }
  }

  const appearances = new Map(ids.map((id) => [id, 0]));
  for (const [a, b] of pairs) {
    appearances.set(a, appearances.get(a) + 1);
    appearances.set(b, appearances.get(b) + 1);
  }
  if (pairs.length !== n * 2 || [...appearances.values()].some((count) => count !== 4)) {
    throw new Error("La validación interna del fixture sin repetidos falló");
  }
  return deterministicShuffle(pairs, "matches");
}

function groupIntoSplitDeckBlocks(matchups) {
  function search(remaining, blocks) {
    if (!remaining.length) return blocks;
    const first = remaining[0];
    for (let index = 1; index < remaining.length; index++) {
      const second = remaining[index];
      const teams = new Set([...first, ...second]);
      if (teams.size !== 4) continue;
      const next = remaining.filter((_, itemIndex) => itemIndex !== 0 && itemIndex !== index);
      const result = search(next, [...blocks, [first, second]]);
      if (result) return result;
    }
    return null;
  }

  const result = search(matchups, []);
  if (!result) throw new Error("No se pudieron agrupar los cruces en bloques split deck sin compartir equipos");
  return result;
}

async function queryAll(tableName) {
  const items = [];
  let lastKey;
  do {
    const response = await ddb.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "eventId = :eventId",
      ExpressionAttributeValues: { ":eventId": EVENT_ID },
      ExclusiveStartKey: lastKey,
    }));
    items.push(...(response.Items || []));
    lastKey = response.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

async function loadRegisteredTeams() {
  const registrations = (await queryAll(TABLE_REGISTRATIONS))
    .filter((item) => String(item.category || "").trim() === CATEGORY)
    .filter((item) => (item.status || "REGISTERED") === "REGISTERED");
  const teams = new Map();
  for (const registration of registrations) {
    const response = await ddb.send(new GetCommand({
      TableName: TABLE_TEAMS,
      Key: { teamId: registration.teamId },
    }));
    teams.set(registration.teamId, {
      id: registration.teamId,
      name: response.Item?.teamName || registration.teamNameSnapshot || registration.teamId,
      logoKey: response.Item?.logoKey || null,
    });
  }
  return teams;
}

function buildMatches(blocks, groupedMatchups, teams, pgLogoPaths) {
  const now = new Date().toISOString();
  return groupedMatchups.flatMap((matchups, blockIndex) =>
    matchups.map(([leftId, rightId], slotIndex) => {
      const left = teams.get(leftId);
      const right = teams.get(rightId);
      const matchId = crypto.randomUUID();
      return {
        eventId: EVENT_ID,
        sk: `MATCH#${matchId}`,
        matchId,
        blockSk: blocks[blockIndex].blockId,
        slot: slotIndex === 0 ? "A" : "B",
        category: CATEGORY,
        stage: "GROUP",
        displayLabel: `${left.name} vs ${right.name}`,
        leftTeamId: left.id,
        leftTeamNameSnapshot: left.name,
        leftTeamLogoKey: left.logoKey,
        leftTeamLogoPath: pgLogoPaths.get(left.id) || null,
        rightTeamId: right.id,
        rightTeamNameSnapshot: right.name,
        rightTeamLogoKey: right.logoKey,
        rightTeamLogoPath: pgLogoPaths.get(right.id) || null,
        leftScore: 0,
        rightScore: 0,
        timeRemainingSec: 0,
        notes: null,
        isFinished: false,
        resultType: null,
        winnerTeamId: null,
        createdAt: now,
        updatedAt: now,
      };
    })
  );
}

async function restoreDynamo(oldBlocks, oldMatches, newMatches) {
  for (const match of newMatches) {
    await ddb.send(new DeleteCommand({
      TableName: TABLE_MATCHES,
      Key: { eventId: EVENT_ID, sk: match.sk },
    })).catch(() => {});
  }
  for (const item of [...oldBlocks, ...oldMatches]) {
    const table = item.sk.startsWith("BLOCK#") ? TABLE_BLOCKS : TABLE_MATCHES;
    await ddb.send(new PutCommand({ TableName: table, Item: item })).catch(() => {});
  }
}

async function main() {
  const client = new PgClient({ connectionString: PG_URL });
  await client.connect();
  let oldDynamoBlocks = [];
  let oldDynamoMatches = [];
  let newMatches = [];

  try {
    const pgBlocksResult = await client.query(
      `SELECT block_id AS "blockId", block_order AS "blockOrder", status
       FROM fixture_blocks WHERE event_id = $1 AND category = $2 ORDER BY block_order`,
      [EVENT_ID, CATEGORY]
    );
    const pgMatchesResult = await client.query(
      `SELECT left_team_id, left_team_logo_path, right_team_id, right_team_logo_path,
              is_finished, left_score, right_score
       FROM matches WHERE event_id = $1 AND category = $2`,
      [EVENT_ID, CATEGORY]
    );
    const blocks = pgBlocksResult.rows;
    const played = pgMatchesResult.rows.some((match) =>
      match.is_finished || match.left_score !== 0 || match.right_score !== 0
    );
    if (!blocks.length) throw new Error(`No existe fixture previo para ${CATEGORY}`);
    if (blocks.some((block) => block.status !== "SCHEDULED") || played) {
      throw new Error(`${CATEGORY} ya comenzó; no es seguro regenerarla`);
    }

    const teams = await loadRegisteredTeams();
    const grouped = groupIntoSplitDeckBlocks(buildUniqueMatchups([...teams.keys()]));
    if (grouped.length !== blocks.length) {
      throw new Error(
        `El fixture nuevo necesita ${grouped.length} bloques y el publicado tiene ${blocks.length}; ` +
        "se abortó para no cambiar el orden de las otras categorías"
      );
    }

    const pgLogoPaths = new Map();
    for (const match of pgMatchesResult.rows) {
      if (match.left_team_logo_path) pgLogoPaths.set(match.left_team_id, match.left_team_logo_path);
      if (match.right_team_logo_path) pgLogoPaths.set(match.right_team_id, match.right_team_logo_path);
    }
    newMatches = buildMatches(blocks, grouped, teams, pgLogoPaths);

    const counts = new Map([...teams.keys()].map((id) => [id, 0]));
    const pairs = new Set();
    for (const match of newMatches) {
      counts.set(match.leftTeamId, counts.get(match.leftTeamId) + 1);
      counts.set(match.rightTeamId, counts.get(match.rightTeamId) + 1);
      const key = pairKey(match.leftTeamId, match.rightTeamId);
      if (pairs.has(key)) throw new Error(`Cruce repetido generado: ${match.displayLabel}`);
      pairs.add(key);
    }
    if ([...counts.values()].some((count) => count !== 4)) {
      throw new Error("No todos los equipos quedaron con cuatro partidos");
    }

    console.log(`Evento: ${EVENT_ID}`);
    console.log(`Categoría: ${CATEGORY}; equipos: ${teams.size}; bloques conservados: ${blocks.length}`);
    for (const block of blocks) {
      const blockMatches = newMatches.filter((match) => match.blockSk === block.blockId);
      console.log(`Bloque ${block.blockOrder}: ${blockMatches.map((match) => match.displayLabel).join(" | ")}`);
    }
    if (!CONFIRMED) {
      console.log("Vista previa solamente. Volvé a ejecutar con --confirm para aplicar los cambios.");
      return;
    }

    oldDynamoBlocks = (await queryAll(TABLE_BLOCKS)).filter((item) => item.category === CATEGORY);
    oldDynamoMatches = (await queryAll(TABLE_MATCHES)).filter((item) => item.category === CATEGORY);
    if (oldDynamoBlocks.some((block) => block.status !== "SCHEDULED") ||
        oldDynamoMatches.some((match) => match.isFinished || match.leftScore !== 0 || match.rightScore !== 0)) {
      throw new Error(`El fixture ${CATEGORY} en Dynamo ya comenzó; no se modificó nada`);
    }

    await client.query("BEGIN");
    await client.query("DELETE FROM matches WHERE event_id = $1 AND category = $2", [EVENT_ID, CATEGORY]);
    for (const match of newMatches) {
      await client.query(
        `INSERT INTO matches
         (event_id, match_id, block_id, slot, category, stage, display_label,
          left_team_id, left_team_name, left_team_logo_path,
          right_team_id, right_team_name, right_team_logo_path,
          left_score, right_score, time_remaining_sec, is_finished)
         VALUES ($1,$2,$3,$4,$5,'GROUP',$6,$7,$8,$9,$10,$11,$12,0,0,0,FALSE)`,
        [EVENT_ID, match.matchId, match.blockSk, match.slot, CATEGORY, match.displayLabel,
          match.leftTeamId, match.leftTeamNameSnapshot, match.leftTeamLogoPath,
          match.rightTeamId, match.rightTeamNameSnapshot, match.rightTeamLogoPath]
      );
    }

    for (const match of oldDynamoMatches) {
      await ddb.send(new DeleteCommand({ TableName: TABLE_MATCHES, Key: { eventId: EVENT_ID, sk: match.sk } }));
    }
    for (const block of blocks) {
      const oldBlock = oldDynamoBlocks.find((item) => (item.blockId || item.sk) === block.blockId);
      if (!oldBlock) throw new Error(`No se encontró ${block.blockId} en Dynamo`);
      const blockMatches = newMatches.filter((match) => match.blockSk === block.blockId);
      await ddb.send(new PutCommand({
        TableName: TABLE_BLOCKS,
        Item: { ...oldBlock, matchAId: blockMatches[0].matchId, matchBId: blockMatches[1].matchId, updatedAt: new Date().toISOString() },
      }));
    }
    for (const match of newMatches) {
      const { leftTeamLogoPath, rightTeamLogoPath, ...dynamoMatch } = match;
      await ddb.send(new PutCommand({ TableName: TABLE_MATCHES, Item: dynamoMatch }));
    }

    await client.query("COMMIT");
    console.log(`${CATEGORY} regenerada sin modificar ninguna otra categoría.`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (oldDynamoBlocks.length || oldDynamoMatches.length) {
      await restoreDynamo(oldDynamoBlocks, oldDynamoMatches, newMatches);
    }
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("ERROR regenerate-d4d5-fixture");
  console.error(error);
  process.exit(1);
});
