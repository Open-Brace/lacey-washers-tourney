import { useEffect, useMemo, useState } from 'react'
import {
  Dices,
  Medal,
  RefreshCcw,
  RotateCcw,
  Save,
  Trophy,
  Wifi,
  WifiOff,
} from 'lucide-react'
import './App.css'
import {
  assignSeeds,
  createDefaultState,
  getChampion,
  getRoundName,
  getTeam,
  getTotalRounds,
  parsePlayers,
  randomizeTeams,
  resetScores,
  seedByDraw,
  startBracket,
  type Match,
  type Team,
  type TournamentState,
  updateScore,
} from './tournament'
import { supabase, tableName, tournamentId, type TournamentRow } from './supabase'

type SaveState = 'idle' | 'saving' | 'saved' | 'offline'

const numberValue = (value: number | undefined) => (value == null ? '' : String(value))
const parseScore = (value: string) => {
  if (value.trim() === '') return undefined
  return Math.max(0, Math.min(99, Number.parseInt(value, 10) || 0))
}

function App() {
  const [state, setState] = useState<TournamentState>(() => createDefaultState())
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [selectedRound, setSelectedRound] = useState(1)
  const [rosterOpen, setRosterOpen] = useState(false)
  const [rosterDraft, setRosterDraft] = useState(state.players.join('\n'))
  const totalRounds = getTotalRounds(state.matches)
  const champion = getChampion(state)
  const rounds = useMemo(
    () =>
      Array.from({ length: totalRounds }, (_, index) => index + 1).map((round) => ({
        round,
        matches: state.matches
          .filter((match) => match.round === round)
          .sort((a, b) => a.slot - b.slot),
      })),
    [state.matches, totalRounds],
  )

  useEffect(() => {
    let isMounted = true

    const load = async () => {
      const { data, error } = await supabase
        .from(tableName)
        .select('id,state,updated_at')
        .eq('id', tournamentId)
        .maybeSingle<TournamentRow>()

      if (!isMounted) return

      if (error) {
        setSaveState('offline')
        return
      }

      if (data?.state) {
        setState(data.state)
        setRosterDraft(data.state.players.join('\n'))
        setSelectedRound(Math.max(1, data.state.matches[0]?.round ?? 1))
        setSaveState('saved')
        return
      }

      const initialState = createDefaultState()
      setState(initialState)
      setRosterDraft(initialState.players.join('\n'))
      const { error: saveError } = await supabase.from(tableName).upsert({
        id: tournamentId,
        state: initialState,
      })
      setSaveState(saveError ? 'offline' : 'saved')
    }

    load()

    const channel = supabase
      .channel('tournament-state')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: tableName,
          filter: `id=eq.${tournamentId}`,
        },
        (payload) => {
          const row = payload.new as TournamentRow
          if (!row?.state) return
          setState(row.state)
          setRosterDraft(row.state.players.join('\n'))
          setSaveState('saved')
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setSaveState('saved')
      })

    return () => {
      isMounted = false
      supabase.removeChannel(channel)
    }
  }, [])

  const saveTournament = async (nextState: TournamentState, settledState: SaveState = 'saved') => {
    setSaveState('saving')

    const { error } = await supabase.from(tableName).upsert({
      id: tournamentId,
      state: nextState,
    })

    setSaveState(error ? 'offline' : settledState)
  }

  const updateTournament = (nextState: TournamentState) => {
    const stamped = { ...nextState, updatedBy: 'Party phone' }
    setState(stamped)
    saveTournament(stamped)
  }

  const handleRandomizeTeams = () => {
    const teams = randomizeTeams(state.players)
    updateTournament({
      ...state,
      teams,
      matches: [],
      status: 'setup',
    })
    setSelectedRound(1)
  }

  const handleApplyRoster = () => {
    const players = parsePlayers(rosterDraft)
    const teams = randomizeTeams(players)
    updateTournament({
      ...state,
      players,
      teams,
      matches: [],
      status: 'setup',
    })
    setRosterOpen(false)
  }

  const handleStartBracket = () => {
    const bracket = startBracket(state.teams)
    updateTournament({
      ...state,
      teams: bracket.teams,
      matches: bracket.matches,
      status: 'live',
    })
    setSelectedRound(1)
  }

  const handleSeedChange = (teamId: string, value: string) => {
    const seed = value === '' ? undefined : Number.parseInt(value, 10)
    updateTournament({
      ...state,
      teams: state.teams.map((team) => (team.id === teamId ? { ...team, seed } : team)),
      matches: [],
      status: 'setup',
    })
  }

  const handleScoreChange = (match: Match, side: 'A' | 'B', value: string) => {
    const matches = updateScore(state.matches, match.id, side, parseScore(value))
    updateTournament({
      ...state,
      matches,
      status: getChampion({ ...state, matches }) ? 'complete' : 'live',
    })
  }

  const handleResetScores = () => {
    updateTournament({
      ...state,
      matches: resetScores(state.matches),
      status: 'live',
    })
    setSelectedRound(1)
  }

  const handleAutoSeed = () => {
    updateTournament({
      ...state,
      teams: assignSeeds(state.teams),
      matches: [],
      status: 'setup',
    })
  }

  const handleSeedByDraw = () => {
    updateTournament({
      ...state,
      teams: seedByDraw(state.teams),
      matches: [],
      status: 'setup',
    })
  }

  return (
    <main>
      <header className="app-header">
        <div className="header-copy">
          <div className="event-mark">
            <span className="washer-dot" />
            Lacey's Graduation Washers
          </div>
          <h1>{state.title}</h1>
        </div>

        <div className={`sync-pill ${saveState}`}>
          {saveState === 'offline' ? <WifiOff size={16} /> : <Wifi size={16} />}
          <span>{saveState === 'saving' ? 'Saving' : saveState === 'offline' ? 'Offline' : 'Live'}</span>
        </div>
      </header>

      {champion ? (
        <section className="champion-banner">
          <div>
            <Medal size={28} />
            <span>Champions</span>
          </div>
          <strong>{champion.name}</strong>
        </section>
      ) : null}

      <section className="quick-actions" aria-label="Tournament actions">
        <button type="button" onClick={handleRandomizeTeams}>
          <Dices size={18} />
          Teams
        </button>
        <button type="button" onClick={handleStartBracket} disabled={state.teams.length < 2}>
          <Trophy size={18} />
          Bracket
        </button>
        <button type="button" onClick={handleResetScores} disabled={!state.matches.length}>
          <RotateCcw size={18} />
          Scores
        </button>
      </section>

      <section className="setup-panel">
        <div className="section-title">
          <div>
            <p>Teams</p>
            <h2>{state.teams.length} teams from {state.players.length} players</h2>
          </div>
          <button type="button" className="text-button" onClick={() => setRosterOpen(!rosterOpen)}>
            Roster
          </button>
        </div>

        {rosterOpen ? (
          <div className="roster-editor">
            <textarea
              aria-label="Player roster"
              value={rosterDraft}
              onChange={(event) => setRosterDraft(event.target.value)}
            />
            <button type="button" onClick={handleApplyRoster}>
              <Save size={18} />
              Apply
            </button>
          </div>
        ) : null}

        <div className="seed-actions">
          <button type="button" onClick={handleAutoSeed}>
            Auto seed
          </button>
          <button type="button" onClick={handleSeedByDraw}>
            Seed by draw
          </button>
          <button type="button" onClick={handleRandomizeTeams}>
            <RefreshCcw size={16} />
            Re-randomize
          </button>
        </div>

        <div className="team-grid">
          {state.teams.map((team) => (
            <TeamSeedCard
              key={team.id}
              team={team}
              onSeedChange={(value) => handleSeedChange(team.id, value)}
            />
          ))}
        </div>
      </section>

      <section className="bracket-panel">
        <div className="section-title">
          <div>
            <p>Bracket</p>
            <h2>{state.matches.length ? 'Enter scores to advance teams' : 'Start the bracket when teams look right'}</h2>
          </div>
          <span className="status-label">{state.status}</span>
        </div>

        {rounds.length ? (
          <>
            <nav className="round-tabs" aria-label="Bracket rounds">
              {rounds.map(({ round }) => (
                <button
                  type="button"
                  key={round}
                  className={selectedRound === round ? 'active' : ''}
                  onClick={() => setSelectedRound(round)}
                >
                  {getRoundName(round, totalRounds)}
                </button>
              ))}
            </nav>

            <div className="bracket-scroll">
              {rounds.map(({ round, matches }) => (
                <div
                  key={round}
                  className={`round-column ${selectedRound === round ? 'active' : ''}`}
                >
                  <h3>{getRoundName(round, totalRounds)}</h3>
                  {matches.map((match) => (
                    <MatchCard
                      key={match.id}
                      match={match}
                      teams={state.teams}
                      onScoreChange={handleScoreChange}
                    />
                  ))}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="empty-bracket">
            <img src="/washer-board.svg" alt="" />
            <p>Randomize teams, adjust seeds if needed, then tap Bracket.</p>
          </div>
        )}
      </section>
    </main>
  )
}

function TeamSeedCard({
  team,
  onSeedChange,
}: {
  team: Team
  onSeedChange: (value: string) => void
}) {
  return (
    <article className="team-card">
      <label>
        <span>Seed</span>
        <input
          inputMode="numeric"
          value={team.seed ?? ''}
          onChange={(event) => onSeedChange(event.target.value)}
        />
      </label>
      <div>
        <strong>{team.name}</strong>
        <p>{team.players.length === 1 ? 'Solo draw' : team.players.join(' / ')}</p>
      </div>
    </article>
  )
}

function MatchCard({
  match,
  teams,
  onScoreChange,
}: {
  match: Match
  teams: Team[]
  onScoreChange: (match: Match, side: 'A' | 'B', value: string) => void
}) {
  const teamA = getTeam(teams, match.teamAId)
  const teamB = getTeam(teams, match.teamBId)
  const waiting = !teamA && !teamB
  const pendingOpponent = match.round > 1 && (!teamA || !teamB)

  return (
    <article className={`match-card ${match.winnerId ? 'decided' : ''}`}>
      <TeamScoreRow
        team={teamA}
        winner={match.winnerId === teamA?.id}
        score={match.scoreA}
        disabled={!teamA || waiting || pendingOpponent}
        placeholder={teamA ? '0' : match.round === 1 ? 'Bye' : 'TBD'}
        onScoreChange={(value) => onScoreChange(match, 'A', value)}
      />
      <TeamScoreRow
        team={teamB}
        winner={match.winnerId === teamB?.id}
        score={match.scoreB}
        disabled={!teamB || waiting || pendingOpponent}
        placeholder={teamB ? '0' : match.round === 1 && teamA ? 'Bye' : 'TBD'}
        onScoreChange={(value) => onScoreChange(match, 'B', value)}
      />
      {waiting || pendingOpponent ? <p className="match-note">Waiting on earlier winners</p> : null}
    </article>
  )
}

function TeamScoreRow({
  team,
  winner,
  score,
  disabled,
  placeholder,
  onScoreChange,
}: {
  team?: Team
  winner: boolean
  score?: number
  disabled: boolean
  placeholder: string
  onScoreChange: (value: string) => void
}) {
  return (
    <div className={`score-row ${winner ? 'winner' : ''}`}>
      <div>
        <strong>{team?.name ?? placeholder}</strong>
        <span>{team?.seed ? `Seed ${team.seed}` : team ? 'Unseeded' : ''}</span>
      </div>
      <input
        aria-label={`${team?.name ?? placeholder} score`}
        inputMode="numeric"
        disabled={disabled}
        placeholder={placeholder}
        value={numberValue(score)}
        onChange={(event) => onScoreChange(event.target.value)}
      />
    </div>
  )
}

export default App
