import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
  BatchWriteCommand,
  BatchGetCommand,
} from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "sa-east-1";

const EVENT_TEAM_ROSTERS_TABLE = process.env.EVENT_TEAM_ROSTERS_TABLE;
const EVENT_TEAM_POINTS_TABLE = process.env.EVENT_TEAM_POINTS_TABLE;
const PLAYER_EVENT_PARTICIPATION_TABLE = process.env.PLAYER_EVENT_PARTICIPATION_TABLE;
const USERS_TABLE = process.env.USERS_TABLE;

const PLAYER_EVENT_PARTICIPATION_EVENT_GSI =
  process.env.PLAYER_EVENT_PARTICIPATION_EVENT_GSI || null;

if (!EVENT_TEAM_ROSTERS_TABLE) throw new Error("Falta EVENT_TEAM_ROSTERS_TABLE");
if (!EVENT_TEAM_POINTS_TABLE) throw new Error("Falta EVENT_TEAM_POINTS_TABLE");
if (!PLAYER_EVENT_PARTICIPATION_TABLE) throw new Error("Falta PLAYER_EVENT_PARTICIPATION_TABLE");
if (!USERS_TABLE) throw new Error("Falta USERS_TABLE");

const rawEventId = process.argv[2];
if (!rawEventId) {
  throw new Error("Uso: node close-event-player-participation.mjs <eventId>");
}

const client = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(client);

function chunk(arr, size = 25) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function getAllEventRosters(eventId) {
  const items = [];
  let lastKey;

  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: EVENT_TEAM_ROSTERS_TABLE,
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

async function getAllEventTeamPoints(eventId) {
  const items = [];
  let lastKey;

  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: EVENT_TEAM_POINTS_TABLE,
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

async function getUsersByIds(userIds) {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  const result = new Map();

  for (const part of chunk(uniqueIds, 100)) {
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

async function getExistingParticipationsByEvent(eventId) {
  if (PLAYER_EVENT_PARTICIPATION_EVENT_GSI) {
    const items = [];
    let lastKey;

    do {
      const res = await ddb.send(
        new QueryCommand({
          TableName: PLAYER_EVENT_PARTICIPATION_TABLE,
          IndexName: PLAYER_EVENT_PARTICIPATION_EVENT_GSI,
          KeyConditionExpression: "eventId = :eventId",
          ExpressionAttributeValues: {
            ":eventId": eventId,
          },
          ExclusiveStartKey: lastKey,
        })
      );

      items.push(...(res.Items || []));
      lastKey = res.LastEvaluatedKey;
    } while (lastKey);

    return items;
  }

  console.warn("⚠️ No hay GSI por eventId en PlayerEventParticipation. Usando Scan fallback.");

  const items = [];
  let lastKey;

  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: PLAYER_EVENT_PARTICIPATION_TABLE,
        FilterExpression: "eventId = :eventId",
        ExpressionAttributeValues: {
          ":eventId": eventId,
        },
        ExclusiveStartKey: lastKey,
      })
    );

    items.push(...(res.Items || []));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  return items;
}

async function batchDeleteParticipations(items) {
  if (!items.length) return;

  for (const part of chunk(items, 25)) {
    await ddb.send(
      new BatchWriteCommand({
        RequestItems: {
          [PLAYER_EVENT_PARTICIPATION_TABLE]: part.map((item) => ({
            DeleteRequest: {
              Key: {
                userId: item.userId,
                sk: item.sk,
              },
            },
          })),
        },
      })
    );
  }
}

async function batchPutParticipations(items) {
  if (!items.length) return;

  for (const part of chunk(items, 25)) {
    await ddb.send(
      new BatchWriteCommand({
        RequestItems: {
          [PLAYER_EVENT_PARTICIPATION_TABLE]: part.map((Item) => ({
            PutRequest: { Item },
          })),
        },
      })
    );
  }
}

function normalizeRank(value) {
  return String(value || "UNRANKED").trim().toUpperCase();
}

const NON_SCORING_CATEGORIES = new Set(["3v3 Open"]);

function categoryPriority(category) {
  const c = String(category || "").trim().toUpperCase();
  if (c === "5V5 D3/D4") return 1;
  if (c === "3V3 D4/D5") return 2;
  if (c === "3V3 D6") return 3;
  return 999;
}

function chooseScoringParticipation(participations, currentRank) {
  participations = participations.filter(
    (participation) => !NON_SCORING_CATEGORIES.has(participation.category)
  );
  if (!participations.length) return null;
  if (participations.length === 1) return participations[0];

  const rank = normalizeRank(currentRank);

  // si hay varias, elegir según currentRank
  if (rank === "D3") {
    return participations.find((p) => p.category === "5v5 D3/D4") || participations[0];
  }

  if (rank === "D4") {
    return (
      participations.find((p) => p.category === "5v5 D3/D4") ||
      participations.find((p) => p.category === "3v3 D4/D5") ||
      participations[0]
    );
  }

  if (rank === "D5") {
    return (
      participations.find((p) => p.category === "3v3 D4/D5") ||
      participations[0]
    );
  }

  if (rank === "D6") {
    return (
      participations.find((p) => p.category === "3v3 D6") ||
      participations[0]
    );
  }

  // UNRANKED: prioriza la más baja disponible
  return (
    participations.find((p) => p.category === "3v3 D6") ||
    participations.find((p) => p.category === "3v3 D4/D5") ||
    participations.find((p) => p.category === "5v5 D3/D4") ||
    participations.slice().sort((a, b) => categoryPriority(a.category) - categoryPriority(b.category))[0]
  );
}

async function main() {
  const eventId = rawEventId;
  const now = new Date().toISOString();

  console.log(`\n===> Cerrando participaciones de jugadores para ${eventId}\n`);

  const [rosters, teamPoints] = await Promise.all([
    getAllEventRosters(eventId),
    getAllEventTeamPoints(eventId),
  ]);

  if (!rosters.length) {
    throw new Error(`No encontré rosters en ${EVENT_TEAM_ROSTERS_TABLE} para ${eventId}`);
  }

  if (!teamPoints.length) {
    throw new Error(`No encontré team points en ${EVENT_TEAM_POINTS_TABLE} para ${eventId}`);
  }

  const pointsByTeamId = new Map(
    teamPoints.map((tp) => [
      tp.teamId,
      {
        finalRank: tp.finalRank ?? null,
        points: tp.points ?? null,
        category: tp.category ?? null,
        teamName: tp.teamName ?? null,
        totalTeams: tp.totalTeams ?? null,
      },
    ])
  );

  // 1) armar todas las participaciones posibles
  const rawParticipations = [];

  for (const roster of rosters) {
    const teamId =
      roster.teamId ||
      (typeof roster.sk === "string" ? roster.sk.replace("TEAM#", "") : null);

    if (!teamId) {
      throw new Error(`No pude resolver teamId en roster: ${JSON.stringify(roster)}`);
    }

    const category = roster.category || null;
    const teamPoint = pointsByTeamId.get(teamId);
    if (!teamPoint && !NON_SCORING_CATEGORIES.has(category)) {
      throw new Error(`No encontré puntos de equipo para teamId=${teamId}`);
    }

    const rosterName =
      roster.rosterName ||
      roster.teamNameSnapshot ||
      teamPoint?.teamName ||
      null;

    const participationCategory = category || teamPoint?.category || null;

    const members = Array.isArray(roster.members) ? roster.members : [];

    for (const member of members) {
      if (!member.userId) continue;

      rawParticipations.push({
        userId: member.userId,
        sk: `EVENT#${eventId}#TEAM#${teamId}`,

        eventId,
        teamId,
        rosterName,
        category: participationCategory,

        usernameSnapshot: member.username || null,
        playerCodeSnapshot: member.playerCode || null,

        accessRoleSnapshot: member.accessRole || null,
        teamRoleSnapshot: member.teamRole || null,
        countsForPoints: false, // se decide después

        status: "PLAYED",

        finalRank: teamPoint?.finalRank ?? null,
        teamPointsEarned: teamPoint?.points ?? null,
        totalTeams: teamPoint?.totalTeams ?? null,

        createdAt: now,
        updatedAt: now,
      });
    }
  }

  // 2) cargar currentRank de users
  const usersById = await getUsersByIds(rawParticipations.map((p) => p.userId));

  // 3) agrupar por userId
  const grouped = new Map();
  for (const p of rawParticipations) {
    if (!grouped.has(p.userId)) grouped.set(p.userId, []);
    grouped.get(p.userId).push(p);
  }

  // 4) elegir una sola participación scoring por jugador
  const finalItems = [];

  for (const [userId, participations] of grouped.entries()) {
    const user = usersById.get(userId);
    const currentRank = normalizeRank(user?.currentRank);

    const selected = chooseScoringParticipation(participations, currentRank);

    for (const p of participations) {
      finalItems.push({
        ...p,
        currentRankSnapshot: currentRank,
        countsForPoints: selected
          ? p.teamId === selected.teamId && p.category === selected.category
          : false,
      });
    }

    if (participations.length > 1) {
      console.log(
        `userId=${userId} currentRank=${currentRank} participations=${participations.length} selected=${selected?.category} / ${selected?.teamId}`
      );
    }
  }

  // 5) limpiar anterior
  const existing = await getExistingParticipationsByEvent(eventId);
  console.log(`Existing participations to delete: ${existing.length}`);
  await batchDeleteParticipations(existing);

  // 6) insertar nuevo
  console.log(`New participations to insert: ${finalItems.length}`);
  await batchPutParticipations(finalItems);

  console.log("\nParticipaciones cerradas correctamente.\n");
  console.log(
    JSON.stringify(
      {
        eventId,
        rosters: rosters.length,
        teamPoints: teamPoints.length,
        inserted: finalItems.length,
        sample: finalItems.slice(0, 5),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error("\nERROR close-event-player-participation\n");
  console.error(err);
  process.exit(1);
});
