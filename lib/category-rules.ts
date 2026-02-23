import type { AXLCategory } from "./types"

export interface CategoryRule {
  maxPoints: number
  gameTimeSec: number
  breakTimeSec: number
  singleMatchBreakTimeSec: number
}

export const CATEGORY_RULES: Record<AXLCategory, CategoryRule> = {
  "5v5 D3/D4": {
    maxPoints: 3,
    gameTimeSec: 18 * 60,
    breakTimeSec: 60,
    singleMatchBreakTimeSec: 2 * 60,
  },
  "3v3 D5": {
    maxPoints: 3,
    gameTimeSec: 5 * 60,
    breakTimeSec: 60,
    singleMatchBreakTimeSec: 2 * 60,
  },
  "3v3 D6": {
    maxPoints: 2,
    gameTimeSec: 5 * 60,
    breakTimeSec: 60,
    singleMatchBreakTimeSec: 2 * 60,
  },
}

export function getRulesForCategory(category: AXLCategory): CategoryRule {
  return CATEGORY_RULES[category]
}
