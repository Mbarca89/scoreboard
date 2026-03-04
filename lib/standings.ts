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
  matchPoints: number[]
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
      matchPoints: [],
    })
  }
  return table.get(key)!
}

export function buildStandings(matches: Match[]): GroupStandings[] {
  const groupMap = new Map<string, Map<string, TeamStanding>>()

  for (const match of matches) {

    if (!match.group_id) continue
    if (!match.is_finished) continue

    const category = match.category
    const groupId = match.group_id
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
      left.matchPoints.push(POINTS.WIN)
      right.matchPoints.push(POINTS.LOSS)
    } else if (match.right_score > match.left_score) {
      right.won += 1
      left.lost += 1
      right.totalPoints += POINTS.WIN
      left.totalPoints += POINTS.LOSS
      right.matchPoints.push(POINTS.WIN)
      left.matchPoints.push(POINTS.LOSS)
    } else {
      left.drawn += 1
      right.drawn += 1
      left.totalPoints += POINTS.DRAW
      right.totalPoints += POINTS.DRAW
      left.matchPoints.push(POINTS.DRAW)
      right.matchPoints.push(POINTS.DRAW)
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
