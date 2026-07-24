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

function mergeBindings(rows: BindingRow[]): ButtonBindings {
  const bindings = { ...DEFAULT_BUTTON_BINDINGS }
  for (const row of rows) {
    if (isButtonAction(row.action) && isValidButtonId(row.button_id)) {
      bindings[row.action] = row.button_id
    }
  }
  return bindings
}

export async function GET() {
  try {
    const rows = await sql<BindingRow[]>`
      SELECT action, button_id
      FROM public.button_bindings
    `

    return NextResponse.json({ bindings: mergeBindings(rows) })
  } catch (cause) {
    console.error("GET /api/button-bindings failed", cause)
    const detail = cause instanceof Error ? cause.message : String(cause)
    return NextResponse.json(
      { error: "No se pudo cargar la configuración de botones", detail },
      { status: 500 }
    )
  }
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const action = body?.action
  const buttonId = body?.buttonId

  if (!isButtonAction(action) || !isValidButtonId(buttonId)) {
    return NextResponse.json(
      { error: "Acción inválida o buttonId fuera del rango 1-255" },
      { status: 400 }
    )
  }

  try {
    const conflicts = await sql<BindingRow[]>`
      SELECT action, button_id
      FROM public.button_bindings
      WHERE button_id = ${buttonId} AND action <> ${action}
    `
    if (conflicts.length > 0) {
      return NextResponse.json(
        { error: `El botón ${buttonId} ya está asignado a ${conflicts[0].action}` },
        { status: 409 }
      )
    }

    await sql`
      INSERT INTO public.button_bindings (action, button_id)
      VALUES (${action}, ${buttonId})
      ON CONFLICT (action)
      DO UPDATE SET button_id = EXCLUDED.button_id, updated_at = now()
    `

    const rows = await sql<BindingRow[]>`
      SELECT action, button_id
      FROM public.button_bindings
      WHERE action IN ${sql(BUTTON_ACTIONS)}
    `

    return NextResponse.json({ bindings: mergeBindings(rows) })
  } catch (cause) {
    console.error("PUT /api/button-bindings failed", cause)
    const detail = cause instanceof Error ? cause.message : String(cause)
    return NextResponse.json(
      { error: "No se pudo guardar la configuración de botones", detail },
      { status: 500 }
    )
  }
}
