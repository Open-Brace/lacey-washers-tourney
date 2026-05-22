import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import {
  Dices,
  GripVertical,
  Medal,
  RefreshCcw,
  RotateCcw,
  Save,
  Trophy,
  Volume2,
  VolumeX,
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
type ActiveView = 'teams' | 'bracket'
type MatchSide = 'A' | 'B'
type ScoreDrafts = Record<string, string>

const numberValue = (value: number | undefined) => (value == null ? '' : String(value))
const scoreKey = (matchId: string, side: MatchSide) => `${matchId}:${side}`
const partySongPath = '/lacey-grad-party.mp3'
const parseScore = (value: string) => {
  if (value.trim() === '') return undefined
  return Math.max(0, Math.min(99, Number.parseInt(value, 10) || 0))
}
const cleanScoreDraft = (value: string) => value.replace(/\D/g, '').slice(0, 2)

function App() {
  const [state, setState] = useState<TournamentState>(() => createDefaultState())
  const [, setSaveState] = useState<SaveState>('idle')
  const [activeView, setActiveView] = useState<ActiveView>('teams')
  const [selectedRound, setSelectedRound] = useState(1)
  const [rosterOpen, setRosterOpen] = useState(false)
  const [rosterDraft, setRosterDraft] = useState(state.players.join('\n'))
  const [draggingTeamId, setDraggingTeamId] = useState<string | null>(null)
  const [editingScoreKey, setEditingScoreKey] = useState<string | null>(null)
  const [scoreDrafts, setScoreDrafts] = useState<ScoreDrafts>({})
  const [musicMuted, setMusicMuted] = useState(() => localStorage.getItem('laceyMusicMuted') === 'true')
  const stateRef = useRef(state)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const dragTeamIdRef = useRef<string | null>(null)
  const dragChangedRef = useRef(false)
  const totalRounds = getTotalRounds(state.matches)
  const champion = getChampion(state)
  const seededTeams = useMemo(() => sortTeamsBySeed(state.teams), [state.teams])
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
    stateRef.current = state
  }, [state])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    audio.volume = 0.72
    void audio.play().catch(() => undefined)

    const unlockAudio = () => {
      void audio.play().catch(() => undefined)
    }

    window.addEventListener('pointerdown', unlockAudio, { once: true })
    window.addEventListener('keydown', unlockAudio, { once: true })

    return () => {
      window.removeEventListener('pointerdown', unlockAudio)
      window.removeEventListener('keydown', unlockAudio)
    }
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    localStorage.setItem('laceyMusicMuted', String(musicMuted))

    if (!audio) return

    audio.muted = musicMuted
    if (!musicMuted) {
      void audio.play().catch(() => undefined)
    }
  }, [musicMuted])

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
    stateRef.current = stamped
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
    setActiveView('teams')
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
    setActiveView('teams')
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
    setActiveView('bracket')
    setSelectedRound(1)
  }

  const handleScoreFocus = (match: Match, side: MatchSide) => {
    const key = scoreKey(match.id, side)
    const score = side === 'A' ? match.scoreA : match.scoreB
    setEditingScoreKey(key)
    setScoreDrafts((drafts) => ({ ...drafts, [key]: numberValue(score) }))
  }

  const handleScoreDraftChange = (match: Match, side: MatchSide, value: string) => {
    const key = scoreKey(match.id, side)
    setScoreDrafts((drafts) => ({ ...drafts, [key]: cleanScoreDraft(value) }))
  }

  const handleScoreCommit = (match: Match, side: MatchSide, value: string) => {
    const key = scoreKey(match.id, side)
    const nextValue = cleanScoreDraft(value)
    const sourceState = stateRef.current
    const currentMatch = sourceState.matches.find((item) => item.id === match.id)
    const currentScore = side === 'A' ? currentMatch?.scoreA : currentMatch?.scoreB

    setEditingScoreKey((activeKey) => (activeKey === key ? null : activeKey))
    setScoreDrafts((drafts) => {
      const nextDrafts = { ...drafts }
      delete nextDrafts[key]
      return nextDrafts
    })

    if (numberValue(currentScore) === nextValue) return

    const matches = updateScore(sourceState.matches, match.id, side, parseScore(nextValue))
    updateTournament({
      ...sourceState,
      matches,
      status: getChampion({ ...sourceState, matches }) ? 'complete' : 'live',
    })
  }

  const handleResetScores = () => {
    updateTournament({
      ...state,
      matches: resetScores(state.matches),
      status: 'live',
    })
    setActiveView('bracket')
    setSelectedRound(1)
  }

  const handleAutoSeed = () => {
    updateTournament({
      ...state,
      teams: assignSeeds(state.teams),
      matches: [],
      status: 'setup',
    })
    setActiveView('teams')
  }

  const handleSeedByDraw = () => {
    updateTournament({
      ...state,
      teams: seedByDraw(state.teams),
      matches: [],
      status: 'setup',
    })
    setActiveView('teams')
  }

  const handleMusicToggle = () => {
    setMusicMuted((muted) => {
      const nextMuted = !muted
      const audio = audioRef.current

      if (audio) {
        audio.muted = nextMuted
        if (!nextMuted) {
          void audio.play().catch(() => undefined)
        }
      }

      return nextMuted
    })
  }

  const handleSeedDragStart = (teamId: string, event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragTeamIdRef.current = teamId
    dragChangedRef.current = false
    setDraggingTeamId(teamId)
  }

  const handleSeedDragMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!dragTeamIdRef.current) return

    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-team-id]')
    const targetTeamId = target?.dataset.teamId

    if (!targetTeamId || targetTeamId === dragTeamIdRef.current) return

    reorderSeedDraft(dragTeamIdRef.current, targetTeamId)
  }

  const handleSeedDragEnd = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    const shouldSave = dragChangedRef.current
    dragTeamIdRef.current = null
    dragChangedRef.current = false
    setDraggingTeamId(null)

    if (!shouldSave) return

    const nextState = { ...stateRef.current, updatedBy: 'Party phone' }
    stateRef.current = nextState
    setState(nextState)
    saveTournament(nextState)
  }

  const reorderSeedDraft = (activeTeamId: string, targetTeamId: string) => {
    const orderedTeams = sortTeamsBySeed(stateRef.current.teams)
    const activeIndex = orderedTeams.findIndex((team) => team.id === activeTeamId)
    const targetIndex = orderedTeams.findIndex((team) => team.id === targetTeamId)

    if (activeIndex < 0 || targetIndex < 0 || activeIndex === targetIndex) return

    const [activeTeam] = orderedTeams.splice(activeIndex, 1)
    orderedTeams.splice(targetIndex, 0, activeTeam)

    const nextState: TournamentState = {
      ...stateRef.current,
      teams: applySeedOrder(orderedTeams),
      matches: [],
      status: 'setup',
    }

    dragChangedRef.current = true
    stateRef.current = nextState
    setState(nextState)
  }

  return (
    <main>
      <audio ref={audioRef} src={partySongPath} autoPlay loop muted={musicMuted} preload="auto" playsInline />
      <nav className="view-switch" aria-label="Tournament view">
        <button
          type="button"
          className={activeView === 'teams' ? 'active' : ''}
          aria-pressed={activeView === 'teams'}
          onClick={() => setActiveView('teams')}
        >
          <Dices size={18} />
          Teams
        </button>
        <button
          type="button"
          className={activeView === 'bracket' ? 'active' : ''}
          aria-pressed={activeView === 'bracket'}
          onClick={() => setActiveView('bracket')}
        >
          <Trophy size={18} />
          Bracket
        </button>
        <button
          type="button"
          className="music-toggle"
          aria-label={musicMuted ? 'Unmute party song' : 'Mute party song'}
          aria-pressed={!musicMuted}
          title={musicMuted ? 'Unmute song' : 'Mute song'}
          onClick={handleMusicToggle}
        >
          {musicMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
      </nav>

      {champion ? (
        <section className="champion-banner">
          <div>
            <Medal size={28} />
            <span>Champions</span>
          </div>
          <strong>{champion.name}</strong>
        </section>
      ) : null}

      {activeView === 'teams' ? <section className="setup-panel">
        <div className="section-title">
          <div>
            <p>Teams</p>
            <h2>{state.teams.length} teams from {state.players.length} players</h2>
          </div>
          <div className="title-actions">
            <button type="button" className="text-button" onClick={() => setRosterOpen(!rosterOpen)}>
              Roster
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={handleStartBracket}
              disabled={state.teams.length < 2}
            >
              <Trophy size={16} />
              Bracket
            </button>
          </div>
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
          {seededTeams.map((team) => (
            <TeamSeedCard
              key={team.id}
              team={team}
              dragging={draggingTeamId === team.id}
              onDragStart={handleSeedDragStart}
              onDragMove={handleSeedDragMove}
              onDragEnd={handleSeedDragEnd}
            />
          ))}
        </div>
      </section> : null}

      {activeView === 'bracket' ? <section className="bracket-panel">
        <div className="section-title">
          <div>
            <p>Bracket</p>
            <h2>{state.matches.length ? 'Enter scores to advance teams' : 'Start the bracket when teams look right'}</h2>
          </div>
          <div className="title-actions">
            <span className="status-label">{state.status}</span>
            <button type="button" className="text-button" onClick={handleResetScores} disabled={!state.matches.length}>
              <RotateCcw size={16} />
              Scores
            </button>
          </div>
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
                      editingScoreKey={editingScoreKey}
                      scoreDrafts={scoreDrafts}
                      onScoreFocus={handleScoreFocus}
                      onScoreDraftChange={handleScoreDraftChange}
                      onScoreCommit={handleScoreCommit}
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
            <button
              type="button"
              className="primary-button"
              onClick={handleStartBracket}
              disabled={state.teams.length < 2}
            >
              <Trophy size={16} />
              Start bracket
            </button>
          </div>
        )}
      </section> : null}

      <RulesReference />
    </main>
  )
}

function RulesReference() {
  return (
    <section className="rules-panel" aria-labelledby="rules-heading">
      <div className="rules-heading">
        <p>Rules</p>
        <h2 id="rules-heading">Washers reference</h2>
      </div>

      <div className="rules-list">
        <div>
          <strong>Teams</strong>
          <span>Two players per team. Partners stand at opposite boards and stay there for the game.</span>
        </div>
        <div>
          <strong>Turns</strong>
          <span>Players alternate throws from the same side, then the next round is thrown back the other way.</span>
        </div>
        <div>
          <strong>Scoring</strong>
          <span>1 point for a washer in the box. 3 points for a washer in the cup.</span>
        </div>
        <div>
          <strong>Canceling</strong>
          <span>Only one team scores each round. Equal points cancel out, and the higher team gets the difference.</span>
        </div>
        <div>
          <strong>Winning</strong>
          <span>First team to 21 wins. Enter the final score here, and the bracket will advance the winner.</span>
        </div>
      </div>
    </section>
  )
}

function TeamSeedCard({
  team,
  dragging,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  team: Team
  dragging: boolean
  onDragStart: (teamId: string, event: PointerEvent<HTMLButtonElement>) => void
  onDragMove: (event: PointerEvent<HTMLButtonElement>) => void
  onDragEnd: (event: PointerEvent<HTMLButtonElement>) => void
}) {
  return (
    <article className={`team-card ${dragging ? 'dragging' : ''}`} data-team-id={team.id}>
      <div className="seed-rank">
        <span>Seed</span>
        <strong>{team.seed}</strong>
      </div>
      <div>
        <strong>{team.name}</strong>
        <p>{team.players.length === 1 ? 'Solo draw' : team.players.join(' / ')}</p>
      </div>
      <button
        type="button"
        className="drag-handle"
        aria-label={`Drag ${team.name} to reseed`}
        onPointerDown={(event) => onDragStart(team.id, event)}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      >
        <GripVertical size={22} />
      </button>
    </article>
  )
}

function MatchCard({
  match,
  teams,
  editingScoreKey,
  scoreDrafts,
  onScoreFocus,
  onScoreDraftChange,
  onScoreCommit,
}: {
  match: Match
  teams: Team[]
  editingScoreKey: string | null
  scoreDrafts: ScoreDrafts
  onScoreFocus: (match: Match, side: MatchSide) => void
  onScoreDraftChange: (match: Match, side: MatchSide, value: string) => void
  onScoreCommit: (match: Match, side: MatchSide, value: string) => void
}) {
  const teamA = getTeam(teams, match.teamAId)
  const teamB = getTeam(teams, match.teamBId)
  const waiting = !teamA && !teamB
  const pendingOpponent = match.round > 1 && (!teamA || !teamB)
  const scoreAKey = scoreKey(match.id, 'A')
  const scoreBKey = scoreKey(match.id, 'B')

  return (
    <article className={`match-card ${match.winnerId ? 'decided' : ''}`}>
      <TeamScoreRow
        scoreKey={scoreAKey}
        team={teamA}
        winner={match.winnerId === teamA?.id}
        score={match.scoreA}
        draftScore={scoreDrafts[scoreAKey]}
        editing={editingScoreKey === scoreAKey}
        disabled={!teamA || waiting || pendingOpponent}
        placeholder={teamA ? '0' : match.round === 1 ? 'Bye' : 'TBD'}
        onScoreFocus={() => onScoreFocus(match, 'A')}
        onScoreDraftChange={(value) => onScoreDraftChange(match, 'A', value)}
        onScoreCommit={(value) => onScoreCommit(match, 'A', value)}
      />
      <TeamScoreRow
        scoreKey={scoreBKey}
        team={teamB}
        winner={match.winnerId === teamB?.id}
        score={match.scoreB}
        draftScore={scoreDrafts[scoreBKey]}
        editing={editingScoreKey === scoreBKey}
        disabled={!teamB || waiting || pendingOpponent}
        placeholder={teamB ? '0' : match.round === 1 && teamA ? 'Bye' : 'TBD'}
        onScoreFocus={() => onScoreFocus(match, 'B')}
        onScoreDraftChange={(value) => onScoreDraftChange(match, 'B', value)}
        onScoreCommit={(value) => onScoreCommit(match, 'B', value)}
      />
      {waiting || pendingOpponent ? <p className="match-note">Waiting on earlier winners</p> : null}
    </article>
  )
}

function TeamScoreRow({
  scoreKey,
  team,
  winner,
  score,
  draftScore,
  editing,
  disabled,
  placeholder,
  onScoreFocus,
  onScoreDraftChange,
  onScoreCommit,
}: {
  scoreKey: string
  team?: Team
  winner: boolean
  score?: number
  draftScore?: string
  editing: boolean
  disabled: boolean
  placeholder: string
  onScoreFocus: () => void
  onScoreDraftChange: (value: string) => void
  onScoreCommit: (value: string) => void
}) {
  const value = editing ? (draftScore ?? numberValue(score)) : numberValue(score)

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.currentTarget.blur()
    }
  }

  return (
    <div className={`score-row ${winner ? 'winner' : ''} ${editing ? 'editing' : ''}`}>
      <div>
        <strong>{team?.name ?? placeholder}</strong>
        <span>{team?.seed ? `Seed ${team.seed}` : team ? 'Unseeded' : ''}</span>
      </div>
      <input
        key={scoreKey}
        aria-label={`${team?.name ?? placeholder} score`}
        inputMode="numeric"
        maxLength={2}
        pattern="[0-9]*"
        disabled={disabled}
        placeholder={placeholder}
        value={value}
        onFocus={onScoreFocus}
        onChange={(event) => onScoreDraftChange(event.target.value)}
        onBlur={(event) => onScoreCommit(event.target.value)}
        onKeyDown={handleKeyDown}
      />
    </div>
  )
}

const sortTeamsBySeed = (teams: Team[]) =>
  [...teams].sort((a, b) => (a.seed ?? Number.MAX_SAFE_INTEGER) - (b.seed ?? Number.MAX_SAFE_INTEGER))

const applySeedOrder = (teams: Team[]) =>
  teams.map((team, index) => ({
    ...team,
    seed: index + 1,
  }))

export default App
