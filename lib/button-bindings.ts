export const BUTTON_ACTIONS = [
  "BASE_LEFT",
  "PIT_LEFT",
  "BASE_RIGHT",
  "PIT_RIGHT",
] as const

export type ButtonAction = (typeof BUTTON_ACTIONS)[number]
export type ButtonBindings = Record<ButtonAction, number>

export const DEFAULT_BUTTON_BINDINGS: ButtonBindings = {
  BASE_LEFT: 1,
  PIT_LEFT: 2,
  BASE_RIGHT: 3,
  PIT_RIGHT: 4,
}

export const BUTTON_ACTION_LABELS: Record<ButtonAction, string> = {
  BASE_LEFT: "Base izquierda",
  PIT_LEFT: "Pit izquierda",
  BASE_RIGHT: "Base derecha",
  PIT_RIGHT: "Pit derecha",
}

export function isButtonAction(value: unknown): value is ButtonAction {
  return typeof value === "string" && BUTTON_ACTIONS.includes(value as ButtonAction)
}

export function isValidButtonId(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 255
}

export function actionForButtonId(
  bindings: ButtonBindings,
  buttonId: number
): ButtonAction | null {
  for (const action of BUTTON_ACTIONS) {
    if (bindings[action] === buttonId) return action
  }
  return null
}
