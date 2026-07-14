"use client"

import { useAudio } from "@/hooks/use-audio"
import { useEffect, useRef, useState } from "react"
import { SquareArrowDown } from "lucide-react"
const SOCKET_SCRIPT_SRC = "https://cdn.socket.io/4.7.5/socket.io.min.js"

type SocketConnection = {
    on: (event: string, cb: (...args: unknown[]) => void) => void
    off: (event: string, cb?: (...args: unknown[]) => void) => void
    disconnect: () => void
}

declare global {
    interface Window {
        io?: (url: string, options?: Record<string, unknown>) => SocketConnection
    }
}

export default function buttonTest() {

    const [socketConnected, setSocketConnected] = useState(false)
    const [lastButtonId, setLastButtonId] = useState<number | null>(null)
    const [socketError, setSocketError] = useState<string | null>(null)
    const lastSocketEventRef = useRef<{ buttonId: number; ts: number } | null>(null)
    const [buttonState, setButtonState] = useState({
        leftBase: false,
        rightBase: false,
        leftPit: false,
        rightPit: false
    })

    const { playWav } = useAudio()

    const handleBase = (side: String) => {
        playWav("base")
        if (side === "left") {
            setButtonState((prev) => ({
                ...prev,
                leftBase: !buttonState.leftBase
            }))
        } else {
            setButtonState((prev) => ({
                ...prev,
                rightBase: !buttonState.rightBase
            }))
        }
    }

    const handlePit = (side: String) => {
        playWav("concede")
        if (side === "left") {
            setButtonState((prev) => ({
                ...prev,
                leftPit: !buttonState.leftPit
            }))
        } else {
            setButtonState((prev) => ({
                ...prev,
                rightPit: !buttonState.rightPit
            }))
        }
    }

    useEffect(() => {
        let socket: SocketConnection | null = null
        let isMounted = true

        const connectSocket = () => {
            if (!isMounted || !window.io) return

            const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL ?? window.location.origin
            socket = window.io(socketUrl, {
                transports: ["polling", "websocket"],
                upgrade: true,
            })

            const onConnect = () => {
                if (!isMounted) return
                setSocketConnected(true)
                setSocketError(null)
            }

            const onDisconnect = () => {
                if (isMounted) setSocketConnected(false)
            }

            const onConnectError = (error: unknown) => {
                if (!isMounted) return
                const message = error instanceof Error ? error.message : "error de conexión"
                setSocketError(message)
            }

            const onButtonEvent = (payload: unknown) => {
                if (!payload || typeof payload !== "object") return

                const maybeButtonId = (payload as { buttonId?: unknown }).buttonId
                if (typeof maybeButtonId !== "number") return
                const now = Date.now()
                const last = lastSocketEventRef.current
                if (last && last.buttonId === maybeButtonId && now - last.ts < 250) {
                    return
                }
                lastSocketEventRef.current = { buttonId: maybeButtonId, ts: now }

                setLastButtonId(maybeButtonId)

                switch (maybeButtonId) {
                    case 1:
                        handleBase("left")
                        break
                    case 2:
                        handlePit("left")
                        break
                    case 3:
                        handleBase("right")
                        break
                    case 4:
                        handlePit("right")
                        break
                    default:
                        break
                }
            }

            socket.on("connect", onConnect)
            socket.on("disconnect", onDisconnect)
            socket.on("connect_error", onConnectError)
            socket.on("button_press", onButtonEvent)
            socket.on("button", onButtonEvent)
        }

        if (window.io) {
            connectSocket()
        } else {
            const script = document.createElement("script")
            script.src = SOCKET_SCRIPT_SRC
            script.async = true
            script.onload = () => connectSocket()
            document.body.appendChild(script)
        }

        return () => {
            isMounted = false
            if (socket) {
                socket.disconnect()
            }
        }
    }, [handleBase, handlePit,])

    return (
        <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background p-8">
            <div className="flex flex-col flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/60 px-3 py-2">
                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Socket</span>
                    <span className={`h-2.5 w-2.5 rounded-full ${socketConnected ? "bg-emerald-400" : "bg-red-500"}`} />
                    <span className="font-mono text-xs text-muted-foreground">{socketConnected ? "online" : "offline"}</span>
                </div>
                <span className="font-mono text-xs text-muted-foreground">BOTON RECIBIDO:{lastButtonId}</span>
            </div>

            {socketError && (
                <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {socketError}
                </div>
            )}
            <div className="flex flex-col items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">AXL Tournament</h1>
                <p className="text-sm text-muted-foreground">Prueba de botones</p>
            </div>
            <div className="flex gap-20">
                <div className="flex flex-col item-center justify-center">
                    <SquareArrowDown className={`h-20 w-20 ${buttonState.leftBase ? "text-primary" : "text-secondary"}`} />
                    <span className="text-sm font-semibold text-foreground">Base izquierda</span>
                </div>
                <div className="flex flex-col item-center justify-center">
                    <SquareArrowDown className={`h-20 w-20 ${buttonState.leftPit ? "text-primary" : "text-secondary"}`} />
                    <span className="text-sm font-semibold text-foreground">Pit izquierda</span>
                </div>
                <div className="flex flex-col item-center justify-center">
                    <SquareArrowDown className={`h-20 w-20 ${buttonState.rightBase ? "text-primary" : "text-secondary"}`} />
                    <span className="text-sm font-semibold text-foreground">Base Derecha</span>
                </div>
                <div className="flex flex-col item-center justify-center">
                    <SquareArrowDown className={`h-20 w-20 ${buttonState.rightPit ? "text-primary" : "text-secondary"}`} />
                    <span className="text-sm font-semibold text-foreground">Pit Derecha</span>
                </div>
            </div>
        </main>
    )
}
