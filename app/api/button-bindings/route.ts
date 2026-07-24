import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import {
  BUTTON_ACTIONS,
  DEFAULT_BUTTON_BINDINGS,
  isButtonAction,
  isValidButtonId,
  type ButtonBindings,
} from "@/lib/button-bindings"

type BindingRow = {
  action: keyof ButtonBindings
  button_id: number
}

export async function GET() {
  const rows = await sql<BindingRow[]>`
    SELECT action, button_id
    FROM button_bindings
  `

  const bindings = { ...DEFAULT_BUTTON_BINDINGS }
  for (const row of rows) {
    bindings[row.action] = row.button_id
  }

  return NextResponse.json({ bindings })
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const action = body?.action
  const buttonId = body?.buttonId

  if (!isButtonAction(action) || !isValidButtonId(buttonId)) {
    return NextResponse.json(
      { error: "action inválida o buttonId fuera del rango 1-255" },
      { status: 400 }
    )
  }

  const conflicts = await sql<BindingRow[]>`
    SELECT action, button_id
    FROM button_bindings
    WHERE button_id = ${buttonId} AND action <> ${action}
  `
  if (conflicts.length > 0) {
    return NextResponse.json(
      { error: `El botón ${buttonId} ya está asignado a ${conflicts[0].action}` },
      { status: 409 }
    )
  }

  await sql`
    INSERT INTO button_bindings (action, button_id)
    VALUES (${action}, ${buttonId})
    ON CONFLICT (action)
    DO UPDATE SET button_id = EXCLUDED.button_id
  `

  const rows = await sql<BindingRow[]>`
    SELECT action, button_id
    FROM button_bindings
    WHERE action IN ${sql(BUTTON_ACTIONS)}
  `
  const bindings = { ...DEFAULT_BUTTON_BINDINGS }
  for (const row of rows) {
    bindings[row.action] = row.button_id
  }

  return NextResponse.json({ bindings })
}
