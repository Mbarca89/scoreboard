import type { AXLCategory } from "./types"

export interface CategoryRule {
  maxPoints: number
  winCondition: "race" | "mercy"
  gameTimeSec: number
  breakTimeSec: number
  singleMatchBreakTimeSec: number
}

export const CATEGORY_RULES: Record<AXLCategory, CategoryRule> = {
  "5v5 D3/D4": {
    maxPoints: 3,
    winCondition: "mercy",
    gameTimeSec: 8 * 60,
    breakTimeSec: 61,
    singleMatchBreakTimeSec: 2 * 60,
  },
  "3v3 D4/D5": {
    maxPoints: 3,
    winCondition: "race",
    gameTimeSec: 5 * 60,
    breakTimeSec: 61,
    singleMatchBreakTimeSec: 2 * 60,
  },
  "3v3 D6": {
    maxPoints: 3,
    winCondition: "race",
    gameTimeSec: 5 * 60,
    breakTimeSec: 61,
    singleMatchBreakTimeSec: 2 * 60,
  },
  "3v3 Open": {
    maxPoints: 3,
    winCondition: "race",
    gameTimeSec: 5 * 60,
    breakTimeSec: 61,
    singleMatchBreakTimeSec: 2 * 60,
  },
}

export function getRulesForCategory(category: AXLCategory): CategoryRule {
  return CATEGORY_RULES[category]
}

export function hasReachedWinningScore(
  leftScore: number,
  rightScore: number,
  rule: Pick<CategoryRule, "maxPoints" | "winCondition">
): boolean {
  return rule.winCondition === "mercy"
    ? Math.abs(leftScore - rightScore) >= rule.maxPoints
    : Math.max(leftScore, rightScore) >= rule.maxPoints
}
