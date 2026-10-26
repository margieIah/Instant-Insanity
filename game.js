/* Instant Insanity — puzzle logic + game UI.
 * The first half (Puzzle) is pure logic with no DOM, so it can also run in Node for testing.
 * The second half wires up the page, three.js view, controls, timer and dialogs. */
(function (root) {
  'use strict';

  /* ================= Puzzle logic ================= */

  // Face positions: top, bottom, left, right, front, back. Opposites: 0-1, 2-3, 4-5.
  const U = 0, D = 1, L = 2, R = 3, F = 4, B = 5;
  const FACE_NAMES = ['top', 'bottom', 'left', 'right', 'front', 'back'];
  // Outward normals (x right, y up, z toward the viewer).
  const NORMALS = [[0, 1, 0], [0, -1, 0], [-1, 0, 0], [1, 0, 0], [0, 0, 1], [0, 0, -1]];

  // Classic Parker Brothers set, faces in the order above.
  const CUBES = [
    ['B', 'W', 'R', 'R', 'R', 'G'],
    ['R', 'B', 'G', 'G', 'W', 'B'],
    ['R', 'W', 'B', 'R', 'G', 'W'],
    ['G', 'W', 'B', 'W', 'R', 'G'],
  ];
  const COLOR_NAMES = { R: 'red', G: 'green', B: 'blue', W: 'white' };

  const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
  // A move is a +/-90 degree turn about a world axis (right-hand rule).
  const MOVES = {
    tiltF:   { axis: 'x', sign: 1,  label: 'Tilt forward',            inverse: 'tiltB' },
    tiltB:   { axis: 'x', sign: -1, label: 'Tilt back',               inverse: 'tiltF' },
    rollL:   { axis: 'z', sign: 1,  label: 'Roll left',               inverse: 'rollR' },
    rollR:   { axis: 'z', sign: -1, label: 'Roll right',              inverse: 'rollL' },
    spinCW:  { axis: 'y', sign: -1, label: 'Spin clockwise',          inverse: 'spinCCW' },
    spinCCW: { axis: 'y', sign: 1,  label: 'Spin counter-clockwise',  inverse: 'spinCW' },
  };
  const MOVE_NAMES = Object.keys(MOVES);

  // Rotate integer vector v by sign*90deg about unit axis a: v' = a(a.v) + sign(a x v).
  function rot90(v, a, sign) {
    const d = a[0] * v[0] + a[1] * v[1] + a[2] * v[2];
    const c = [a[1] * v[2] - a[2] * v[1], a[2] * v[0] - a[0] * v[2], a[0] * v[1] - a[1] * v[0]];
    return [0, 1, 2].map(i => a[i] * d + sign * c[i]);
  }
  function faceOf(n) {
    return NORMALS.findIndex(m => m[0] === n[0] && m[1] === n[1] && m[2] === n[2]);
  }
  // src[j] = which old face position ends up at position j after the move.
  function movePerm(name) {
    const m = MOVES[name], src = new Array(6);
    for (let i = 0; i < 6; i++) src[faceOf(rot90(NORMALS[i], AXES[m.axis], m.sign))] = i;
    return src;
  }
  const PERM = {};
  MOVE_NAMES.forEach(k => { PERM[k] = movePerm(k); });

  function applyMove(faces, name) {
    return PERM[name].map(i => faces[i]);
  }

  // All 24 orientations as permutations of the base faces (BFS from the identity).
  const ORIENTS = [];
  const ORIENT_INDEX = new Map();
  (function buildOrients() {
    const start = [0, 1, 2, 3, 4, 5];
    ORIENTS.push(start);
    ORIENT_INDEX.set(start.join(''), 0);
    for (let q = 0; q < ORIENTS.length; q++) {
      for (const m of MOVE_NAMES) {
        const p = applyMove(ORIENTS[q], m), key = p.join('');
        if (!ORIENT_INDEX.has(key)) { ORIENT_INDEX.set(key, ORIENTS.length); ORIENTS.push(p); }
      }
    }
  })();
  const N_ORIENT = ORIENTS.length;
  // NEXT[o][move] = orientation index after the move.
  const NEXT = ORIENTS.map(p => {
    const row = {};
    MOVE_NAMES.forEach(m => { row[m] = ORIENT_INDEX.get(applyMove(p, m).join('')); });
    return row;
  });
  // DIST[a][b] = fewest quarter-turn moves from orientation a to b.
  const DIST = ORIENTS.map((_, a) => {
    const d = new Array(N_ORIENT).fill(-1), queue = [a];
    d[a] = 0;
    while (queue.length) {
      const o = queue.shift();
      for (const m of MOVE_NAMES) {
        const n = NEXT[o][m];
        if (d[n] < 0) { d[n] = d[o] + 1; queue.push(n); }
      }
    }
    return d;
  });

  function facesOf(cubeId, orient) {
    return ORIENTS[orient].map(k => CUBES[cubeId][k]);
  }

  const SIDES = [F, B, L, R];
  // Solved when each long side shows R, G, B, W exactly once.
  function isWin(faceLists) {
    return SIDES.every(s => new Set(faceLists.map(f => f[s])).size === 4);
  }
  function isWinOrients(orients) {
    return isWin(orients.map((o, id) => facesOf(id, o)));
  }

  // Winning orientation tuples, indexed by cube id. (Cube order never affects the win check.)
  let solutionsCache = null;
  function solutions() {
    if (solutionsCache) return solutionsCache;
    const faces = CUBES.map((_, id) => ORIENTS.map((_, o) => facesOf(id, o)));
    const out = [];
    const distinct = (list, s) => new Set(list.map(f => f[s])).size === list.length;
    const ok = list => SIDES.every(s => distinct(list, s));
    for (let a = 0; a < N_ORIENT; a++)
      for (let b = 0; b < N_ORIENT; b++) {
        if (!ok([faces[0][a], faces[1][b]])) continue;
        for (let c = 0; c < N_ORIENT; c++) {
          if (!ok([faces[0][a], faces[1][b], faces[2][c]])) continue;
          for (let d = 0; d < N_ORIENT; d++)
            if (ok([faces[0][a], faces[1][b], faces[2][c], faces[3][d]])) out.push([a, b, c, d]);
        }
      }
    solutionsCache = out;
    return out;
  }

  // The orientation of a cube with the given front/left colors (and matching opposites).
  function findOrientation(cubeId, front, back, left, right) {
    for (let o = 0; o < N_ORIENT; o++) {
      const f = facesOf(cubeId, o);
      if (f[F] === front && f[B] === back && f[L] === left && f[R] === right) return o;
    }
    return -1;
  }

  // Fewest-moves solution as [{ id, move }]. Cubes turn independently, so the optimum is the
  // nearest winning stack, reached by a shortest path for each cube. Never more than 8 moves.
  function shortestSolution(orients) {
    let best = null, bestTotal = Infinity;
    for (const sol of solutions()) {
      const total = sol.reduce((t, o, id) => t + DIST[orients[id]][o], 0);
      if (total < bestTotal) { bestTotal = total; best = sol; }
    }
    const steps = [];
    best.forEach((target, id) => {
      let o = orients[id];
      while (o !== target) {
        const move = MOVE_NAMES.find(m => DIST[NEXT[o][m]][target] === DIST[o][target] - 1);
        steps.push({ id, move });
        o = NEXT[o][move];
      }
    });
    return steps;
  }

  // Suggest one move that brings the stack closer to the nearest solution.
  function hint(orients, preferId) {
    const steps = shortestSolution(orients);
    if (!steps.length) return null;
    const step = steps.find(s => s.id === preferId) || steps[0];
    return { id: step.id, move: step.move, total: steps.length };
  }

  function randomOrients(rand) {
    rand = rand || Math.random;
    let o;
    do { o = CUBES.map(() => Math.floor(rand() * N_ORIENT)); } while (isWinOrients(o));
    return o;
  }

  // Self-test: returns [{ name, pass, detail }].
  function runSelfTest() {
    const results = [];
    const check = (name, pass, detail) => results.push({ name, pass: !!pass, detail: detail || '' });
    const opposite = [1, 0, 3, 2, 5, 4];

    check('A cube has exactly 24 orientations', N_ORIENT === 24, `found ${N_ORIENT}`);

    // Solved stack from the graph-theory solution (front/back: R-1-G-4-W-2-B-3-R; left/right: R-4-G-3-W-1-B-2-R).
    const solved = [
      findOrientation(0, 'R', 'G', 'W', 'B'),
      findOrientation(1, 'W', 'B', 'B', 'R'),
      findOrientation(2, 'B', 'R', 'G', 'W'),
      findOrientation(3, 'G', 'W', 'R', 'G'),
    ];
    check('Solved orientation passes the win check',
      solved.every(o => o >= 0) && isWinOrients(solved), `orientations ${solved.join(', ')}`);
    check('Starting (unrotated) stack is not solved', !isWinOrients([0, 0, 0, 0]));

    let pairsOk = true, perms = true;
    for (const m of MOVE_NAMES) {
      // Positions that were opposite must stay opposite.
      const src = PERM[m];
      for (let j = 0; j < 6; j++) if (src[opposite[j]] !== opposite[src[j]]) perms = false;
      // ...and every cube in every orientation keeps the same three color pairs.
      CUBES.forEach((_, id) => ORIENTS.forEach((_, o) => {
        const pairs = f => [0, 2, 4].map(i => [f[i], f[i + 1]].sort().join('')).sort().join(',');
        const before = facesOf(id, o);
        if (pairs(before) !== pairs(applyMove(before, m))) pairsOk = false;
      }));
    }
    check('Every rotation keeps opposite faces opposite', perms && pairsOk);

    let fourOk = true, inverseOk = true;
    for (const m of MOVE_NAMES)
      for (let o = 0; o < N_ORIENT; o++) {
        let x = o;
        for (let k = 0; k < 4; k++) x = NEXT[x][m];
        if (x !== o) fourOk = false;
        if (NEXT[NEXT[o][m]][MOVES[m].inverse] !== o) inverseOk = false;
      }
    check('Four identical rotations return a cube to its start', fourOk);
    check('Each move is undone by its inverse', inverseOk);

    const sols = solutions();
    check('Exactly 8 winning orientations with cube order fixed', sols.length === 8, `found ${sols.length}`);

    let scrambleOk = true;
    for (let i = 0; i < 200; i++) if (isWinOrients(randomOrients())) scrambleOk = false;
    check('New scrambles are never already solved', scrambleOk);

    const h = hint([0, 0, 0, 0]);
    check('Hint moves one step closer to a solution', h && hint(
      [0, 1, 2, 3].map(id => (id === h.id ? NEXT[0][h.move] : 0))).total === h.total - 1);

    let shortestOk = true;
    for (let i = 0; i < 200; i++) {
      const o = randomOrients(), steps = shortestSolution(o), x = o.slice();
      steps.forEach(s => { x[s.id] = NEXT[x[s.id]][s.move]; });
      if (!isWinOrients(x) || steps.length > 8) shortestOk = false;
    }
    check('Shortest solution solves random stacks in at most 8 moves', shortestOk);
    return results;
  }

  const Puzzle = {
    U, D, L, R, F, B, FACE_NAMES, CUBES, COLOR_NAMES, MOVES, MOVE_NAMES, PERM, ORIENTS, NEXT, DIST,
    applyMove, facesOf, isWin, isWinOrients, solutions, findOrientation, shortestSolution, hint, randomOrients,
    runSelfTest,
  };
  root.Puzzle = Puzzle;
  if (typeof module !== 'undefined' && module.exports) module.exports = Puzzle;
  if (typeof document === 'undefined') return;

  /* ================= Game UI ================= */

  const $ = sel => document.querySelector(sel);
  const HEX = { R: '#d62828', G: '#1f9a48', B: '#1d4ed8', W: '#f4f4ef' };
  const BEST_KEY = 'instant-insanity-best';
  const LETTERS_KEY = 'instant-insanity-letters';

  const store = {
    get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } },
    set(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };

  const state = {
    order: [0, 1, 2, 3],       // bottom -> top, values are cube ids
    ori: [0, 0, 0, 0],         // orientation per cube id
    start: null,               // snapshot for Reset
    moves: 0, swaps: 0, undos: 0, hints: 0,
    history: [],
    startTs: null, endTs: null,
    won: false,
    selected: null,
    letters: store.get(LETTERS_KEY) === true,
    assisted: false,           // solver was shown or played: the win doesn't count as a best
    solutionOpen: false,
    playing: false, playSteps: [], playIndex: 0,
  };
  let view = null;
  let playToken = 0;

  function elapsedMs() {
    if (state.startTs == null) return 0;
    return (state.endTs || Date.now()) - state.startTs;
  }
  function fmtTime(ms) {
    const s = Math.floor(ms / 1000);
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  function announce(msg) { $('#live').textContent = msg; }
  function towerPos(id) { return state.order.indexOf(id); }
  function posLabel(id) {
    const p = towerPos(id);
    return p === 3 ? 'top' : p === 0 ? 'bottom' : p === 2 ? '2nd from top' : '3rd from top';
  }

  /* ---------- attempts ---------- */

  function beginAttempt() {
    state.start = { order: state.order.slice(), ori: state.ori.slice() };
    state.moves = state.swaps = state.undos = state.hints = 0;
    state.history = [];
    state.startTs = state.endTs = null;
    state.won = false;
    playToken++;
    state.playing = false;
    state.assisted = false;
    state.solutionOpen = false;
    state.playSteps = [];
    $('#hint-text').textContent = '';
    if (view) view.snap();
    refresh();
  }
  function newScramble() {
    state.ori = randomOrients();
    beginAttempt();
    announce('New scramble. Timer starts on your first move.');
  }
  function resetAttempt() {
    state.order = state.start.order.slice();
    state.ori = state.start.ori.slice();
    beginAttempt();
    announce('Reset to the start of this scramble.');
  }

  function rotate(name, id, bySolver) {
    if (id == null) id = state.selected;
    if (state.won || id == null || (state.playing && !bySolver)) return;
    state.ori[id] = NEXT[state.ori[id]][name];
    state.moves++;
    if (state.startTs == null) state.startTs = Date.now();
    state.history.push({ type: 'move', id, move: name });
    if (view) view.queueRotation(id, name, facesOf(id, state.ori[id]), bySolver ? 480 : 0);
    announce(`Cube ${id + 1}: ${MOVES[name].label.toLowerCase()}. ${state.moves} moves.`);
    afterChange();
  }
  function swap(dir) {
    const id = state.selected;
    if (state.won || state.playing || id == null) return;
    const p = towerPos(id), q = p + dir;
    if (q < 0 || q > 3) return;
    doSwap(p, q);
    state.swaps++;
    state.history.push({ type: 'swap', p, q });
    announce(`Cube ${id + 1} moved ${dir > 0 ? 'up' : 'down'}.`);
    afterChange();
  }
  function doSwap(p, q) {
    const o = state.order;
    [o[p], o[q]] = [o[q], o[p]];
    if (view) view.queueSwap(o.slice());
  }
  function undo() {
    if (state.won || state.playing) return;
    const last = state.history.pop();
    if (!last) return;
    state.undos++;
    if (last.type === 'move') {
      const inv = MOVES[last.move].inverse;
      state.ori[last.id] = NEXT[state.ori[last.id]][inv];
      if (view) view.queueRotation(last.id, inv, facesOf(last.id, state.ori[last.id]));
      select(last.id);
    } else {
      doSwap(last.p, last.q);
    }
    announce('Undid the last action.');
    afterChange();
  }
  function giveHint() {
    if (state.won || state.playing) return;
    const h = hint(state.ori, state.selected);
    if (!h) return;
    state.hints++;
    select(h.id);
    const text = `Try Cube ${h.id + 1}: ${MOVES[h.move].label.toLowerCase()}. ` +
      `(You're ${h.total} move${h.total === 1 ? '' : 's'} from a solution.)`;
    $('#hint-text').textContent = text;
    announce(text);
    const btn = document.querySelector(`[data-move="${h.move}"]`);
    document.querySelectorAll('.pulse').forEach(b => b.classList.remove('pulse'));
    void btn.offsetWidth;
    btn.classList.add('pulse');
    btn.addEventListener('animationend', () => btn.classList.remove('pulse'), { once: true });
    refresh();
  }

  // Steps grouped by cube, top of the tower first, so the list reads like the tower.
  function orderedSolution() {
    return shortestSolution(state.ori).map((s, i) => Object.assign({ i }, s))
      .sort((a, b) => towerPos(b.id) - towerPos(a.id) || a.i - b.i);
  }
  function showSolution() {
    if (state.won || state.playing) return;
    state.assisted = true;
    state.solutionOpen = true;
    refresh();
    $('#solution').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function playSolution() {
    if (state.won || state.playing) return;
    const steps = orderedSolution();
    if (!steps.length) return;
    const token = ++playToken;
    Object.assign(state, { playing: true, assisted: true, solutionOpen: true, playSteps: steps, playIndex: 0 });
    const next = () => {
      if (token !== playToken) return;
      if (state.playIndex >= steps.length) { state.playing = false; refresh(); return; }
      const s = steps[state.playIndex++];
      select(s.id);
      rotate(s.move, s.id, true);
      const pause = () => setTimeout(next, 300);
      if (view) view.whenIdle(pause); else setTimeout(next, 700);
    };
    // On phones the list sits below the tower; bring the tower into view to watch it play.
    if (view) $('#scene').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(next, view ? 400 : 0);
  }

  function renderSolution() {
    const panel = $('#solution');
    panel.hidden = !state.solutionOpen;
    if (!state.solutionOpen) return;
    const steps = state.playing || state.won ? state.playSteps : orderedSolution();
    if (!state.playing && !state.won) state.playIndex = 0;
    $('#solution-title').textContent = state.won && !state.playSteps.length ? 'Solved!'
      : `Shortest solution: ${steps.length} move${steps.length === 1 ? '' : 's'}`;
    const list = $('#solution-steps');
    list.innerHTML = '';
    steps.forEach((s, i) => {
      const li = document.createElement('li');
      li.textContent = `Cube ${s.id + 1}: ${MOVES[s.move].label.toLowerCase()}`;
      if (state.playing || state.won) {
        if (i < state.playIndex - 1 || (i === state.playIndex - 1 && state.won)) li.className = 'done';
        else if (i === state.playIndex - 1) { li.className = 'current'; li.setAttribute('aria-current', 'step'); }
      }
      list.appendChild(li);
    });
    $('#btn-play').disabled = state.playing || state.won || !steps.length;
    $('#btn-play').textContent = state.playing ? 'Playing…' : 'Play it';
  }

  function afterChange() {
    $('#hint-text').textContent = '';
    if (!state.won && isWinOrients(state.ori)) {
      state.won = true;
      state.endTs = Date.now();
      if (state.startTs == null) state.startTs = state.endTs;
      const records = state.assisted ? null : saveBest();
      (view ? view.whenIdle.bind(view) : f => f())(() => setTimeout(() => showWin(records), 250));
    }
    refresh();
  }

  function saveBest() {
    const best = store.get(BEST_KEY) || {};
    const time = elapsedMs(), records = {};
    if (best.moves == null || state.moves < best.moves) { best.moves = state.moves; records.moves = true; }
    if (best.timeMs == null || time < best.timeMs) { best.timeMs = time; records.time = true; }
    store.set(BEST_KEY, best);
    return records;
  }

  /* ---------- rendering the panels ---------- */

  function select(id) {
    state.selected = id;
    if (view) view.setSelected(id);
    refresh();
  }

  function refresh() {
    $('#stat-moves').textContent = state.moves;
    $('#stat-swaps').textContent = state.swaps;
    $('#stat-undos').textContent = state.undos;
    $('#stat-hints').textContent = state.hints;
    updateTimer();
    const best = store.get(BEST_KEY) || {};
    $('#stat-best').textContent = best.moves == null ? '—'
      : `${best.moves} moves · ${fmtTime(best.timeMs)}`;

    // Cube chips, top of tower first.
    const chips = $('#cube-chips');
    chips.innerHTML = '';
    for (let p = 3; p >= 0; p--) {
      const id = state.order[p];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = `Cube ${id + 1}`;
      b.setAttribute('aria-pressed', String(state.selected === id));
      b.setAttribute('aria-label', `Select cube ${id + 1} (${posLabel(id)})`);
      b.addEventListener('click', () => select(id));
      chips.appendChild(b);
    }

    const sel = state.selected;
    $('#selected-label').textContent = sel == null ? 'Tap a cube to select it'
      : `Cube ${sel + 1} selected (${posLabel(sel)})`;
    const busy = state.won || state.playing;
    document.querySelectorAll('[data-move]').forEach(b => { b.disabled = busy || sel == null; });
    $('#btn-up').disabled = busy || sel == null || towerPos(sel) === 3;
    $('#btn-down').disabled = busy || sel == null || towerPos(sel) === 0;
    $('#btn-undo').disabled = busy || state.history.length === 0;
    $('#btn-hint').disabled = busy;
    $('#btn-solve').disabled = busy;
    $('#btn-reset').disabled = !state.start;
    document.body.classList.toggle('letters', state.letters);
    $('#solved-banner').hidden = !state.won;

    renderSides();
    renderSolution();
  }

  function renderSides() {
    const cols = [['Front', F], ['Right', R], ['Back', B], ['Left', L]];
    const rows = [];
    for (let p = 3; p >= 0; p--) {
      const id = state.order[p];
      rows.push({ id, faces: facesOf(id, state.ori[id]) });
    }
    const head = $('#sides-head'), body = $('#sides-body');
    head.innerHTML = '<th scope="col"><span class="sr-only">Cube</span></th>';
    const dupCols = cols.map(([name, s]) => {
      const counts = {};
      rows.forEach(r => { counts[r.faces[s]] = (counts[r.faces[s]] || 0) + 1; });
      const ok = Object.keys(counts).length === 4;
      const th = document.createElement('th');
      th.scope = 'col';
      th.className = ok ? 'ok' : 'bad';
      th.innerHTML = `${name}<span class="mark" aria-hidden="true">${ok ? '✓' : '✗'}</span>` +
        `<span class="sr-only">${ok ? ', all different' : ', has a repeat'}</span>`;
      head.appendChild(th);
      return counts;
    });
    body.innerHTML = '';
    rows.forEach(r => {
      const tr = document.createElement('tr');
      if (r.id === state.selected) tr.className = 'is-selected';
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = r.id + 1;
      th.setAttribute('aria-label', `Cube ${r.id + 1}`);
      tr.appendChild(th);
      cols.forEach(([name, s], ci) => {
        const c = r.faces[s], td = document.createElement('td');
        const dup = dupCols[ci][c] > 1;
        td.innerHTML = `<span class="sq c-${c}${dup ? ' dup' : ''}">${c}</span>`;
        td.setAttribute('aria-label', `${name}: ${COLOR_NAMES[c]}${dup ? ' (repeated)' : ''}`);
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  }

  function updateTimer() {
    $('#stat-time').textContent = fmtTime(elapsedMs());
  }

  /* ---------- dialogs ---------- */

  function openDialog(d) {
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
  }
  function closeDialog(d) {
    if (typeof d.close === 'function') d.close(); else d.removeAttribute('open');
  }

  function showWin(records) {
    $('#win-moves').textContent = state.moves;
    $('#win-time').textContent = fmtTime(elapsedMs());
    $('#win-extra').textContent =
      `${state.swaps} swap${state.swaps === 1 ? '' : 's'} · ${state.undos} undo${state.undos === 1 ? '' : 's'} · ` +
      `${state.hints} hint${state.hints === 1 ? '' : 's'}`;
    const notes = [];
    if (records && records.moves) notes.push('fewest moves');
    if (records && records.time) notes.push('fastest time');
    $('#win-record').textContent = !records ? 'Solved with the solver, so this round doesn\'t count toward your best.'
      : notes.length ? `New personal best: ${notes.join(' and ')}!` : '';
    const confetti = $('#confetti');
    confetti.innerHTML = '';
    const colors = Object.values(HEX);
    for (let i = 0; i < 60; i++) {
      const s = document.createElement('span');
      s.style.left = Math.random() * 100 + '%';
      s.style.background = colors[i % 4];
      s.style.animationDelay = Math.random() * 0.8 + 's';
      s.style.animationDuration = 1.8 + Math.random() * 1.4 + 's';
      confetti.appendChild(s);
    }
    openDialog($('#win-dialog'));
    announce(`Solved in ${state.moves} moves and ${fmtTime(elapsedMs())}!`);
  }

  function showShare() {
    const box = $('#qr'), url = window.location.href;
    box.innerHTML = '';
    $('#share-url').textContent = url;
    $('#share-local').hidden = !/^file:/.test(url);
    openDialog($('#share-dialog'));
    const size = Math.max(200, Math.min(520, Math.floor(Math.min(window.innerWidth, window.innerHeight) * 0.72)));
    if (typeof QRCode === 'undefined') {
      box.textContent = 'The QR code library could not load (are you offline?).';
      return;
    }
    new QRCode(box, { text: url, width: size, height: size, colorDark: '#000000', colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M });
    box.setAttribute('aria-label', 'QR code linking to ' + url);
  }

  function showSelfTest() {
    const results = runSelfTest();
    const list = $('#test-results');
    list.innerHTML = '';
    results.forEach(r => {
      const li = document.createElement('li');
      li.className = r.pass ? 'pass' : 'fail';
      li.textContent = `${r.pass ? 'PASS' : 'FAIL'} — ${r.name}${r.detail ? ' (' + r.detail + ')' : ''}`;
      list.appendChild(li);
    });
    const passed = results.filter(r => r.pass).length;
    $('#test-summary').textContent = `${passed} of ${results.length} checks passed.`;
    openDialog($('#test-dialog'));
  }

  /* ---------- three.js view ---------- */

  function createView(container) {
    if (typeof THREE === 'undefined') return null;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (e) { return null; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);
    const canvas = renderer.domElement;
    canvas.setAttribute('aria-label', '3D view of the tower. Drag to orbit, tap a cube to select it, swipe a selected cube to turn it.');
    canvas.setAttribute('role', 'img');

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    scene.add(new THREE.AmbientLight(0xffffff, 0.62));
    const key = new THREE.DirectionalLight(0xffffff, 0.6);
    key.position.set(3, 6, 5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.25);
    fill.position.set(-5, 2, -3);
    scene.add(fill);

    const GAP = 1.1;
    const yFor = p => (p - 1.5) * GAP;
    // BoxGeometry material order: +x, -x, +y, -y, +z, -z  ->  our face indices.
    const BOX_TO_FACE = [R, L, U, D, F, B];

    function roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
    const texCache = {};
    function faceTexture(c, letters) {
      const k = c + (letters ? '1' : '0');
      if (texCache[k]) return texCache[k];
      const cv = document.createElement('canvas');
      cv.width = cv.height = 128;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#16171c';
      ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = HEX[c];
      roundRect(ctx, 7, 7, 114, 114, 16);
      ctx.fill();
      if (letters) {
        ctx.fillStyle = c === 'W' ? '#1a1a1a' : '#ffffff';
        ctx.font = 'bold 70px system-ui, -apple-system, Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(c, 64, 68);
      }
      const t = new THREE.CanvasTexture(cv);
      t.encoding = THREE.sRGBEncoding;
      t.anisotropy = 4;
      return (texCache[k] = t);
    }
    function labelTexture(text) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = 'rgba(20,20,28,0.85)';
      ctx.beginPath();
      ctx.arc(32, 32, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 36px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 32, 34);
      const t = new THREE.CanvasTexture(cv);
      t.encoding = THREE.sRGBEncoding;
      return t;
    }

    const geo = new THREE.BoxGeometry(1, 1, 1);
    const meshes = CUBES.map((_, id) => {
      const mats = BOX_TO_FACE.map(() => new THREE.MeshLambertMaterial({ color: 0xffffff }));
      const mesh = new THREE.Mesh(geo, mats);
      mesh.userData.id = id;
      scene.add(mesh);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(String(id + 1)), depthTest: false }));
      sprite.scale.set(0.42, 0.42, 1);
      sprite.renderOrder = 2;
      scene.add(sprite);
      mesh.userData.label = sprite;
      return mesh;
    });
    function paint(id, faces) {
      meshes[id].material.forEach((m, i) => {
        m.map = faceTexture(faces[BOX_TO_FACE[i]], state.letters);
        m.needsUpdate = true;
      });
    }

    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.1, 1.1, 1.1)),
      new THREE.LineBasicMaterial({ color: 0xffc400 }));
    outline.visible = false;
    scene.add(outline);

    // Floor marker so "front" is never ambiguous.
    (function floor() {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 512;
      const ctx = cv.getContext('2d');
      ctx.strokeStyle = 'rgba(128,128,140,0.55)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(256, 256, 200, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(128,128,140,0.95)';
      ctx.font = 'bold 54px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('FRONT', 256, 440);
      ctx.save();
      ctx.translate(440, 256);
      ctx.rotate(-Math.PI / 2);
      ctx.font = 'bold 40px system-ui, sans-serif';
      ctx.fillText('RIGHT', 0, 0);
      ctx.restore();
      const t = new THREE.CanvasTexture(cv);
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6),
        new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
      plane.rotation.x = -Math.PI / 2;
      plane.position.y = yFor(0) - 0.56;
      scene.add(plane);
    })();

    const cam = { az: 0.6, el: 0.32, zoom: 1, fit: 10 };
    function placeCamera() {
      const r = cam.fit * cam.zoom;
      camera.position.set(
        r * Math.sin(cam.az) * Math.cos(cam.el),
        r * Math.sin(cam.el),
        r * Math.cos(cam.az) * Math.cos(cam.el));
      camera.lookAt(0, -0.15, 0);
    }
    function resize() {
      const w = container.clientWidth, h = container.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      const t = Math.tan((camera.fov * Math.PI) / 360);
      cam.fit = Math.max(2.9 / t, 1.9 / (t * camera.aspect));
    }
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(container);
    window.addEventListener('resize', resize);
    resize();

    // Animation queue: rotations and swaps play one after another.
    const queue = [];
    let current = null, idleCallbacks = [];
    const ease = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    const axisVec = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

    function step(now) {
      if (!current && queue.length) {
        current = queue.shift();
        current.t0 = now;
        if (current.type === 'swap') {
          current.from = meshes.map(m => m.position.y);
          current.to = meshes.map((_, id) => yFor(current.order.indexOf(id)));
        }
      }
      if (current) {
        // Cube turns always animate (even with Reduce Motion on): they show what a move did.
        const dur = current.dur || (current.type === 'swap' ? 320 : 230);
        const t = Math.min(1, (now - current.t0) / dur), e = ease(t);
        if (current.type === 'rot') {
          const m = MOVES[current.move];
          meshes[current.id].quaternion.setFromAxisAngle(axisVec[m.axis], (m.sign * Math.PI / 2) * e);
        } else {
          meshes.forEach((mesh, id) => {
            const moving = current.from[id] !== current.to[id];
            mesh.position.y = current.from[id] + (current.to[id] - current.from[id]) * e;
            mesh.position.x = moving ? Math.sin(Math.PI * e) * (current.to[id] > current.from[id] ? 1.2 : -1.2) : 0;
          });
        }
        if (t >= 1) {
          if (current.type === 'rot') {
            meshes[current.id].quaternion.identity();
            paint(current.id, current.faces);
          } else {
            meshes.forEach(mesh => { mesh.position.x = 0; });
          }
          current = null;
          if (!queue.length) { const cbs = idleCallbacks; idleCallbacks = []; cbs.forEach(f => f()); }
        }
      }
      const camRight = new THREE.Vector3(Math.cos(cam.az), 0, -Math.sin(cam.az));
      meshes.forEach(mesh => {
        mesh.userData.label.position.copy(mesh.position).addScaledVector(camRight, -0.92);
      });
      if (state.selected != null) outline.position.copy(meshes[state.selected].position);
      placeCamera();
      renderer.render(scene, camera);
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);

    /* pointer: tap selects, drag orbits, swipe on the selected cube turns it, pinch zooms */
    const raycaster = new THREE.Raycaster();
    const pointers = new Map();
    let gesture = null;
    function pick(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const v = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(v, camera);
      const hit = raycaster.intersectObjects(meshes)[0];
      return hit ? hit.object.userData.id : null;
    }
    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        gesture = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), zoom0: cam.zoom };
        return;
      }
      const hit = pick(e.clientX, e.clientY);
      gesture = { type: hit != null && hit === state.selected ? 'swipe' : 'orbit', hit,
        x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: 0, fired: false };
    });
    canvas.addEventListener('pointermove', e => {
      if (!pointers.has(e.pointerId) || !gesture) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (gesture.type === 'pinch') {
        if (pointers.size < 2) return;
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        cam.zoom = Math.min(1.7, Math.max(0.55, gesture.zoom0 * gesture.d0 / Math.max(d, 1)));
        return;
      }
      const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
      gesture.moved = Math.max(gesture.moved, Math.hypot(e.clientX - gesture.x0, e.clientY - gesture.y0));
      gesture.x = e.clientX;
      gesture.y = e.clientY;
      if (gesture.type === 'orbit') {
        cam.az -= dx * 0.008;
        cam.el = Math.min(1.35, Math.max(-1.1, cam.el + dy * 0.006));
      } else if (!gesture.fired && gesture.moved > 28) {
        gesture.fired = true;
        swipe(e.clientX - gesture.x0, e.clientY - gesture.y0);
      }
    });
    function endPointer(e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (gesture && gesture.type !== 'pinch' && gesture.moved < 8 && e.type === 'pointerup' && gesture.hit != null) {
        select(gesture.hit);
      }
      if (pointers.size === 0) gesture = null;
    }
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      cam.zoom = Math.min(1.7, Math.max(0.55, cam.zoom * (e.deltaY > 0 ? 1.08 : 0.93)));
    }, { passive: false });

    // Horizontal swipe spins the cube; vertical swipe tips it toward/away from the viewer,
    // about whichever world axis is closest to the camera's right-hand direction.
    function swipe(dx, dy) {
      if (Math.abs(dx) > Math.abs(dy)) { rotate(dx > 0 ? 'spinCCW' : 'spinCW'); return; }
      const rx = Math.cos(cam.az), rz = -Math.sin(cam.az);
      const down = dy > 0;
      let move;
      if (Math.abs(rx) >= Math.abs(rz)) move = (rx > 0) === down ? 'tiltF' : 'tiltB';
      else move = (rz > 0) === down ? 'rollL' : 'rollR';
      rotate(move);
    }

    return {
      snap() {
        queue.length = 0;
        current = null;
        meshes.forEach((mesh, id) => {
          mesh.quaternion.identity();
          mesh.position.set(0, yFor(state.order.indexOf(id)), 0);
          paint(id, facesOf(id, state.ori[id]));
        });
        const cbs = idleCallbacks; idleCallbacks = []; cbs.forEach(f => f());
      },
      queueRotation(id, move, faces, dur) { queue.push({ type: 'rot', id, move, faces, dur }); },
      queueSwap(order) { queue.push({ type: 'swap', order }); },
      setSelected(id) {
        outline.visible = id != null;
        meshes.forEach((mesh, i) => mesh.material.forEach(m => m.emissive.setHex(i === id ? 0x060500 : 0x000000)));
      },
      repaint() {
        // Letters toggled: repaint every cube with the faces it is currently showing.
        meshes.forEach((mesh, id) => {
          const pending = [current, ...queue].filter(q => q && q.type === 'rot' && q.id === id);
          if (!pending.length) paint(id, facesOf(id, state.ori[id]));
          else {
            // Show the state before the first pending rotation of this cube.
            let o = state.ori[id];
            for (let k = pending.length - 1; k >= 0; k--) o = NEXT[o][MOVES[pending[k].move].inverse];
            paint(id, facesOf(id, o));
          }
        });
      },
      whenIdle(cb) { if (!current && !queue.length) cb(); else idleCallbacks.push(cb); },
    };
  }

  /* ---------- wiring ---------- */

  function init() {
    view = createView($('#scene'));
    if (!view) $('#scene').classList.add('no3d');

    document.querySelectorAll('[data-move]').forEach(b => {
      b.addEventListener('click', () => rotate(b.dataset.move));
    });
    $('#btn-up').addEventListener('click', () => swap(1));
    $('#btn-down').addEventListener('click', () => swap(-1));
    $('#btn-new').addEventListener('click', newScramble);
    $('#btn-reset').addEventListener('click', resetAttempt);
    $('#btn-undo').addEventListener('click', undo);
    $('#btn-hint').addEventListener('click', giveHint);
    $('#btn-solve').addEventListener('click', showSolution);
    $('#btn-play').addEventListener('click', playSolution);
    $('#btn-solution-close').addEventListener('click', () => { state.solutionOpen = false; refresh(); });
    $('#btn-share').addEventListener('click', showShare);
    $('#btn-test').addEventListener('click', showSelfTest);
    $('#win-new').addEventListener('click', () => { closeDialog($('#win-dialog')); newScramble(); });
    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeDialog(b.closest('dialog'))));
    $('#copy-link').addEventListener('click', () => {
      const done = () => { $('#copy-link').textContent = 'Copied!'; };
      if (navigator.clipboard) navigator.clipboard.writeText(window.location.href).then(done, () => {});
    });

    const letters = $('#opt-letters');
    letters.checked = state.letters;
    letters.addEventListener('change', () => {
      state.letters = letters.checked;
      store.set(LETTERS_KEY, state.letters);
      if (view) view.repaint();
      refresh();
    });

    // Keyboard shortcuts (desktop): 1-4 select by cube number, W/S tilt, A/D roll, Q/E spin, Z undo.
    document.addEventListener('keydown', e => {
      if (e.target.closest('input, textarea, dialog') || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const keys = { w: 'tiltB', s: 'tiltF', a: 'rollL', d: 'rollR', q: 'spinCCW', e: 'spinCW' };
      if ('1234'.includes(k) && k.length === 1) select(Number(k) - 1);
      else if (keys[k]) rotate(keys[k]);
      else if (k === 'z') undo();
    });

    setInterval(updateTimer, 250);
    document.addEventListener('visibilitychange', updateTimer);

    const results = runSelfTest();
    const failed = results.filter(r => !r.pass);
    if (failed.length) console.warn('Instant Insanity self-test failures:', failed);
    else console.info(`Instant Insanity self-test: all ${results.length} checks passed.`);

    newScramble();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : globalThis);
