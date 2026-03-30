import { NextRequest } from "next/server"
import { getLiveState, subscribeLiveState } from "@/lib/live-state-store"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get("eventId")
  if (!eventId) {
    return new Response("eventId required", { status: 400 })
  }

  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (state: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(state)}\n\n`))
      }

      send(getLiveState(eventId))
      unsubscribe = subscribeLiveState(eventId, (state) => send(state))

      // keepalive
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(`event: ping\ndata: {}\n\n`))
      }, 15000)

      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat)
        if (unsubscribe) unsubscribe()
        controller.close()
      })
    },
    cancel() {
      if (unsubscribe) unsubscribe()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}
