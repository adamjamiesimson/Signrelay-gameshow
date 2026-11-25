import { cleanName, initial, MAX_ROUNDS, player, reduce, validateSettings } from './game.mjs';

export const newParty = settings => ({ ...initial(), settings: validateSettings(settings), turn: 0, complete: false });
export const roundNumber = state => state.people.length ? Math.min(MAX_ROUNDS, 1 + Math.floor(state.turn / state.people.length)) : 0;
export const nextPlayer = state => {
  const index = state.turn + 1;
  return !state.complete && index < state.people.length * MAX_ROUNDS ? state.people[index % state.people.length] : undefined;
};
export const turnResult = state => {
  const p = player(state);
  return p?.results[roundNumber(state) - 1];
};

export function partyAction(state, action, signs) {
  switch (action.type) {
    case 'new-game':
      return newParty(state.settings);
    case 'start-game': {
      if (state.people.length) return state;
      const ids = new Set();
      const people = [];
      for (const entry of action.entries) {
        const name = cleanName(entry.name);
        if (!name) continue;
        if (!entry.id || ids.has(entry.id)) return state;
        ids.add(entry.id);
        people.push({ id: entry.id, name, number: people.length + 1, results: [], pending: null });
      }
      return people.length ? { ...state, people, activeId: people[0].id } : state;
    }
    case 'restart-game':
      if (!state.people.length) return state;
      return { ...newParty(state.settings), activeId: state.people[0].id,
        people: state.people.map(p => ({ ...p, results: [], pending: null })) };
    case 'advance': {
      if (state.complete || !turnResult(state) || action.turn !== state.turn) return state;
      const next = nextPlayer(state);
      return next ? { ...state, turn: state.turn + 1, activeId: next.id } : { ...state, complete: true, activeId: null };
    }
    case 'settings':
    case 'correct':
      return reduce(state, action, signs);
    case 'spin':
      if (turnResult(state)) return state;
      return reduce(state, action, signs);
    case 'start':
    case 'pause':
    case 'restart':
    case 'skip':
    case 'result':
      return reduce(state, action, signs);
    default:
      return state;
  }
}
