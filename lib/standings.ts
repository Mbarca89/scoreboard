import type { Match } from "@/lib/types"

export interface TeamStanding {
  teamId: string
  teamName: string
  groupId: string
  category: string
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  goalDiff: number
  totalPoints: number
  matchResults: string[]
}

export interface GroupStandings {
  category: string
  groupId: string
  teams: TeamStanding[]
}

const POINTS = {
  WIN: 5,
  DRAW: 1,
  LOSS: 0,
}

function normalizeGroupId(groupId: string | null | undefined): string {
  const normalized = groupId?.trim()
  return normalized && normalized.length > 0 ? normalized : "Sin grupo"
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value === 1
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    return normalized === "true" || normalized === "t" || normalized === "1"
  }
  return false
}


function isByeMatch(match: Match): boolean {
  const leftId = String(match.left_team_id ?? "").trim().toUpperCase()
  const rightId = String(match.right_team_id ?? "").trim().toUpperCase()
  const leftName = String(match.left_team_name ?? "").trim().toUpperCase()
  const rightName = String(match.right_team_name ?? "").trim().toUpperCase()

  return leftId === "BYE" || rightId === "BYE" || leftName === "BYE" || rightName === "BYE"
}

function shouldCountMatch(match: Match): boolean {
  if (normalizeBoolean(match.is_finished)) return true
  if (match.finished_at) return true
  if (match.winner_team_id) return true
  if (match.result_type) return true
  return false
}

function ensureTeam(
  table: Map<string, TeamStanding>,
  key: string,
  data: Pick<TeamStanding, "teamId" | "teamName" | "groupId" | "category">
) {
  if (!table.has(key)) {
    table.set(key, {
      ...data,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDiff: 0,
      totalPoints: 0,
      matchResults: [],
    })
  }
  return table.get(key)!
}

export function buildStandings(
  matches: Match[],
  groupByBlockId: Record<string, string | null | undefined> = {}
): GroupStandings[] {
  const groupMap = new Map<string, Map<string, TeamStanding>>()

  for (const match of matches) {
    if (isByeMatch(match)) continue

    const category = match.category
    const resolvedGroupId = match.group_id ?? groupByBlockId[match.block_id] ?? null
    const groupId = normalizeGroupId(resolvedGroupId)
    const groupKey = `${category}::${groupId}`

    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, new Map())
    }

    const teamMap = groupMap.get(groupKey)!
    const left = ensureTeam(teamMap, match.left_team_id, {
      teamId: match.left_team_id,
      teamName: match.left_team_name,
      groupId,
      category,
    })
    const right = ensureTeam(teamMap, match.right_team_id, {
      teamId: match.right_team_id,
      teamName: match.right_team_name,
      groupId,
      category,
    })

    if (!shouldCountMatch(match)) {
      left.matchResults.push("P")
      right.matchResults.push("P")
      continue
    }

    left.played += 1
    right.played += 1

    left.goalsFor += match.left_score
    left.goalsAgainst += match.right_score
    right.goalsFor += match.right_score
    right.goalsAgainst += match.left_score

    if (match.left_score > match.right_score) {
      left.won += 1
      right.lost += 1
      left.totalPoints += POINTS.WIN
      right.totalPoints += POINTS.LOSS
      left.matchResults.push(`${match.left_score}-${match.right_score}`)
      right.matchResults.push(`${match.right_score}-${match.left_score}`)
    } else if (match.right_score > match.left_score) {
      right.won += 1
      left.lost += 1
      right.totalPoints += POINTS.WIN
      left.totalPoints += POINTS.LOSS
      right.matchResults.push(`${match.right_score}-${match.left_score}`)
      left.matchResults.push(`${match.left_score}-${match.right_score}`)
    } else {
      left.drawn += 1
      right.drawn += 1
      left.totalPoints += POINTS.DRAW
      right.totalPoints += POINTS.DRAW
      left.matchResults.push(`${match.left_score}-${match.right_score}`)
      right.matchResults.push(`${match.right_score}-${match.left_score}`)
    }
  }

  const groups: GroupStandings[] = []

  for (const [groupKey, teamMap] of groupMap.entries()) {
    const [category, groupId] = groupKey.split("::")
    const teams = Array.from(teamMap.values())
      .map((team) => ({
        ...team,
        goalDiff: team.goalsFor - team.goalsAgainst,
      }))
      .sort((a, b) => {
        if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints
        if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff
        if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor
        return a.teamName.localeCompare(b.teamName)
      })

    groups.push({ category, groupId, teams })
  }

  return groups.sort((a, b) => {
    const byCategory = a.category.localeCompare(b.category)
    if (byCategory !== 0) return byCategory
    return a.groupId.localeCompare(b.groupId)
  })
}
