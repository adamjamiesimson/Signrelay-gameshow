import assert from 'node:assert/strict';
import test from 'node:test';
import { leaderboard, player, ROUND_MS, score, streaks } from '../src/game.mjs';
import { newParty, nextPlayer, partyAction, roundNumber, turnResult } from '../src/party.mjs';
import { signIds } from '../src/signs.mjs';

const apply = (state, action) => partyAction(state, action, signIds);
const start = count => apply(newParty(), { type: 'start-game', entries: [
  { name: ' ', id: 'ignored' }, ...Array.from({ length: count }, (_, i) => ({ name: ' Same   name ', id: 'p' + i })),
] });

for (const count of [1, 2, 4, 8]) {
  test('rotates ' + count + ' players for five rounds with duplicate names and no stale awards', () => {
    let state = start(count);
    let previous;
    for (let index = 0; index < count * 5; index++) {
      const i = index % count;
      const round = Math.floor(index / count);
      const p = player(state);
      assert.equal(p.id, 'p' + i);
      assert.equal(p.name, 'Same name');
      assert.equal(roundNumber(state), round + 1);
      assert.equal(p.results.length, round);
      assert.equal(turnResult(state), undefined);
      assert.equal(nextPlayer(state)?.id, index === count * 5 - 1 ? undefined : 'p' + ((i + 1) % count));
      state = apply(state, { type: 'spin', personId: p.id, id: 'c' + index, sign: signIds[round], now: 0 });
      const key = { personId: p.id, challengeId: 'c' + index, run: 'run' + index };
      state = apply(state, { ...key, type: 'start', now: 1000 });
      if (previous) assert.equal(apply(state, previous), state);
      assert.equal(apply(state, { type: 'advance', turn: index }), state);
      previous = { ...key, type: 'result', method: round ? 'manual' : 'timeout', now: round ? 2400 : 1000 + ROUND_MS };
      state = apply(state, previous);
      assert.equal(turnResult(state).sign, signIds[round]);
      assert.equal(apply(state, previous), state);
      state = apply(state, { type: 'advance', turn: index });
      assert.equal(apply(state, { type: 'advance', turn: index }), state);
    }
    assert.equal(state.complete, true);
    assert.equal(player(state), undefined);
    assert.ok(state.people.every(p => score(p) === 40 && streaks(p).best === 4));
    assert.ok(leaderboard(state.people).every(p => p.rank === 1));
    const restart = apply(state, { type: 'restart-game' });
    assert.equal(player(restart).id, 'p0');
    assert.ok(restart.people.every(p => p.results.length === 0));
    const fresh = apply(restart, { type: 'new-game' });
    assert.deepEqual(fresh.people, []);
    assert.equal(fresh.settings.mode, 'relaxed');
  });
}
