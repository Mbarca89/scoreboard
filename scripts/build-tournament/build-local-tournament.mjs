#!/usr/bin/env node
/**
 * build-local-tournament.mjs
 * - Lee inscripciones desde Dynamo
 * - Genera fixture (blocks + matches) según reglas AXL
 * - Inserta en Postgres local
 * - Persiste en Dynamo (FixtureBlocks, Matches)
 * - Descarga logos desde S3 a ./assets/teams/<teamId>/logo.png
*/
console.log("RUNNING:", import.meta.url)
console.log("CWD:", process.cwd())

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import process from "node:process";
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

console.log("ARGV:", process.argv)
console.log("eventId arg (argv[2]):", process.argv[2])
console.log("ENV EVENT_ID:", process.env.EVENT_ID)

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
const EVENT_ID = process.argv[2] || "axl-2026-fecha-2";

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
    console.log("Error")
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

    if (!logoKey) {
        console.log(logoKey, "Logo no encontrado")
        return null;
    }


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
    const ids = teams.map(t => t.teamId);
    const n = ids.length;

    const targetTotalMatches = Math.floor((n * 4) / 2);

    if (n === 0) return [];

    // ---------- N = 2 ----------
    if (n === 2) {
        const [a, b] = ids;
        return [[a, b], [a, b], [a, b], [a, b]];
    }

    // ---------- N = 3 ----------
    if (n === 3) {
        const [a, b, c] = ids;
        return [
            [a, b],
            [a, c],
            [b, c],
            [a, b],
            [a, c],
            [b, c],
        ];
    }

    // ---------- N = 4 ----------
    if (n === 4) {
        // 1) randomizar el orden de equipos (para que no toque siempre igual)
        const shuffled = shuffle(ids); // usa tu shuffle() que ya tenés
        const [a, b, c, d] = shuffled;

        // 2) 3 rounds posibles (perfect matchings)
        const rounds = [
            [[a, b], [c, d]],
            [[a, c], [b, d]],
            [[a, d], [b, c]],
        ];

        // 3) Armar 4 rounds (cada round = 2 partidos, usan a los 4 equipos)
        //    Necesitamos 4 rounds para que cada equipo juegue 4 partidos.
        //    Elegimos un índice para repetir (0/1/2) al azar
        const repeatIdx = crypto.randomInt(0, 3);

        // Orden base: ponemos los 3 rounds una vez, + el round repetido
        const plan = [0, 1, 2, repeatIdx];

        // 4) Shuffle del orden de rounds para que no sea siempre la misma secuencia
        const planShuffled = shuffle(plan);

        // 5) Flatten a lista de matchups (8 matches)
        const matchups = [];
        for (const ri of planShuffled) {
            matchups.push(...rounds[ri]);
        }

        return matchups;
    }

    // ---------- N = 5 ----------
    if (n === 5) {
        const base = [];
        for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
                base.push([ids[i], ids[j]]);
            }
        }
        return base; // 10 matches
    }

    // ---------- N >= 6 ----------
    // Grafo circulante 4-regular: cada equipo juega contra los vecinos a
    // distancia 1 y 2. Produce exactamente 4 rivales distintos por equipo.
    const orderedIds = shuffle(ids);
    const matchups = [];
    const seenPairs = new Set();

    for (let i = 0; i < n; i++) {
        for (const offset of [1, 2]) {
            const a = orderedIds[i];
            const b = orderedIds[(i + offset) % n];
            const key = pairKey(a, b);
            if (seenPairs.has(key)) continue;
            seenPairs.add(key);
            matchups.push([a, b]);
        }
    }

    if (matchups.length !== targetTotalMatches) {
        throw new Error(
            `No se pudo generar fixture sin cruces repetidos para ${category}: ` +
            `${matchups.length}/${targetTotalMatches} partidos`
        );
    }

    return shuffle(matchups);
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

/**
 * Arma blocks (2 partidos por block) sin mezclar equipos dentro del block.
 * - Sin concepto de "day"
 * - Best-effort: minimiza BYE usando heurística "most constrained first"
 *
 * @param {string} eventId
 * @param {string} category
 * @param {Array<[string,string]>} matchups  // lista de cruces [teamA, teamB]
 * @param {() => string} nextBlockIdFn       // devuelve "0001", "0002", ...
 * @returns {{ blocks: any[], matches: any[] }}
 */
function makeBlocksForCategoryNoDays(eventId, category, matchups, nextBlockIdFn) {
    const blocks = [];
    const matches = [];

    const nowIso = () => new Date().toISOString();

    const sharesTeam = (m1, m2) =>
        m1.a === m2.a || m1.a === m2.b || m1.b === m2.a || m1.b === m2.b;

    // Convertimos matchups a objetos
    const remaining = matchups.map(([a, b]) => ({ a, b }));

    // Crea un match BYE terminado
    const makeByeMatch = (blockSk, slot) => {
        const matchId = crypto.randomUUID();
        const item = {
            eventId,
            sk: `MATCH#${matchId}`,
            matchId,
            blockSk,
            slot,
            category,
            stage: "GROUP",
            displayLabel: `BYE`,
            leftTeamId: "BYE",
            rightTeamId: "BYE",
            createdAt: nowIso(),
            updatedAt: nowIso(),
            leftScore: 0,
            rightScore: 0,
            timeRemainingSec: 0,
            notes: "BYE slot (sin partido)",
            isFinished: true,
            resultType: "DRAW",          // opcional si tu schema lo soporta
            winnerTeamId: null,
        };
        matches.push(item);
        return matchId;
    };

    // Heurística: elegimos el match que tiene menos posibles parejas
    const pickBestPairIndexes = (list) => {
        if (list.length < 2) return { i: 0, j: -1 };

        // Precomputar cantidad de opciones por índice
        const optionCount = new Array(list.length).fill(0);
        for (let i = 0; i < list.length; i++) {
            let cnt = 0;
            for (let j = 0; j < list.length; j++) {
                if (i === j) continue;
                if (!sharesTeam(list[i], list[j])) cnt++;
            }
            optionCount[i] = cnt;
        }

        // i = el más restringido
        let iBest = 0;
        for (let i = 1; i < list.length; i++) {
            if (optionCount[i] < optionCount[iBest]) iBest = i;
        }

        // Elegimos un j compatible que también sea restringido (para no bloquear)
        let jBest = -1;
        let bestScore = -Infinity;

        for (let j = 0; j < list.length; j++) {
            if (j === iBest) continue;
            if (sharesTeam(list[iBest], list[j])) continue;

            // score mayor si optionCount[j] es bajo
            const score = -optionCount[j];
            if (score > bestScore) {
                bestScore = score;
                jBest = j;
            }
        }

        return { i: iBest, j: jBest };
    };

    while (remaining.length) {
        const { i, j } = pickBestPairIndexes(remaining);

        const m1 = remaining.splice(i, 1)[0];
        const m2 = j >= 0
            ? remaining.splice(j > i ? (j - 1) : j, 1)[0]
            : null;

        const blockId = nextBlockIdFn();
        const blockSk = `BLOCK#${blockId}`;

        const matchAId = crypto.randomUUID();
        const matchBId = m2 ? crypto.randomUUID() : null;

        // Crear block
        const block = {
            eventId,
            sk: blockSk,
            blockOrder: null,
            category,
            stage: "GROUP",
            matchAId,
            matchBId: matchBId ?? null,
            activeSlot: "A",
            status: "SCHEDULED",
            createdAt: nowIso(),
            updatedAt: nowIso(),
        };
        blocks.push(block);

        // Match A real
        matches.push({
            eventId,
            sk: `MATCH#${matchAId}`,
            matchId: matchAId,
            blockSk,
            slot: "A",
            category,
            stage: "GROUP",
            displayLabel: null,
            leftTeamId: m1.a,
            rightTeamId: m1.b,
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

        if (m2) {
            // Match B real
            matches.push({
                eventId,
                sk: `MATCH#${matchBId}`,
                matchId: matchBId,
                blockSk,
                slot: "B",
                category,
                stage: "GROUP",
                displayLabel: null,
                leftTeamId: m2.a,
                rightTeamId: m2.b,
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
        } else {
            // No se pudo emparejar => BYE terminado en B
            const byeId = makeByeMatch(blockSk, "B");
            blocks[blocks.length - 1].matchBId = byeId;
        }
    }

    return { blocks, matches };
}

/** ---------- Postgres insert helpers ---------- */
async function pgEnsureEventRuntimeState(pg, eventId, firstBlockId) {
    // Si tu schema no tiene event_runtime_state, podés ignorar.
    // Intentamos upsert suave; si falla por tabla inexistente, seguimos.
    console.log("Event Runtime Status: ", eventId, firstBlockId)
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
        if (e?.code === "42P01") {
            console.warn("ℹ️ No existe tabla event_runtime_state en Postgres (ok).");
            return;
        }
        throw e;

    }
}

async function pgResetEvent(pg, eventId) {
    console.log("Reset event", eventId);

    // 1) borrar runtime_state primero (evita FK/trigger side effects)
    await pg.query(`DELETE FROM event_runtime_state WHERE event_id = $1`, [eventId]);

    // 2) borrar matches
    await pg.query(`DELETE FROM matches WHERE event_id = $1`, [eventId]);

    // 3) borrar blocks
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

        const leftScore = Number.isFinite(m.leftScore) ? m.leftScore : 0;
        const rightScore = Number.isFinite(m.rightScore) ? m.rightScore : 0;
        const timeRemainingSec = Number.isFinite(m.timeRemainingSec) ? m.timeRemainingSec : 0;

        const isFinished = !!m.isFinished;
        const notes = m.notes ?? null;

        // Si está terminado, le ponemos timestamp (si tu columna finished_at existe)
        const finishedAt = isFinished ? new Date().toISOString() : null;

        await pg.query(
            `
      INSERT INTO matches(
        event_id, match_id, block_id, slot, category, stage, group_id, round_number,
        scheduled_at, display_label,
        left_team_id, left_team_name, left_team_logo_path,
        right_team_id, right_team_name, right_team_logo_path,
        left_score, right_score, time_remaining_sec, notes,
        is_finished, result_type, winner_team_id,
        is_overtime, overtime_type, overtime_winner_team_id,
        reported_by_user_id, finished_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,NULL,NULL,
        NULL,$7,
        $8,$9,$10,
        $11,$12,$13,
        $14,$15,$16,$17,
        $18,$19,$20,
        FALSE,NULL,NULL,
        NULL,$21
      )
      `,
            [
                m.eventId,
                m.matchId,
                m.blockSk,
                m.slot,
                m.category, // <- tu mapper al enum
                m.stage,
                label,
                m.leftTeamId,
                leftName,
                leftLogoPath,
                m.rightTeamId,
                rightName,
                rightLogoPath,
                leftScore,
                rightScore,
                timeRemainingSec,
                notes,
                isFinished,
                m.resultType ?? null,
                m.winnerTeamId ?? null,
                finishedAt,
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
    console.log("Registrations:", regs.length);

    // Agrupar por categoría
    const byCat = new Map(); // category -> regs[]
    for (const r of regs) {
        const cat = String(r.category ?? "").trim();
        if (!byCat.has(cat)) byCat.set(cat, []);
        byCat.get(cat).push(r);
    }
    console.log("Categories found:", [...byCat.keys()]);
    for (const [cat, items] of byCat.entries()) {
        console.log(`- ${cat}: ${items.length} teams`);
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

    let globalBlockSeq = 0;
    const nextBlockIdFn = () => String(++globalBlockSeq).padStart(4, "0");

    for (const [category, regItems] of byCat.entries()) {
        const teams = shuffle(
            regItems.map((r) => ({
                teamId: r.teamId,
                teamNameSnapshot: r.teamNameSnapshot ?? teamInfoById.get(r.teamId)?.teamName ?? r.teamId,
                logoKey: teamInfoById.get(r.teamId)?.logoKey ?? null,
            }))
        );

        const matchups = buildRegularMatchesForCategory(teams, category); // [[a,b]...]
        const { blocks, matches } = makeBlocksForCategoryNoDays(EVENT_ID, category, matchups, nextBlockIdFn);

        console.log("Category", category, "matches:", matchups.length)
        allBlocksByCat.set(category, blocks);
        allMatchesByCat.set(category, matches);
    }

    // Intercalar blocks:
    // - 5v5 va "solo" (no se mezcla con 3v3)
    // - D5 y D6 se intercalan por blocks (sin mezclar dentro del block)
    for (const [cat, blocks] of allBlocksByCat.entries()) {
        console.log(`blocks for ${cat}:`, blocks.length);
    }
    for (const [cat, matches] of allMatchesByCat.entries()) {
        console.log(`matches for ${cat}:`, matches.length);
    }
    let allMatches = [];
    let allBlocks = [];

    for (const [cat, blocks] of allBlocksByCat.entries()) allBlocks.push(...blocks);
    for (const [cat, matches] of allMatchesByCat.entries()) allMatches.push(...matches);


    const is5v5 = (c) => String(c).trim().startsWith("5v5");
    const is3v3 = (c) => String(c).trim().startsWith("3v3");

    const blocks5 = allBlocks.filter(b => is5v5(b.category));
    const blocks3 = allBlocks.filter(b => is3v3(b.category));

    // intercalar por categoría dentro de 3v3 (sin mezclar dentro del block)
    const blocks3ByCat = new Map();
    for (const b of blocks3) {
        const c = String(b.category).trim();
        if (!blocks3ByCat.has(c)) blocks3ByCat.set(c, []);
        blocks3ByCat.get(c).push(b);
    }

    const cats3 = [...blocks3ByCat.keys()].sort(); // D5, D6
    const interleaved3 = [];
    let k = 0;
    while (true) {
        let added = false;
        for (const c of cats3) {
            const arr = blocks3ByCat.get(c);
            if (arr && k < arr.length) { interleaved3.push(arr[k]); added = true; }
        }
        if (!added) break;
        k++;
    }

    const finalBlocks = [...blocks5, ...interleaved3];

    // blockOrder global
    finalBlocks.forEach((b, idx) => {
        b.blockOrder = idx + 1;
        b.updatedAt = nowIso();
    });

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

        console.log("Blocks generated:", finalBlocks.length);

        if (finalBlocks.length > 0) {
            const firstBlockId = finalBlocks[0].sk;
            console.log("Blocks generated:", finalBlocks.length);
            console.log("Matches generated:", allMatches.length);

            if (finalBlocks.length === 0) {
                throw new Error("No se generaron blocks. Abortando antes de escribir en Postgres/Dynamo.");
            }

            console.log("RUNTIME_STATE args =>", {
                EVENT_ID,
                firstBlockSk: finalBlocks?.[0]?.sk,
                firstBlockId,
                typeof_EVENT_ID: typeof EVENT_ID,
                typeof_firstBlockId: typeof firstBlockId,
            });

            await pgEnsureEventRuntimeState(pgClient, EVENT_ID, firstBlockId);
        } else {
            console.warn("⚠️ No blocks generated, skipping event_runtime_state");
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
