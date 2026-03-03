#!/usr/bin/env node
/**
 * build-local-tournament.mjs
 * - Lee inscripciones desde Dynamo
 * - Genera fixture (blocks + matches) según reglas AXL
 * - Inserta en Postgres local
 * - Persiste en Dynamo (FixtureBlocks, Matches)
 * - Descarga logos desde S3 a ./assets/teams/<teamId>/logo.png
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import process from "node:process";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient,
    GetCommand,
    QueryCommand,
    PutCommand,
    BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { pipeline } from "node:stream/promises";

import pg from "pg";
const { Client: PgClient } = pg;

/** ---------- Config ---------- */
const EVENT_ID = process.argv[2] || "axl-2026-fecha-1";

const AWS_REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "sa-east-1";

const TABLE_EVENTS = process.env.EVENTS_TABLE || "Events";
const TABLE_REGS = process.env.EVENT_REGISTRATIONS_TABLE || "EventRegistrations";
const TABLE_TEAMS = process.env.TEAMS_TABLE || "Teams";

const TABLE_DDB_BLOCKS = process.env.FIXTURE_BLOCKS_TABLE || "FixtureBlocks";
const TABLE_DDB_MATCHES = process.env.MATCHES_TABLE || "Matches";

const S3_BUCKET = process.env.S3_BUCKET || "axl-media";

const ASSETS_DIR = process.env.ASSETS_DIR || path.resolve(process.cwd(), "assets");
const TEAMS_ASSETS_DIR = path.join(ASSETS_DIR, "teams");

const PG_URL = process.env.PG_URL; // ejemplo: postgres://user:pass@127.0.0.1:5432/axl
if (!PG_URL) {
    console.error("Falta PG_URL. Ej: postgres://user:pass@127.0.0.1:5432/axl");
    process.exit(1);
}

const WRITE_DYNAMO = (process.env.WRITE_DYNAMO ?? "true").toLowerCase() === "true";
const DOWNLOAD_LOGOS = (process.env.DOWNLOAD_LOGOS ?? "true").toLowerCase() === "true";
const RESET_LOCAL = (process.env.RESET_LOCAL ?? "false").toLowerCase() === "true";

/** ---------- AWS clients ---------- */
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: AWS_REGION }));
const s3 = new S3Client({ region: AWS_REGION });

/** ---------- Helpers ---------- */
function die(msg) {
    console.error(msg);
    process.exit(1);
}
function nowIso() {
    return new Date().toISOString();
}
function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}
function safeFileName(name) {
    return name.replace(/[^\w.-]+/g, "_");
}

async function getEvent(eventId) {
    const res = await ddb.send(new GetCommand({ TableName: TABLE_EVENTS, Key: { eventId } }));
    return res.Item ?? null;
}

async function getRegistrations(eventId) {
    // PK=eventId, SK=...
    const res = await ddb.send(
        new QueryCommand({
            TableName: TABLE_REGS,
            KeyConditionExpression: "#pk = :e",
            ExpressionAttributeNames: { "#pk": "eventId" },
            ExpressionAttributeValues: { ":e": eventId },
        })
    );
    return res.Items ?? [];
}

async function getTeam(teamId) {
    const res = await ddb.send(new GetCommand({ TableName: TABLE_TEAMS, Key: { teamId } }));
    return res.Item ?? null;
}

async function downloadLogo(teamId, logoKey) {
    if (!logoKey) return null;

    ensureDir(path.join(TEAMS_ASSETS_DIR, teamId));
    const ext = path.extname(logoKey) || ".png";
    const outPath = path.join(TEAMS_ASSETS_DIR, teamId, `logo${ext}`);

    try {
        const res = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: logoKey }));
        await pipeline(res.Body, fs.createWriteStream(outPath));
        return outPath;
    } catch (e) {
        console.warn(`⚠️  No pude descargar logo teamId=${teamId} key=${logoKey}:`, e?.name || e?.message || e);
        return null;
    }
}

async function ddbQueryAllKeysByEvent(tableName, eventId) {
    const keys = [];
    let lastKey = undefined;

    do {
        const res = await ddb.send(
            new QueryCommand({
                TableName: tableName,
                KeyConditionExpression: "#pk = :e",
                ExpressionAttributeNames: { "#pk": "eventId" },
                ExpressionAttributeValues: { ":e": eventId },
                ExclusiveStartKey: lastKey,
            })
        );

        for (const it of res.Items ?? []) {
            // tablas: PK eventId, SK sk
            if (it.eventId && it.sk) keys.push({ eventId: it.eventId, sk: it.sk });
        }

        lastKey = res.LastEvaluatedKey;
    } while (lastKey);

    return keys;
}

async function ddbBatchDelete(tableName, keys) {
    const chunkSize = 25; // límite de BatchWrite
    for (let i = 0; i < keys.length; i += chunkSize) {
        const chunk = keys.slice(i, i + chunkSize);

        const req = {
            RequestItems: {
                [tableName]: chunk.map((k) => ({
                    DeleteRequest: { Key: k },
                })),
            },
        };

        const res = await ddb.send(new BatchWriteCommand(req));

        // retry básico si Dynamo devuelve UnprocessedItems
        const unprocessed = res.UnprocessedItems?.[tableName] ?? [];
        if (unprocessed.length) {
            // reintentos simples
            let retry = unprocessed;
            for (let attempt = 0; attempt < 5 && retry.length; attempt++) {
                await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
                const r2 = await ddb.send(
                    new BatchWriteCommand({ RequestItems: { [tableName]: retry } })
                );
                retry = r2.UnprocessedItems?.[tableName] ?? [];
            }
            if (retry.length) {
                console.warn(`⚠️  Quedaron UnprocessedItems al borrar en ${tableName}:`, retry.length);
            }
        }
    }
}

async function purgeDynamoEventData(eventId) {
    console.log(`🧹 Purge Dynamo (eventId=${eventId})...`);

    // 1) borrar Matches primero (da igual, son tablas separadas)
    const matchKeys = await ddbQueryAllKeysByEvent(TABLE_DDB_MATCHES, eventId);
    console.log(`   - Matches a borrar: ${matchKeys.length}`);
    if (matchKeys.length) await ddbBatchDelete(TABLE_DDB_MATCHES, matchKeys);

    // 2) borrar Blocks
    const blockKeys = await ddbQueryAllKeysByEvent(TABLE_DDB_BLOCKS, eventId);
    console.log(`   - Blocks a borrar: ${blockKeys.length}`);
    if (blockKeys.length) await ddbBatchDelete(TABLE_DDB_BLOCKS, blockKeys);

    console.log("✅ Purge Dynamo OK.");
}

/** ---------- Fixture generation ---------- */
/**
 * Reglas:
 * - Por categoría, cada equipo debe jugar 4 partidos (GROUP)
 * - Si N=5: round robin (4 partidos)
 * - Si N<5: se repiten cruces hasta llegar a 4 por equipo
 * - Si N>=6: hacemos emparejamientos aleatorios sin garantizar round-robin completo
 * - Días: 2 partidos Day1 y 2 partidos Day2 por equipo
 * - Playoffs:
 *    - 3 equipos: final #1 vs #2 (day2)
 *    - 4-6: #1 final, #2 vs #3 semi (day2)
 *    - 7-9: top4 -> semis + final (day2)
 *    - 10+: (placeholder) por grupos top2 (lo dejamos para más adelante)
 *
 * Nota: como hoy no hay standings, para esta simulación “cierre”:
 * - Generamos SOLO fase regular (GROUP) con 4 partidos por team
 * - Y dejamos playoffs como “placeholder” si querés (matches sin equipos asignados)
 */
function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = crypto.randomInt(0, i + 1);
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function pairKey(a, b) {
    return a < b ? `${a}__${b}` : `${b}__${a}`;
}

function buildRegularMatchesForCategory(teams, category) {
    // teams: [{teamId, teamNameSnapshot, logoKey}]
    const ids = teams.map(t => t.teamId);
    const n = ids.length;

    // target: 4 matches per team => total matches = n*4/2
    const targetTotalMatches = Math.floor((n * 4) / 2);

    const matchups = [];
    const playedCount = new Map(ids.map(id => [id, 0]));
    const pairCount = new Map(); // pairKey -> count

    if (n === 0) return matchups;

    // Caso n=5: round robin completo
    if (n === 5) {
        // round robin de 5 => 10 matches, pero queremos 4 por equipo => exactamente los 10.
        const order = [...ids];
        for (let i = 0; i < order.length; i++) {
            for (let j = i + 1; j < order.length; j++) {
                matchups.push([order[i], order[j]]);
            }
        }
        return matchups.slice(0, targetTotalMatches);
    }

    // Caso general: generamos emparejamientos intentando completar 4 por equipo
    // Estrategia: elegir (a,b) aleatorio entre equipos que aún no llegaron a 4,
    // evitando repetir el mismo cruce si se puede.
    const maxAttempts = 5000;
    let attempts = 0;

    while (matchups.length < targetTotalMatches && attempts < maxAttempts) {
        attempts++;

        const needers = ids.filter(id => (playedCount.get(id) || 0) < 4);
        if (needers.length < 2) break;

        const a = needers[crypto.randomInt(0, needers.length)];
        let b;
        let tries = 0;

        // probamos buscar un rival que también necesite y que minimice repetición
        while (tries < 20) {
            b = needers[crypto.randomInt(0, needers.length)];
            if (b !== a) break;
            tries++;
        }
        if (!b || b === a) continue;

        const pk = pairKey(a, b);
        const pc = pairCount.get(pk) || 0;

        // Evitar repetir si aún hay combinaciones sin repetir disponibles
        // pero si n<5, inevitablemente repetimos: permitimos repeticiones.
        if (n >= 5 && pc > 0) continue;

        // Evitar que alguno pase de 4
        if ((playedCount.get(a) || 0) >= 4) continue;
        if ((playedCount.get(b) || 0) >= 4) continue;

        matchups.push([a, b]);
        playedCount.set(a, (playedCount.get(a) || 0) + 1);
        playedCount.set(b, (playedCount.get(b) || 0) + 1);
        pairCount.set(pk, pc + 1);
    }

    // Si no llegamos, completamos permitiendo repeticiones sin tanta regla (n<5 suele caer acá)
    attempts = 0;
    while (matchups.length < targetTotalMatches && attempts < maxAttempts) {
        attempts++;
        const needers = ids.filter(id => (playedCount.get(id) || 0) < 4);
        if (needers.length < 2) break;

        const a = needers[crypto.randomInt(0, needers.length)];
        const b = needers.filter(x => x !== a)[crypto.randomInt(0, needers.length - 1)];
        if (!b) continue;

        matchups.push([a, b]);
        playedCount.set(a, (playedCount.get(a) || 0) + 1);
        playedCount.set(b, (playedCount.get(b) || 0) + 1);
    }

    // sanity: si alguien quedó <4 (debería ser raro), log y seguimos
    for (const id of ids) {
        const c = playedCount.get(id) || 0;
        if (c !== 4) {
            console.warn(`⚠️  category=${category} team=${id} quedó con ${c} partidos (objetivo 4).`);
        }
    }

    return matchups;
}

function assignDays(matchups, teamsById) {
    // Queremos 2 partidos day1 y 2 partidos day2 por equipo.
    // Estrategia simple:
    // - armamos una lista de matches
    // - vamos asignando day1 hasta que cada equipo tenga 2 en day1, luego day2
    const dayCount = new Map(); // teamId -> {1:x,2:y}
    for (const teamId of teamsById.keys()) {
        dayCount.set(teamId, { 1: 0, 2: 0 });
    }

    const matches = matchups.map(([a, b]) => ({ a, b, day: 1 }));

    // Primero intentamos asignar day1 respetando cupo 2
    for (const m of matches) {
        const ca = dayCount.get(m.a);
        const cb = dayCount.get(m.b);
        if (ca[1] < 2 && cb[1] < 2) {
            m.day = 1;
            ca[1]++; cb[1]++;
        } else {
            m.day = 2;
            ca[2]++; cb[2]++;
        }
    }

    // Ajuste: si alguno quedó con day1 <2, re-balanceamos (best effort)
    // Esto no va a ser perfecto en casos raros, pero en tus escalas suele salir bien.
    for (let loop = 0; loop < 10; loop++) {
        let changed = false;

        for (const m of matches) {
            const ca = dayCount.get(m.a);
            const cb = dayCount.get(m.b);

            if (m.day === 2 && ca[1] < 2 && cb[1] < 2) {
                // mover a day1
                m.day = 1;
                ca[1]++; cb[1]++;
                ca[2]--; cb[2]--;
                changed = true;
            }
        }

        if (!changed) break;
    }

    return matches;
}

function makeBlocksForCategory(eventId, category, stagedMatches) {
    // stagedMatches: [{a,b,day}] ya con day
    // blocks de 2 matches (A y B) sin mezclar categorías
    const blocks = [];
    const matches = [];

    let blockIndex = 0;

    for (let i = 0; i < stagedMatches.length; i += 2) {
        blockIndex++;
        const blockSk = `BLOCK#${String(blockIndex).padStart(4, "0")}`;

        const pair1 = stagedMatches[i];
        const pair2 = stagedMatches[i + 1] ?? null;

        const matchAId = crypto.randomUUID();
        const matchBId = pair2 ? crypto.randomUUID() : null;

        blocks.push({
            eventId,
            sk: blockSk,
            blockOrder: null, // se setea después global
            day: pair1.day, // si hay 2 días mezclados en un block, evitamos; acá asumimos que no
            category,
            stage: "GROUP",
            matchAId,
            matchBId,
            activeSlot: "A",
            status: "SCHEDULED",
            createdAt: nowIso(),
            updatedAt: nowIso(),
        });

        matches.push({
            eventId,
            sk: `MATCH#${matchAId}`,
            matchId: matchAId,
            blockSk,
            slot: "A",
            day: pair1.day,
            category,
            stage: "GROUP",
            displayLabel: null,
            leftTeamId: pair1.a,
            rightTeamId: pair1.b,
            createdAt: nowIso(),
            updatedAt: nowIso(),
            leftScore: 0,
            rightScore: 0,
            timeRemainingSec: 0,
            notes: null,
            isFinished: false,
            resultType: null,
            winnerTeamId: null,
        });

        if (pair2) {
            matches.push({
                eventId,
                sk: `MATCH#${matchBId}`,
                matchId: matchBId,
                blockSk,
                slot: "B",
                day: pair2.day,
                category,
                stage: "GROUP",
                displayLabel: null,
                leftTeamId: pair2.a,
                rightTeamId: pair2.b,
                createdAt: nowIso(),
                updatedAt: nowIso(),
                leftScore: 0,
                rightScore: 0,
                timeRemainingSec: 0,
                notes: null,
                isFinished: false,
                resultType: null,
                winnerTeamId: null,
            });
        }
    }

    return { blocks, matches };
}

/** ---------- Postgres insert helpers ---------- */
async function pgEnsureEventRuntimeState(pg, eventId, firstBlockId) {
    // Si tu schema no tiene event_runtime_state, podés ignorar.
    // Intentamos upsert suave; si falla por tabla inexistente, seguimos.
    try {
        await pg.query(
            `
      INSERT INTO event_runtime_state(event_id, current_block_id, active_slot)
      VALUES ($1, $2, 'A')
      ON CONFLICT (event_id) DO UPDATE SET
        current_block_id = EXCLUDED.current_block_id,
        active_slot = 'A',
        updated_at = now()
      `,
            [eventId, firstBlockId]
        );
    } catch (e) {
        if (String(e?.message || "").toLowerCase().includes("event_runtime_state")) {
            console.warn("ℹ️  No existe tabla event_runtime_state en Postgres (ok).");
            return;
        }
        throw e;
    }
}

async function pgResetEvent(pg, eventId) {
    // Borra fixture/matches previos para re-armar (si querés repetir simulación)
    // Si tus FKs son ON DELETE CASCADE, basta con borrar blocks.
    // Acá borro matches primero por las dudas.
    await pg.query(`DELETE FROM matches WHERE event_id = $1`, [eventId]);
    await pg.query(`DELETE FROM fixture_blocks WHERE event_id = $1`, [eventId]);
}

async function pgInsertBlocks(pg, blocks) {
    // Ajustá columnas si tu schema difiere
    for (const b of blocks) {
        await pg.query(
            `
      INSERT INTO fixture_blocks(event_id, block_id, block_order, category, stage, group_id, round_number,
                                scheduled_at, active_slot, status, notes)
      VALUES ($1,$2,$3,$4,$5,NULL,NULL,NULL,$6,$7,NULL)
      `,
            [b.eventId, b.sk, b.blockOrder, b.category, b.stage, b.activeSlot, b.status]
        );
    }
}

async function pgInsertMatches(pg, matches, teamInfoById, logoPathByTeamId) {
    for (const m of matches) {
        const left = teamInfoById.get(m.leftTeamId);
        const right = teamInfoById.get(m.rightTeamId);

        const leftName = left?.teamName ?? left?.teamNameSnapshot ?? m.leftTeamId;
        const rightName = right?.teamName ?? right?.teamNameSnapshot ?? m.rightTeamId;

        const leftLogoPath = logoPathByTeamId.get(m.leftTeamId) ?? null;
        const rightLogoPath = logoPathByTeamId.get(m.rightTeamId) ?? null;

        const label = `D${m.day} - ${leftName} vs ${rightName}`;
        m.displayLabel = label;

        await pg.query(
            `
      INSERT INTO matches(event_id, match_id, block_id, slot, category, stage, group_id, round_number,
                          scheduled_at, display_label,
                          left_team_id, left_team_name, left_team_logo_path,
                          right_team_id, right_team_name, right_team_logo_path,
                          left_score, right_score, time_remaining_sec, notes,
                          is_finished, result_type, winner_team_id,
                          is_overtime, overtime_type, overtime_winner_team_id,
                          reported_by_user_id, finished_at)
      VALUES ($1,$2,$3,$4,$5,$6,NULL,NULL,
              NULL,$7,
              $8,$9,$10,
              $11,$12,$13,
              0,0,0,NULL,
              FALSE,NULL,NULL,
              FALSE,NULL,NULL,
              NULL,NULL)
      `,
            [
                m.eventId,
                m.matchId,
                m.blockSk,
                m.slot,
                m.category,
                m.stage,
                label,
                m.leftTeamId,
                leftName,
                leftLogoPath,
                m.rightTeamId,
                rightName,
                rightLogoPath,
            ]
        );
    }
}

/** ---------- Dynamo persist ---------- */
async function ddbPutBlock(b) {
    await ddb.send(new PutCommand({ TableName: TABLE_DDB_BLOCKS, Item: b }));
}
async function ddbPutMatch(m, teamInfoById) {
    const left = teamInfoById.get(m.leftTeamId);
    const right = teamInfoById.get(m.rightTeamId);

    const leftName = left?.teamName ?? left?.teamNameSnapshot ?? m.leftTeamId;
    const rightName = right?.teamName ?? right?.teamNameSnapshot ?? m.rightTeamId;

    const item = {
        ...m,
        leftTeamNameSnapshot: leftName,
        rightTeamNameSnapshot: rightName,
        leftTeamLogoKey: left?.logoKey ?? null,
        rightTeamLogoKey: right?.logoKey ?? null,
        displayLabel: m.displayLabel ?? `D${m.day} - ${leftName} vs ${rightName}`,
    };

    await ddb.send(new PutCommand({ TableName: TABLE_DDB_MATCHES, Item: item }));
}

/** ---------- Main ---------- */
async function main() {
    console.log("=== Build local tournament ===");
    console.log("eventId:", EVENT_ID);
    console.log("region:", AWS_REGION);
    console.log("WRITE_DYNAMO:", WRITE_DYNAMO, "DOWNLOAD_LOGOS:", DOWNLOAD_LOGOS, "RESET_LOCAL:", RESET_LOCAL);

    ensureDir(ASSETS_DIR);
    ensureDir(TEAMS_ASSETS_DIR);

    const ev = await getEvent(EVENT_ID);
    if (!ev) die(`No existe evento ${EVENT_ID} en Dynamo (${TABLE_EVENTS})`);

    const regs = await getRegistrations(EVENT_ID);
    if (!regs.length) die(`No hay inscripciones en ${TABLE_REGS} para eventId=${EVENT_ID}`);

    // Agrupar por categoría
    const byCat = new Map(); // category -> regs[]
    for (const r of regs) {
        const cat = r.category;
        if (!byCat.has(cat)) byCat.set(cat, []);
        byCat.get(cat).push(r);
    }

    // Cargar Teams (para name/logoKey)
    const teamInfoById = new Map(); // teamId -> {teamName, logoKey}
    for (const r of regs) {
        const t = await getTeam(r.teamId);
        teamInfoById.set(r.teamId, {
            teamId: r.teamId,
            teamName: t?.teamName ?? r.teamNameSnapshot ?? r.teamId,
            logoKey: t?.logoKey ?? null,
        });
    }

    // Descargar logos a disco (opcional)
    const logoPathByTeamId = new Map();
    if (DOWNLOAD_LOGOS) {
        for (const [teamId, info] of teamInfoById.entries()) {
            const p = await downloadLogo(teamId, info.logoKey);
            if (p) logoPathByTeamId.set(teamId, p);
        }
    }

    // Generar matches regulares por categoría
    const allBlocksByCat = new Map();
    const allMatchesByCat = new Map();

    for (const [category, regItems] of byCat.entries()) {
        const teams = shuffle(
            regItems.map((r) => ({
                teamId: r.teamId,
                teamNameSnapshot: r.teamNameSnapshot ?? teamInfoById.get(r.teamId)?.teamName ?? r.teamId,
                logoKey: teamInfoById.get(r.teamId)?.logoKey ?? null,
            }))
        );

        const matchups = buildRegularMatchesForCategory(teams, category); // [[a,b]...]
        const teamsById = new Map(teams.map(t => [t.teamId, t]));
        const withDays = assignDays(matchups, teamsById); // [{a,b,day}...]

        // Muy importante: evitar blocks con day mezclado
        // ordenamos por day primero (day1 luego day2) para que al agrupar de a 2 no se mezclen
        const sorted = withDays.sort((x, y) => x.day - y.day);

        const { blocks, matches } = makeBlocksForCategory(EVENT_ID, category, sorted);

        allBlocksByCat.set(category, blocks);
        allMatchesByCat.set(category, matches);
    }

    // Intercalar blocks:
    // - 5v5 va "solo" (no se mezcla con 3v3)
    // - D5 y D6 se intercalan por blocks (sin mezclar dentro del block)
    const CAT_5V5 = "5v5 D3/D4";
    const CAT_D5 = "3v3 D5";
    const CAT_D6 = "3v3 D6";

    const blocks5 = allBlocksByCat.get(CAT_5V5) ?? [];
    const blocksD5 = allBlocksByCat.get(CAT_D5) ?? [];
    const blocksD6 = allBlocksByCat.get(CAT_D6) ?? [];

    const interleaved3v3 = [];
    let i = 0;
    while (i < blocksD5.length || i < blocksD6.length) {
        if (i < blocksD5.length) interleaved3v3.push(blocksD5[i]);
        if (i < blocksD6.length) interleaved3v3.push(blocksD6[i]);
        i++;
    }

    const finalBlocks = [...blocks5, ...interleaved3v3];

    // Re-asignar blockOrder global consecutivo
    finalBlocks.forEach((b, idx) => {
        b.blockOrder = idx + 1;
        b.updatedAt = nowIso();
    });

    // Juntar matches (y asignar displayLabel)
    const allMatches = [
        ...(allMatchesByCat.get(CAT_5V5) ?? []),
        ...(allMatchesByCat.get(CAT_D5) ?? []),
        ...(allMatchesByCat.get(CAT_D6) ?? []),
    ];

    // Postgres
    const pgClient = new PgClient({ connectionString: PG_URL });
    await pgClient.connect();

    try {
        if (RESET_LOCAL) {
            console.log("🧹 Reset local fixture for event:", EVENT_ID);
            await pgResetEvent(pgClient, EVENT_ID);
        }

        console.log("🧩 Insert blocks into Postgres:", finalBlocks.length);
        await pgInsertBlocks(pgClient, finalBlocks);

        console.log("🏁 Insert matches into Postgres:", allMatches.length);
        await pgInsertMatches(pgClient, allMatches, teamInfoById, logoPathByTeamId);

        const firstBlockId = finalBlocks[0]?.sk ?? null;
        if (firstBlockId) {
            await pgEnsureEventRuntimeState(pgClient, EVENT_ID, firstBlockId);
        }

        console.log("✅ Postgres listo.");
    } finally {
        await pgClient.end();
    }

    // Dynamo
    if (WRITE_DYNAMO) {
        await purgeDynamoEventData(EVENT_ID);
        console.log("☁️  Persist blocks to Dynamo:", finalBlocks.length);
        for (const b of finalBlocks) await ddbPutBlock(b);

        console.log("☁️  Persist matches to Dynamo:", allMatches.length);
        for (const m of allMatches) await ddbPutMatch(m, teamInfoById);

        console.log("✅ Dynamo fixture listo.");
    } else {
        console.log("ℹ️  WRITE_DYNAMO=false, no escribí en Dynamo.");
    }

    console.log("DONE.");
}

main().catch((e) => {
    console.error("Fatal:", e?.name || e, e?.message || "");
    process.exit(1);
});