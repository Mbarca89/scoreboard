#!/usr/bin/env node
/**
 * Agrega exclusivamente el fixture de 3v3 Open a un evento existente.
 * No modifica ni elimina bloques o partidos de otras categorías.
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
const EVENT_ID = process.argv[2] || "axl-2026-fecha-2";
const CATEGORY = "3v3 Open";
const AWS_REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "sa-east-1";
const PG_URL = process.env.PG_URL || process.env.DATABASE_URL;
const TABLE_EVENTS = process.env.EVENTS_TABLE || "Events";
const TABLE_REGISTRATIONS = process.env.EVENT_REGISTRATIONS_TABLE || "EventRegistrations";
const TABLE_TEAMS = process.env.TEAMS_TABLE || "Teams";
const TABLE_BLOCKS = process.env.FIXTURE_BLOCKS_TABLE || "FixtureBlocks";
const TABLE_MATCHES = process.env.MATCHES_TABLE || "Matches";
const WRITE_DYNAMO = (process.env.WRITE_DYNAMO ?? "true").toLowerCase() === "true";

if (!PG_URL) throw new Error("Falta PG_URL o DATABASE_URL");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: AWS_REGION }));

function shuffle(values) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function buildMatchups(teamIds) {
  const ids = shuffle(teamIds);
  const n = ids.length;
  if (n < 2) throw new Error(`Se necesitan al menos 2 equipos en ${CATEGORY}; hay ${n}`);
  if (n === 2) return Array.from({ length: 4 }, () => [ids[0], ids[1]]);
  if (n === 3) {
    const [a, b, c] = ids;
    return [[a, b], [a, c], [b, c], [a, b], [a, c], [b, c]];
  }

  const played = new Map(ids.map((id) => [id, 0]));
  const pairCounts = new Map();
  const matches = [];
  const target = Math.ceil((n * 4) / 2);
  let attempts = 0;

  while (matches.length < target && attempts++ < 20000) {
    const available = ids.filter((id) => played.get(id) < 4);
    if (available.length < 2) break;
    const a = available[crypto.randomInt(0, available.length)];
    const opponents = available.filter((id) => id !== a);
    const fresh = opponents.filter((id) => !pairCounts.has([a, id].sort().join("::")));
    const pool = fresh.length ? fresh : opponents;
    const b = pool[crypto.randomInt(0, pool.length)];
    const key = [a, b].sort().join("::");
    matches.push([a, b]);
    played.set(a, played.get(a) + 1);
    played.set(b, played.get(b) + 1);
    pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
  }

  const incomplete = ids.filter((id) => played.get(id) !== 4);
  if (incomplete.length) {
    throw new Error(`No se pudo generar un fixture de 4 partidos por equipo: ${incomplete.join(", ")}`);
  }
  return matches;
}

function pairIntoBlocks(matchups) {
  const remaining = matchups.map(([left, right]) => ({ left, right }));
  const pairs = [];
  const shareTeam = (a, b) =>
    a.left === b.left || a.left === b.right || a.right === b.left || a.right === b.right;

  while (remaining.length) {
    const first = remaining.shift();
    const compatibleIndex = remaining.findIndex((candidate) => !shareTeam(first, candidate));
    const second = compatibleIndex >= 0 ? remaining.splice(compatibleIndex, 1)[0] : null;
    pairs.push([first, second]);
  }
  return pairs;
}

async function queryAll(tableName, eventId) {
  const items = [];
  let lastKey;
  do {
    const response = await ddb.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "eventId = :eventId",
      ExpressionAttributeValues: { ":eventId": eventId },
      ExclusiveStartKey: lastKey,
    }));
    items.push(...(response.Items || []));
    lastKey = response.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

async function loadTeams() {
  const registrations = (await queryAll(TABLE_REGISTRATIONS, EVENT_ID))
    .filter((item) => String(item.category || "").trim() === CATEGORY)
    .filter((item) => (item.status || "REGISTERED") === "REGISTERED");

  const teams = new Map();
  for (const registration of registrations) {
    const response = await ddb.send(new GetCommand({
      TableName: TABLE_TEAMS,
      Key: { teamId: registration.teamId },
    }));
    const team = response.Item;
    teams.set(registration.teamId, {
      id: registration.teamId,
      name: team?.teamName || registration.teamNameSnapshot || registration.teamId,
      logoKey: team?.logoKey || null,
    });
  }
  return teams;
}

function makeFixture(blockPairs, teams, firstOrder) {
  const now = new Date().toISOString();
  const blocks = [];
  const matches = [];

  for (let index = 0; index < blockPairs.length; index++) {
    const blockId = `BLOCK#OPEN-${crypto.randomUUID()}`;
    const blockMatches = [];
    const [first, second] = blockPairs[index];

    for (const [slot, matchup] of [["A", first], ["B", second]]) {
      const matchId = crypto.randomUUID();
      const isBye = !matchup;
      const left = isBye ? { id: "BYE", name: "BYE", logoKey: null } : teams.get(matchup.left);
      const right = isBye ? { id: "BYE", name: "BYE", logoKey: null } : teams.get(matchup.right);
      const match = {
        eventId: EVENT_ID,
        sk: `MATCH#${matchId}`,
        matchId,
        blockSk: blockId,
        slot,
        category: CATEGORY,
        stage: "GROUP",
        displayLabel: isBye ? "BYE" : `${left.name} vs ${right.name}`,
        leftTeamId: left.id,
        leftTeamNameSnapshot: left.name,
        leftTeamLogoKey: left.logoKey,
        rightTeamId: right.id,
        rightTeamNameSnapshot: right.name,
        rightTeamLogoKey: right.logoKey,
        leftScore: 0,
        rightScore: 0,
        timeRemainingSec: 0,
        notes: isBye ? "BYE slot (sin partido)" : null,
        isFinished: isBye,
        resultType: isBye ? "DRAW" : null,
        winnerTeamId: null,
        createdAt: now,
        updatedAt: now,
      };
      matches.push(match);
      blockMatches.push(match);
    }

    blocks.push({
      eventId: EVENT_ID,
      sk: blockId,
      blockId,
      blockOrder: firstOrder + index,
      category: CATEGORY,
      stage: "GROUP",
      matchAId: blockMatches[0].matchId,
      matchBId: blockMatches[1].matchId,
      activeSlot: "A",
      status: "SCHEDULED",
      createdAt: now,
      updatedAt: now,
    });
  }
  return { blocks, matches };
}

async function insertPostgres(client, blocks, matches) {
  for (const block of blocks) {
    await client.query(
      `INSERT INTO fixture_blocks
       (event_id, block_id, block_order, category, stage, active_slot, status)
       VALUES ($1,$2,$3,$4,'GROUP','A','SCHEDULED')`,
      [EVENT_ID, block.blockId, block.blockOrder, CATEGORY]
    );
  }
  for (const match of matches) {
    await client.query(
      `INSERT INTO matches
       (event_id, match_id, block_id, slot, category, stage, display_label,
        left_team_id, left_team_name, left_team_logo_path,
        right_team_id, right_team_name, right_team_logo_path,
        left_score, right_score, time_remaining_sec, notes, is_finished, result_type)
       VALUES ($1,$2,$3,$4,$5,'GROUP',$6,$7,$8,$9,$10,$11,$12,0,0,0,$13,$14,$15)`,
      [
        EVENT_ID, match.matchId, match.blockSk, match.slot, CATEGORY, match.displayLabel,
        match.leftTeamId, match.leftTeamNameSnapshot, match.leftTeamLogoKey,
        match.rightTeamId, match.rightTeamNameSnapshot, match.rightTeamLogoKey,
        match.notes, match.isFinished, match.resultType,
      ]
    );
  }
}

async function main() {
  const event = await ddb.send(new GetCommand({ TableName: TABLE_EVENTS, Key: { eventId: EVENT_ID } }));
  if (!event.Item) throw new Error(`No existe el evento ${EVENT_ID}`);
  if (!(event.Item.categories || []).includes(CATEGORY)) {
    throw new Error(`${CATEGORY} no está habilitada en Events.categories para ${EVENT_ID}`);
  }

  const teams = await loadTeams();
  const client = new PgClient({ connectionString: PG_URL });
  await client.connect();
  const writtenDynamo = [];

  try {
    const existingPg = await client.query(
      "SELECT COUNT(*)::int AS count FROM fixture_blocks WHERE event_id = $1 AND category = $2",
      [EVENT_ID, CATEGORY]
    );
    const existingDynamo = (await queryAll(TABLE_BLOCKS, EVENT_ID))
      .filter((item) => item.category === CATEGORY);
    if (existingPg.rows[0].count > 0 || existingDynamo.length > 0) {
      throw new Error(`Ya existe fixture de ${CATEGORY}; no se modificó nada`);
    }

    const maxOrder = await client.query(
      "SELECT COALESCE(MAX(block_order), 0)::int AS max_order FROM fixture_blocks WHERE event_id = $1",
      [EVENT_ID]
    );
    const matchups = buildMatchups([...teams.keys()]);
    const { blocks, matches } = makeFixture(pairIntoBlocks(matchups), teams, maxOrder.rows[0].max_order + 1);

    console.log(`Evento: ${EVENT_ID}`);
    console.log(`Categoría: ${CATEGORY}`);
    console.log(`Equipos: ${teams.size}; partidos reales: ${matchups.length}; bloques: ${blocks.length}`);

    await client.query("BEGIN");
    await insertPostgres(client, blocks, matches);

    if (WRITE_DYNAMO) {
      for (const item of [...blocks, ...matches]) {
        const tableName = item.sk.startsWith("BLOCK#") ? TABLE_BLOCKS : TABLE_MATCHES;
        await ddb.send(new PutCommand({
          TableName: tableName,
          Item: item,
          ConditionExpression: "attribute_not_exists(eventId) AND attribute_not_exists(sk)",
        }));
        writtenDynamo.push({ tableName, key: { eventId: EVENT_ID, sk: item.sk } });
      }
    }

    await client.query("COMMIT");
    console.log("Fixture Open agregado sin modificar el fixture existente.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    for (const item of writtenDynamo.reverse()) {
      await ddb.send(new DeleteCommand({ TableName: item.tableName, Key: item.key })).catch(() => {});
    }
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("ERROR build-open-category-fixture");
  console.error(error);
  process.exit(1);
});
