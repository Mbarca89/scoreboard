import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  BatchWriteCommand,
  BatchGetCommand,
} from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "sa-east-1";

const EVENT_REGISTRATIONS_TABLE = process.env.EVENT_REGISTRATIONS_TABLE;
const EVENT_TEAM_POINTS_TABLE = process.env.EVENT_TEAM_POINTS_TABLE;
const TEAM_MEMBERS_TABLE = process.env.TEAM_MEMBERS_TABLE;
const USERS_TABLE = process.env.USERS_TABLE;
const EVENT_TEAM_ROSTERS_TABLE = process.env.EVENT_TEAM_ROSTERS_TABLE;

if (!EVENT_REGISTRATIONS_TABLE) throw new Error("Falta EVENT_REGISTRATIONS_TABLE");
if (!EVENT_TEAM_POINTS_TABLE) throw new Error("Falta EVENT_TEAM_POINTS_TABLE");
if (!TEAM_MEMBERS_TABLE) throw new Error("Falta TEAM_MEMBERS_TABLE");
if (!USERS_TABLE) throw new Error("Falta USERS_TABLE");
if (!EVENT_TEAM_ROSTERS_TABLE) throw new Error("Falta EVENT_TEAM_ROSTERS_TABLE");

const rawEventId = process.argv[2];
if (!rawEventId) {
  throw new Error("Uso: node close-event.mjs <eventId>");
}

const client = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(client);

function calculatePoints(rank, totalTeams) {
  if (totalTeams <= 1) return 100;

  if (!Number.isFinite(rank) || rank < 1 || rank > totalTeams) {
    throw new Error(`Rank inválido: ${rank} para totalTeams=${totalTeams}`);
  }

  const step = 90 / (totalTeams - 1);
  return Number((100 - (rank - 1) * step).toFixed(2));
}

function chunk(arr, size = 25) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function getAllEventRegistrations(eventId) {
  const items = [];
  let lastKey;

  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: EVENT_REGISTRATIONS_TABLE,
        KeyConditionExpression: "eventId = :eventId AND begins_with(sk, :sk)",
        ExpressionAttributeValues: {
          ":eventId": eventId,
          ":sk": "TEAM#",
        },
        ExclusiveStartKey: lastKey,
      })
    );

    items.push(...(res.Items || []));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  return items;
}

async function getExistingEventTeamPoints(eventId) {
  const res = await ddb.send(
    new QueryCommand({
      TableName: EVENT_TEAM_POINTS_TABLE,
      KeyConditionExpression: "eventId = :eventId",
      ExpressionAttributeValues: {
        ":eventId": eventId,
      },
    })
  );

  return res.Items || [];
}

async function getExistingEventRosters(eventId) {
  const res = await ddb.send(
    new QueryCommand({
      TableName: EVENT_TEAM_ROSTERS_TABLE,
      KeyConditionExpression: "eventId = :eventId AND begins_with(sk, :sk)",
      ExpressionAttributeValues: {
        ":eventId": eventId,
        ":sk": "TEAM#",
      },
    })
  );

  return res.Items || [];
}

async function deleteItems(tableName, items, keyBuilder) {
  if (!items.length) return;

  const chunks = chunk(items, 25);

  for (const part of chunks) {
    await ddb.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableName]: part.map((item) => ({
            DeleteRequest: {
              Key: keyBuilder(item),
            },
          })),
        },
      })
    );
  }
}

async function batchPutItems(tableName, items) {
  if (!items.length) return;

  const chunks = chunk(items, 25);

  for (const part of chunks) {
    await ddb.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableName]: part.map((Item) => ({
            PutRequest: { Item },
          })),
        },
      })
    );
  }
}

async function getTeamMembers(teamId) {
  const items = [];
  let lastKey;

  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TEAM_MEMBERS_TABLE,
        KeyConditionExpression: "teamId = :teamId AND begins_with(sk, :sk)",
        ExpressionAttributeValues: {
          ":teamId": teamId,
          ":sk": "USER#",
        },
        ExclusiveStartKey: lastKey,
      })
    );

    items.push(...(res.Items || []));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  return items;
}

async function batchGetUsers(userIds) {
  if (!userIds.length) return new Map();

  const result = new Map();
  const chunks = chunk(userIds, 100);

  for (const part of chunks) {
    const res = await ddb.send(
      new BatchGetCommand({
        RequestItems: {
          [USERS_TABLE]: {
            Keys: part.map((userId) => ({ userId })),
          },
        },
      })
    );

    const users = res.Responses?.[USERS_TABLE] || [];
    for (const u of users) {
      result.set(u.userId, u);
    }
  }

  return result;
}

async function buildRosterItems(eventId, registrations, closedAt) {
  const rosterItems = [];

  for (const r of registrations) {
    const teamId =
      r.teamId ||
      (typeof r.sk === "string" ? r.sk.replace("TEAM#", "") : null);

    if (!teamId) {
      throw new Error(`No pude resolver teamId en EventRegistration: ${JSON.stringify(r)}`);
    }

    const membersRaw = await getTeamMembers(teamId);
    const activeMembers = membersRaw.filter(
      (m) => (m.status ?? "ACTIVE") === "ACTIVE"
    );

    const userIds = activeMembers
      .map((m) => m.userId)
      .filter(Boolean);

    const usersById = await batchGetUsers(userIds);

    const members = activeMembers.map((m) => {
      const user = usersById.get(m.userId);

      const teamRole = m.teamRole || null;
      const countsForPoints =
        String(teamRole || "").toUpperCase() === "PLAYER";

      return {
        userId: m.userId,
        username: user?.username || null,
        playerCode: user?.playerCode || null,
        accessRole: m.accessRole || null,
        teamRole,
        status: m.status || null,
        countsForPoints,
      };
    });

    const playerCount = members.filter((m) => m.countsForPoints).length;
    const staffCount = members.filter((m) => !m.countsForPoints).length;

    rosterItems.push({
      eventId,
      sk: `TEAM#${teamId}`,

      teamId,
      rosterName: r.teamNameSnapshot || null,
      category: r.category || null,

      frozenAt: closedAt,
      memberCount: members.length,
      playerCount,
      staffCount,

      members,

      createdAt: closedAt,
      updatedAt: closedAt,
    });
  }

  return rosterItems;
}

async function main() {
  const eventId = rawEventId;
  const closedAt = new Date().toISOString();

  console.log(`\n===> Cerrando evento ${eventId}\n`);

  const registrations = await getAllEventRegistrations(eventId);

  if (!registrations.length) {
    throw new Error(`No hay EventRegistrations para ${eventId}`);
  }

  // 1) Construir y repoblar EventTeamRosters
  const rosterItems = await buildRosterItems(eventId, registrations, closedAt);

  const existingRosters = await getExistingEventRosters(eventId);
  await deleteItems(
    EVENT_TEAM_ROSTERS_TABLE,
    existingRosters,
    (item) => ({
      eventId: item.eventId,
      sk: item.sk,
    })
  );

  await batchPutItems(EVENT_TEAM_ROSTERS_TABLE, rosterItems);

  console.log(`Rosters actualizados: ${rosterItems.length}`);

  // 2) Calcular y repoblar EventTeamPoints
  const approved = registrations
    .filter((r) => Number.isFinite(r.finalRank))
    .filter((r) => r.category);

  if (!approved.length) {
    throw new Error("No hay equipos con finalRank y category");
  }

  const byCategory = new Map();

  for (const r of approved) {
    const category = String(r.category || "").trim();
    if (!category) continue;

    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push(r);
  }

  if (byCategory.size === 0) {
    throw new Error("No se encontraron categorías válidas");
  }

  for (const [category, teams] of byCategory.entries()) {
    console.log(`Category ${category}: ${teams.length} teams`);
  }

  const pointItems = [];

  for (const [category, teams] of byCategory.entries()) {
    teams.sort((a, b) => a.finalRank - b.finalRank);

    const totalTeams = teams.length;

    const duplicatedRanks = teams
      .map((r) => r.finalRank)
      .filter((rank, index, arr) => arr.indexOf(rank) !== index);

    if (duplicatedRanks.length) {
      throw new Error(
        `Hay ranks duplicados en categoría ${category}: ${[...new Set(duplicatedRanks)].join(", ")}`
      );
    }

    for (let i = 0; i < teams.length; i++) {
      const expected = i + 1;
      if (teams[i].finalRank !== expected) {
        throw new Error(
          `En categoría ${category}, esperaba rank ${expected} y encontré ${teams[i].finalRank}`
        );
      }
    }

    for (const r of teams) {
      const teamId =
        r.teamId ||
        (typeof r.sk === "string" ? r.sk.replace("TEAM#", "") : null);

      if (!teamId) {
        throw new Error(`No pude resolver teamId en registro: ${JSON.stringify(r)}`);
      }

      const points = calculatePoints(r.finalRank, totalTeams);

      pointItems.push({
        eventId,
        sk: `TEAM#${teamId}`,

        teamId,
        teamName: r.teamNameSnapshot || r.teamName || null,
        category,

        finalRank: r.finalRank,
        totalTeams,
        points,

        calculationVersion: "v1-linear-100-10",
        closedAt,
        closedBy: "Mauricio",
      });
    }
  }

  const existingPoints = await getExistingEventTeamPoints(eventId);
  await deleteItems(
    EVENT_TEAM_POINTS_TABLE,
    existingPoints,
    (item) => ({
      eventId: item.eventId,
      sk: item.sk,
    })
  );

  await batchPutItems(EVENT_TEAM_POINTS_TABLE, pointItems);

  console.log(`Team points actualizados: ${pointItems.length}`);

  console.log("\nCierre completado.\n");
  console.log(
    JSON.stringify(
      {
        eventId,
        rosterItems: rosterItems.length,
        pointItems: pointItems.length,
        categories: [...byCategory.keys()],
        rosterSample: rosterItems.slice(0, 2),
        pointsSample: pointItems.slice(0, 3),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error("\nERROR close-event\n");
  console.error(err);
  process.exit(1);
});