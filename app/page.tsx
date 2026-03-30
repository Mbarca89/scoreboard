import Link from "next/link"
import { Monitor, Tv, List, Trophy, Dumbbell } from "lucide-react"

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background p-8">
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">AXL Tournament</h1>
        <p className="text-sm text-muted-foreground">Sistema de control de partidos</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Link
          href="/control?eventId=axl-2026-fecha-1"
          className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-8 transition-colors hover:border-primary/50 hover:bg-card/80"
        >
          <Monitor className="h-8 w-8 text-primary" />
          <span className="text-sm font-semibold text-foreground">Mesa de Control</span>
          <span className="text-center text-xs text-muted-foreground">
            Tablero principal del operador
          </span>
        </Link>

        <Link
          href="/marcador?eventId=axl-2026-fecha-1"
          className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-8 transition-colors hover:border-primary/50 hover:bg-card/80"
        >
          <Tv className="h-8 w-8 text-accent" />
          <span className="text-sm font-semibold text-foreground">Marcador</span>
          <span className="text-center text-xs text-muted-foreground">
            Vista publica del marcador
          </span>
        </Link>

        <Link
          href="/fixture?eventId=axl-2026-fecha-1"
          className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-8 transition-colors hover:border-primary/50 hover:bg-card/80"
        >
          <List className="h-8 w-8 text-chart-3" />
          <span className="text-sm font-semibold text-foreground">Fixture</span>
          <span className="text-center text-xs text-muted-foreground">
            Vista completa del fixture
          </span>
        </Link>

        <Link
          href="/scores?eventId=axl-2026-fecha-1"
          className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-8 transition-colors hover:border-primary/50 hover:bg-card/80"
        >
          <Trophy className="h-8 w-8 text-chart-2" />
          <span className="text-sm font-semibold text-foreground">Scores</span>
          <span className="text-center text-xs text-muted-foreground">
            Tabla de puntajes por grupo
          </span>
        </Link>

        <Link
          href="/training?eventId=axl-2026-fecha-1"
          className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-8 transition-colors hover:border-primary/50 hover:bg-card/80"
        >
          <Dumbbell className="h-8 w-8 text-emerald-400" />
          <span className="text-sm font-semibold text-foreground">Modo entrenamiento</span>
          <span className="text-center text-xs text-muted-foreground">
            Cronómetro y botonera de práctica
          </span>
        </Link>
      </div>
    </main>
  )
}
