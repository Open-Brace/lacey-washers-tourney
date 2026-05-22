export type Team = {
  id: string
  name: string
  players: string[]
  seed?: number
}

export type Match = {
  id: string
  round: number
  slot: number
  teamAId?: string
  teamBId?: string
  scoreA?: number
  scoreB?: number
  winnerId?: string
  nextMatchId?: string
  nextSlot?: 'A' | 'B'
}

export type TournamentState = {
  title: string
  players: string[]
  teams: Team[]
  matches: Match[]
  status: 'setup' | 'live' | 'complete'
  updatedBy: string
}

export const defaultPlayers = [
  'Grandma',
  'Grandpa',
  'George 4',
  'Theresa',
  'George 5',
  'Alex',
  'Collin',
  'Kathy',
  'Rob',
  'Kyle',
  'Lacey',
  'Tom',
  'Maria',
  'Brady',
  'Stella',
  'Eli',
  'Charlie',
]

export const createDefaultState = (): TournamentState => {
  const teams = randomizeTeams(defaultPlayers)

  return {
    title: "I Can't Believe Lacey Graduated From College",
    players: defaultPlayers,
    teams,
    matches: [],
    status: 'setup',
    updatedBy: 'Initial draw',
  }
}

export const parsePlayers = (value: string) =>
  value
    .split('\n')
    .map((player) => player.trim())
    .filter(Boolean)

export const randomizeTeams = (players: string[]): Team[] => {
  const shuffled = shuffle(players)
  const teams: Team[] = []

  for (let index = 0; index < shuffled.length; index += 2) {
    const teamPlayers = shuffled.slice(index, index + 2)
    teams.push({
      id: createId(),
      name: teamPlayers.join(' & '),
      players: teamPlayers,
      seed: teams.length + 1,
    })
  }

  return teams
}

const createId = () => {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  return `team-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export const assignSeeds = (teams: Team[]) =>
  normalizeSeeds(teams.map((team, index) => ({ ...team, seed: team.seed ?? index + 1 })))

export const seedByDraw = (teams: Team[]) =>
  shuffle(teams).map((team, index) => ({ ...team, seed: index + 1 }))

export const startBracket = (teams: Team[]): { teams: Team[]; matches: Match[] } => {
  const seededTeams = assignSeeds(teams)
  return {
    teams: seededTeams,
    matches: advanceWinners(createBracket(seededTeams)),
  }
}

export const updateScore = (
  matches: Match[],
  matchId: string,
  side: 'A' | 'B',
  value: number | undefined,
) =>
  advanceWinners(
    matches.map((match) =>
      match.id === matchId
        ? {
            ...match,
            scoreA: side === 'A' ? value : match.scoreA,
            scoreB: side === 'B' ? value : match.scoreB,
          }
        : match,
    ),
  )

export const updateMatchWinner = (matches: Match[], matchId: string, winnerId: string) =>
  advanceWinners(
    matches.map((match) =>
      match.id === matchId
        ? {
            ...match,
            winnerId,
            scoreA: match.teamAId === winnerId && match.scoreA == null ? 1 : match.scoreA,
            scoreB: match.teamBId === winnerId && match.scoreB == null ? 1 : match.scoreB,
          }
        : match,
    ),
  )

export const resetScores = (matches: Match[]) =>
  advanceWinners(
    matches.map((match) => ({
      ...match,
      scoreA: undefined,
      scoreB: undefined,
      winnerId: undefined,
    })),
  )

export const getRoundName = (round: number, totalRounds: number) => {
  const remaining = totalRounds - round

  if (remaining === 0) return 'Final'
  if (remaining === 1) return 'Semis'
  if (remaining === 2) return 'Quarters'
  return `Round ${round}`
}

export const getTeam = (teams: Team[], teamId?: string) =>
  teams.find((team) => team.id === teamId)

export const getTotalRounds = (matches: Match[]) =>
  matches.reduce((max, match) => Math.max(max, match.round), 0)

export const getChampion = (state: TournamentState) => {
  const totalRounds = getTotalRounds(state.matches)
  const final = state.matches.find((match) => match.round === totalRounds)
  return getTeam(state.teams, final?.winnerId)
}

const createBracket = (teams: Team[]) => {
  const bracketSize = nextPowerOfTwo(teams.length)
  const totalRounds = Math.log2(bracketSize)
  const seeded = [...teams].sort((a, b) => (a.seed ?? 999) - (b.seed ?? 999))
  const seedSlots = getSeedSlots(bracketSize)
  const firstRoundSlots = seedSlots.map((seed) => seeded[seed - 1]?.id)
  const matches: Match[] = []

  for (let round = 1; round <= totalRounds; round += 1) {
    const matchesInRound = bracketSize / 2 ** round

    for (let slot = 0; slot < matchesInRound; slot += 1) {
      const id = `r${round}-m${slot + 1}`
      const isLastRound = round === totalRounds
      const nextSlot = slot % 2 === 0 ? 'A' : 'B'

      matches.push({
        id,
        round,
        slot,
        teamAId: round === 1 ? firstRoundSlots[slot * 2] : undefined,
        teamBId: round === 1 ? firstRoundSlots[slot * 2 + 1] : undefined,
        nextMatchId: isLastRound ? undefined : `r${round + 1}-m${Math.floor(slot / 2) + 1}`,
        nextSlot: isLastRound ? undefined : nextSlot,
      })
    }
  }

  return matches
}

const advanceWinners = (matches: Match[]) => {
  const oldMatches = new Map(matches.map((match) => [match.id, match]))
  const nextMatches: Match[] = matches.map((match) =>
    match.round === 1
      ? { ...match, winnerId: undefined }
      : { ...match, teamAId: undefined, teamBId: undefined, winnerId: undefined },
  )
  const matchById = new Map(nextMatches.map((match) => [match.id, match]))
  const totalRounds = getTotalRounds(nextMatches)

  for (let round = 1; round <= totalRounds; round += 1) {
    const roundMatches = nextMatches
      .filter((match) => match.round === round)
      .sort((a, b) => a.slot - b.slot)

    for (const match of roundMatches) {
      const previous = oldMatches.get(match.id)
      const participantsChanged =
        round > 1 &&
        previous &&
        (previous.teamAId !== match.teamAId || previous.teamBId !== match.teamBId)

      if (participantsChanged) {
        match.scoreA = undefined
        match.scoreB = undefined
      }

      match.winnerId = pickWinner(match)

      if (!match.winnerId || !match.nextMatchId || !match.nextSlot) continue

      const nextMatch = matchById.get(match.nextMatchId)
      if (!nextMatch) continue

      if (match.nextSlot === 'A') {
        nextMatch.teamAId = match.winnerId
      } else {
        nextMatch.teamBId = match.winnerId
      }
    }
  }

  return nextMatches
}

const pickWinner = (match: Match) => {
  if (match.round === 1 && match.teamAId && !match.teamBId) return match.teamAId
  if (match.round === 1 && match.teamBId && !match.teamAId) return match.teamBId
  if (!match.teamAId || !match.teamBId) return undefined

  if (match.scoreA == null || match.scoreB == null || match.scoreA === match.scoreB) {
    return match.winnerId
  }

  return match.scoreA > match.scoreB ? match.teamAId : match.teamBId
}

const normalizeSeeds = (teams: Team[]) => {
  const usedSeeds = new Set<number>()
  const normalized = teams.map((team) => {
    const seed =
      Number.isInteger(team.seed) && team.seed && team.seed > 0 && !usedSeeds.has(team.seed)
        ? team.seed
        : undefined

    if (seed) usedSeeds.add(seed)

    return { ...team, seed }
  })
  const openSeeds = Array.from({ length: teams.length }, (_, index) => index + 1).filter(
    (seed) => !usedSeeds.has(seed),
  )
  let openSeedIndex = 0

  return normalized.map((team) => {
    if (team.seed) return team

    const seed = openSeeds[openSeedIndex]
    openSeedIndex += 1
    return { ...team, seed }
  })
}

const getSeedSlots = (size: number): number[] => {
  let slots = [1, 2]

  while (slots.length < size) {
    const mirror = slots.length * 2 + 1
    slots = slots.flatMap((seed) => [seed, mirror - seed])
  }

  return slots
}

const nextPowerOfTwo = (value: number) => 2 ** Math.ceil(Math.log2(Math.max(2, value)))

const shuffle = <T,>(items: T[]) => {
  const result = [...items]

  for (let index = result.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1))
    ;[result[index], result[randomIndex]] = [result[randomIndex], result[index]]
  }

  return result
}
