import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  Medal,
  Trophy,
  Volume2,
  VolumeX,
} from 'lucide-react'
import './App.css'
import {
  createDefaultState,
  getChampion,
  getRoundName,
  getTeam,
  getTotalRounds,
  type Match,
  type Team,
  type TournamentState,
  updateScore,
} from './tournament'
import { supabase, tableName, tournamentId, type TournamentRow } from './supabase'

type SaveState = 'idle' | 'saving' | 'saved' | 'offline'
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

const hydrateLockedState = (savedState?: TournamentState): TournamentState => {
  const lockedState = createDefaultState()
  let matches = lockedState.matches

  const savedMatches = [...(savedState?.matches ?? [])].sort(
    (a, b) => a.round - b.round || a.slot - b.slot,
  )

  for (const match of savedMatches) {
    if (match.scoreA != null) {
      matches = updateScore(matches, match.id, 'A', match.scoreA)
    }

    if (match.scoreB != null) {
      matches = updateScore(matches, match.id, 'B', match.scoreB)
    }
  }

  return {
    ...lockedState,
    matches,
    status: getChampion({ ...lockedState, matches }) ? 'complete' : 'live',
    updatedBy: savedState?.updatedBy ?? lockedState.updatedBy,
  }
}

function App() {
  const [state, setState] = useState<TournamentState>(() => hydrateLockedState())
  const [, setSaveState] = useState<SaveState>('idle')
  const [selectedRound, setSelectedRound] = useState(1)
  const [editingScoreKey, setEditingScoreKey] = useState<string | null>(null)
  const [scoreDrafts, setScoreDrafts] = useState<ScoreDrafts>({})
  const [musicMuted, setMusicMuted] = useState(true)
  const stateRef = useRef(state)
  const audioRef = useRef<HTMLAudioElement | null>(null)
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
    stateRef.current = state
  }, [state])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    audio.volume = 0.72
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    audio.muted = musicMuted
    if (musicMuted) {
      audio.pause()
      return
    }

    void audio.play().catch(() => undefined)
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

      const lockedState = hydrateLockedState(data?.state)
      setState(lockedState)
      setSelectedRound(1)
      setSaveState('saved')

      const { error: saveError } = await supabase.from(tableName).upsert({
        id: tournamentId,
        state: lockedState,
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
          setState(hydrateLockedState(row.state))
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
    const stamped = { ...nextState, updatedBy: 'Scorekeeper' }
    stateRef.current = stamped
    setState(stamped)
    saveTournament(stamped)
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

  const handleMusicToggle = () => {
    setMusicMuted((muted) => {
      const nextMuted = !muted
      const audio = audioRef.current

      if (audio) {
        audio.muted = nextMuted
        if (!nextMuted) {
          void audio.play().catch(() => undefined)
        } else {
          audio.pause()
        }
      }

      return nextMuted
    })
  }

  return (
    <main>
      <audio ref={audioRef} src={partySongPath} loop muted={musicMuted} preload="auto" playsInline />
      <nav className="view-switch" aria-label="Tournament view">
        <div className="bracket-title">
          <Trophy size={18} />
          Bracket
        </div>
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

      <section className="bracket-panel">
        <div className="section-title">
          <div>
            <p>Bracket</p>
            <h2>Enter scores to advance teams</h2>
          </div>
          <div className="title-actions">
            <span className="status-label">{state.status}</span>
          </div>
        </div>

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
      </section>

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

export default App
