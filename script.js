(() => {
  'use strict';

  const CFG = window.CONFIG;
  const L = window.LANG;
  const N = CFG.BOARD_SIZE;
  const $ = (key) => {
    const id = CFG.DOM_IDS[key];
    return id ? document.getElementById(id) : null;
  };

  const Log = {
    _p(tag, args) {
      if (!CFG.DEBUG) return;
      console.log(`${new Date().toISOString().slice(11, 23)} ${tag}`, ...args);
    },
    net: (...a) => Log._p('[NET]', a),
    game: (...a) => Log._p('[GAME]', a),
    ui: (...a) => Log._p('[UI]', a)
  };

  const freshState = () => ({
    peer: null,
    conn: null,
    isHost: false,
    closing: false,
    name: CFG.DEFAULT_NAME,
    enemyName: 'противник',
    gender: 'm',
    phase: 'lobby',
    myTurn: false,
    waitingResult: false,
    orient: 'h',
    ready: false,
    enemyReady: false,
    rematchMe: false,
    rematchEnemy: false,
    ships: [],
    board: [],
    shotsAtMe: [],
    shotsAtEnemy: [],
    sunkMine: new Set(),
    sunkEnemy: new Set(),
    lastMine: null,
    lastEnemy: null,
    timers: {}
  });

  let STATE = freshState();

  const grid = () => Array.from({ length: N }, () => Array(N).fill(0));
  const inB = (r, c) => Number.isInteger(r) && Number.isInteger(c) && r >= 0 && r < N && c >= 0 && c < N;

  function shipCells(r, c, size, o) {
    return Array.from({ length: size }, (_, i) => (o === 'h' ? [r, c + i] : [r + i, c]));
  }

  function canPlace(board, r, c, size, o) {
    const cells = shipCells(r, c, size, o);
    if (!cells.every(([y, x]) => inB(y, x))) return false;
    return cells.every(([y, x]) => {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (inB(y + dy, x + dx) && board[y + dy][x + dx] === 1) return false;
        }
      }
      return true;
    });
  }

  function rebuildBoard() {
    STATE.board = grid();
    STATE.ships.forEach((s) => s.coords.forEach(([r, c]) => { STATE.board[r][c] = 1; }));
  }

  function nextSize() {
    for (const d of CFG.FLEET_DEF) {
      if (STATE.ships.filter((s) => s.size === d.size).length < d.count) return d.size;
    }
    return null;
  }

  function randomFleet() {
    for (let attempt = 0; attempt < 100; attempt++) {
      const board = grid();
      const ships = [];
      let ok = true;

      for (const d of CFG.FLEET_DEF) {
        for (let k = 0; k < d.count && ok; k++) {
          let placed = false;
          for (let t = 0; t < 200 && !placed; t++) {
            const o = Math.random() < 0.5 ? 'h' : 'v';
            const r = Math.floor(Math.random() * N);
            const c = Math.floor(Math.random() * N);

            if (canPlace(board, r, c, d.size, o)) {
              const coords = shipCells(r, c, d.size, o);
              coords.forEach(([y, x]) => { board[y][x] = 1; });
              ships.push({ size: d.size, coords });
              placed = true;
            }
          }
          ok = placed;
        }
      }

      if (ok) return ships;
    }
    return [];
  }

  function markAround(coords, shots) {
    const own = new Set(coords.map(([r, c]) => `${r},${c}`));
    coords.forEach(([r, c]) => {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const y = r + dr;
          const x = c + dc;
          if (inB(y, x) && !own.has(`${y},${x}`) && shots[y][x] === 0) shots[y][x] = 1;
        }
      }
    });
  }

  function renderBoard(el, ships, shots, sunk, last) {
    if (!el) return;

    el.textContent = '';

    const mk = (cls, txt) => {
      const d = document.createElement('div');
      d.className = cls;
      if (txt !== undefined) d.textContent = txt;
      el.appendChild(d);
      return d;
    };

    mk('label');
    for (let c = 0; c < N; c++) mk('label', String.fromCharCode(65 + c));

    for (let r = 0; r < N; r++) {
      mk('label', r + 1);
      for (let c = 0; c < N; c++) {
        const cell = mk('cell');
        cell.dataset.r = r;
        cell.dataset.c = c;

        if (ships && ships[r][c] === 1) cell.classList.add('ship');
        if (shots) {
          if (shots[r][c] === 1) cell.classList.add('miss');
          if (shots[r][c] === 2) cell.classList.add('hit');
          if (sunk && sunk.has(`${r},${c}`)) cell.classList.add('sunk');
        }
        if (last && last[0] === r && last[1] === c) cell.classList.add('flash');
      }
    }
  }

  const Net = {
    clearTimers() {
      Object.values(STATE.timers).forEach(clearTimeout);
      STATE.timers = {};
    },

    wake() {
      const url = `https://${CFG.PEER_CONFIG.host}/`;
      Log.net('[WAKE] GET', url);
      const ctl = new AbortController();
      const t0 = Date.now();
      const to = setTimeout(() => ctl.abort(), CFG.TIMEOUTS.WAKE_MS);

      return fetch(url, { mode: 'no-cors', signal: ctl.signal, cache: 'no-store' })
        .then(() => Log.net(`[WAKE] server answered in ${Date.now() - t0}ms`))
        .catch((e) => Log.net(`[WAKE] no answer after ${Date.now() - t0}ms (${e.name}) — server may be cold-starting`))
        .finally(() => clearTimeout(to));
    },

    makePeer(id, onOpen, onFail) {
      if (typeof Peer === 'undefined') {
        Log.net('PeerJS not loaded!');
        UI.toast(L.peerLibMissing, true);
        onFail();
        return null;
      }

      Log.net('[PEER] Creating peer...', id ? `id=${id}` : '(auto id)', `${CFG.PEER_CONFIG.host}:${CFG.PEER_CONFIG.port}${CFG.PEER_CONFIG.path}`);

      const peer = new Peer(id, CFG.PEER_CONFIG);
      STATE.peer = peer;

      STATE.timers.peerOpen = setTimeout(() => {
        Log.net(`[PEER] open timeout after ${CFG.TIMEOUTS.PEER_OPEN_MS}ms`);
        UI.toast(L.serverTimeout, true);
        onFail();
      }, CFG.TIMEOUTS.PEER_OPEN_MS);

      peer.on('open', (myId) => {
        clearTimeout(STATE.timers.peerOpen);
        Log.net(`[PEER] peer.on('open'), my id=${myId}`);
        onOpen(myId);
      });

      peer.on('error', (err) => {
        Log.net('Peer error:', err.type, err);
        clearTimeout(STATE.timers.peerOpen);

        const m = err.type === 'peer-unavailable'
          ? L.errPeerUnavailable
          : ['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)
            ? L.errServer
            : L.errGeneric + err.type;

        UI.toast(m, true);

        if (STATE.phase === 'lobby') onFail();
        else Net.lost();
      });

      peer.on('disconnected', () => Log.net('[PEER] disconnected from signaling server'));
      peer.on('close', () => Log.net('[PEER] peer closed'));

      return peer;
    },

    host() {
      STATE.isHost = true;
      const id = Array.from({ length: CFG.CODE_LENGTH }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
      UI.lobbyBusy(true, L.statusWake);

      Net.wake().then(() => {
        UI.lobbyBusy(true, L.statusPeer);
        Net.makePeer(id, (myId) => {
          UI.lobbyBusy(false);
          UI.showHostCard(myId);
        }, () => Net.reset(true));

        if (!STATE.peer) return;

        STATE.peer.on('connection', (c) => {
          Log.net(`[PEER] incoming connection from ${c.peer}`);
          if (STATE.conn && STATE.conn.open) {
            Log.net('[PEER] already have opponent, rejecting');
            c.on('open', () => {
              c.send({ type: 'busy' });
              setTimeout(() => c.close(), 300);
            });
            return;
          }
          Net.bind(c);
        });
      });
    },

    join(hostId) {
      Log.net(`[LOBBY] Join clicked, id=${hostId}`);
      STATE.isHost = false;
      UI.lobbyBusy(true, L.statusWake);

      Net.wake().then(() => {
        UI.lobbyBusy(true, L.statusPeer);

        Net.makePeer(undefined, () => {
          UI.lobbyBusy(true, `${L.statusConnect} ${hostId}...`);
          Log.net(`[NET] Connecting to ${hostId}...`);

          const c = STATE.peer.connect(hostId, { reliable: true });
          STATE.timers.connect = setTimeout(() => {
            Log.net(`[PEER] connection NOT opened within ${CFG.TIMEOUTS.CONNECT_MS}ms`);
            UI.toast(L.connTimeout, true);
            Net.reset(true);
          }, CFG.TIMEOUTS.CONNECT_MS);

          Net.bind(c);
        }, () => Net.reset(true));
      });
    },

    bind(c) {
      STATE.conn = c;
      Log.net('[PEER] bind conn, peer=', c.peer);

      const pc = c.peerConnection;
      if (pc) pc.addEventListener('iceconnectionstatechange', () => Log.net('[ICE] state:', pc.iceConnectionState));

      c.on('open', () => {
        clearTimeout(STATE.timers.connect);
        Log.net('[PEER] Connection open!');
        Net.send({ type: 'profile', name: STATE.name, gender: STATE.gender });
        UI.lobbyBusy(false);
        Game.initSetup();
        UI.show('screenSetup');
      });

      c.on('data', (d) => Net.handle(d));
      c.on('error', (err) => {
        Log.net('Conn error:', err);
        UI.toast(L.errGeneric + (err.type || err.message || 'conn'), true);
      });
      c.on('close', () => {
        Log.net('[PEER] Connection closed, intentional=', STATE.closing);
        if (!STATE.closing) Net.lost();
      });
    },

    send(msg) {
      if (STATE.conn && STATE.conn.open) {
        Log.net('→', msg);
        STATE.conn.send(msg);
      } else {
        Log.net('send skipped, connection not open:', msg);
      }
    },

    handle(msg) {
      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
        Log.net('Ignored invalid message:', msg);
        return;
      }

      Log.net('←', msg);

      switch (msg.type) {
        case 'profile':
          if (typeof msg.name !== 'string') break;
          STATE.enemyName = msg.name.slice(0, 15) || 'противник';
          UI.turn();
          return;
        case 'busy':
          UI.toast(L.errBusy, true);
          Net.reset(true);
          return;
        case 'ready':
          STATE.enemyReady = true;
          Game.checkStart();
          return;
        case 'shot':
          if (inB(msg.r, msg.c)) {
            Game.incomingShot(msg.r, msg.c);
            return;
          }
          break;
        case 'shotResult':
          if (inB(msg.r, msg.c) && typeof msg.hit === 'boolean') {
            Game.shotResult(msg);
            return;
          }
          break;
        case 'rematch':
          STATE.rematchEnemy = true;
          Game.checkRematch();
          return;
        default:
          break;
      }

      Log.net('Ignored invalid/unknown message:', msg);
    },

    lost() {
      if (STATE.closing || STATE.phase === 'lobby') return;
      Log.net('Connection lost → modal');
      UI.modal(L.lostTitle, L.lostText, L.btnLobby, () => Net.reset(false));
    },

    reset(silent) {
      Log.net('Reset to lobby');
      STATE.closing = true;
      Net.clearTimers();

      try { if (STATE.conn) STATE.conn.close(); } catch (e) { Log.net('close error', e); }
      try { if (STATE.peer) STATE.peer.destroy(); } catch (e) { Log.net('destroy error', e); }

      const keep = { name: STATE.name, gender: STATE.gender };
      STATE = Object.assign(freshState(), keep);

      UI.closeAll();
      UI.lobbyBusy(false);
      UI.show('screenLobby');

      const lobbyStart = $('lobbyStart');
      const lobbyHost = $('lobbyHost');
      if (lobbyStart) lobbyStart.hidden = false;
      if (lobbyHost) lobbyHost.hidden = true;

      if (silent === false) Log.net('User returned to lobby');
    }
  };

  const Game = {
    profile() {
      const nickname = $('nicknameInput');
      STATE.name = nickname && nickname.value.trim() ? nickname.value.trim() : CFG.DEFAULT_NAME;
      const checked = document.querySelector('input[name="gender"]:checked');
      STATE.gender = checked ? checked.value : 'm';
    },

    initSetup() {
      Object.assign(STATE, {
        ships: [],
        shotsAtMe: grid(),
        shotsAtEnemy: grid(),
        sunkMine: new Set(),
        sunkEnemy: new Set(),
        lastMine: null,
        lastEnemy: null,
        orient: 'h',
        ready: false,
        enemyReady: false,
        rematchMe: false,
        rematchEnemy: false,
        myTurn: false,
        waitingResult: false,
        phase: 'setup'
      });

      rebuildBoard();
      UI.setupLock(false);
      UI.setup();
    },

    setupClick(r, c) {
      if (STATE.ready) return;

      const i = STATE.ships.findIndex((s) => s.coords.some(([y, x]) => y === r && x === c));
      if (i !== -1) {
        STATE.ships.splice(i, 1);
        rebuildBoard();
        UI.setup();
        return;
      }

      const size = nextSize();
      if (!size || !canPlace(STATE.board, r, c, size, STATE.orient)) {
        Log.game('Cannot place', { r, c, size });
        return;
      }

      STATE.ships.push({ size, coords: shipCells(r, c, size, STATE.orient) });
      rebuildBoard();
      UI.setup();
    },

    random() {
      if (STATE.ready) return;
      STATE.ships = randomFleet();
      rebuildBoard();
      UI.setup();
      Log.game('Random fleet placed', STATE.ships.length);
    },

    undo() {
      if (STATE.ready || !STATE.ships.length) return;
      STATE.ships.pop();
      rebuildBoard();
      UI.setup();
    },

    rotate() {
      if (STATE.ready) return;
      STATE.orient = STATE.orient === 'h' ? 'v' : 'h';
      Log.game('Orientation', STATE.orient);
    },

    ready() {
      const total = CFG.FLEET_DEF.reduce((s, d) => s + d.count, 0);
      if (STATE.ready || STATE.ships.length !== total) {
        Log.game('Ready ignored');
        return;
      }

      STATE.ready = true;
      UI.setupLock(true);
      Net.send({ type: 'ready' });
      Log.game('I am ready');
      Game.checkStart();
    },

    checkStart() {
      if (STATE.phase !== 'setup') return;
      if (STATE.ready && STATE.enemyReady) {
        STATE.phase = 'battle';
        STATE.myTurn = STATE.isHost;
        STATE.waitingResult = false;
        Log.game('Battle start, myTurn=', STATE.myTurn);
        UI.show('screenBattle');
        UI.battle();
      }
    },

    shoot(r, c) {
      if (STATE.phase !== 'battle') return;
      if (!STATE.myTurn || STATE.waitingResult) {
        Log.game('Click ignored: not your turn');
        return;
      }
      if (STATE.shotsAtEnemy[r][c] !== 0) {
        Log.game('Click ignored: already shot', r, c);
        return;
      }

      STATE.waitingResult = true;
      Net.send({ type: 'shot', r, c });
      UI.turn();
      UI.lockEnemy();
    },

    incomingShot(r, c) {
      if (STATE.phase !== 'battle' || STATE.myTurn || STATE.shotsAtMe[r][c] !== 0) {
        Log.game('Invalid incoming shot ignored', { r, c });
        return;
      }

      const hit = STATE.board[r][c] === 1;
      STATE.shotsAtMe[r][c] = hit ? 2 : 1;
      STATE.lastMine = [r, c];

      let sunk = false;
      let cells = null;

      if (hit) {
        const ship = STATE.ships.find((s) => s.coords.some(([y, x]) => y === r && x === c));
        if (ship && ship.coords.every(([y, x]) => STATE.shotsAtMe[y][x] === 2)) {
          sunk = true;
          cells = ship.coords;
          markAround(cells, STATE.shotsAtMe);
          cells.forEach(([y, x]) => STATE.sunkMine.add(`${y},${x}`));
          Effects.sink(ship.size);
        }
      }

      const gameOver = STATE.ships.every((s) => s.coords.every(([y, x]) => STATE.shotsAtMe[y][x] === 2));
      Net.send({ type: 'shotResult', r, c, hit, sunk, cells, gameOver });
      Log.game('Incoming shot', { r, c, hit, sunk, gameOver });

      if (hit) Effects.hit();

      if (gameOver) {
        STATE.phase = 'gameover';
        UI.battle();
        UI.win(false);
        return;
      }

      STATE.myTurn = !hit;
      UI.battle();
    },

    shotResult(msg) {
      if (STATE.phase !== 'battle' || !STATE.waitingResult) {
        Log.game('Unexpected shotResult ignored');
        return;
      }

      const { r, c, hit, sunk, gameOver } = msg;
      STATE.waitingResult = false;
      STATE.shotsAtEnemy[r][c] = hit ? 2 : 1;
      STATE.lastEnemy = [r, c];

      if (hit && sunk && Array.isArray(msg.cells) && msg.cells.every((p) => Array.isArray(p) && inB(p[0], p[1]))) {
        markAround(msg.cells, STATE.shotsAtEnemy);
        msg.cells.forEach(([y, x]) => {
          STATE.shotsAtEnemy[y][x] = 2;
          STATE.sunkEnemy.add(`${y},${x}`);
        });
        Effects.sink(msg.cells.length);
      }

      if (hit) Effects.hit();

      Log.game('Shot result', { r, c, hit, sunk, gameOver });

      if (gameOver) {
        STATE.phase = 'gameover';
        UI.battle();
        UI.win(true);
        return;
      }

      STATE.myTurn = hit;
      UI.battle();
    },

    rematch() {
      if (STATE.rematchMe) return;
      STATE.rematchMe = true;
      Net.send({ type: 'rematch' });

      const btnRestart = $('btnRestart');
      const rematchWait = $('rematchWait');
      if (btnRestart) btnRestart.hidden = true;
      if (rematchWait) rematchWait.hidden = false;

      Game.checkRematch();
    },

    checkRematch() {
      if (STATE.rematchMe && STATE.rematchEnemy) {
        Log.game('Rematch!');
        UI.closeAll();
        Game.initSetup();
        UI.show('screenSetup');
      }
    }
  };

  const Effects = {
    audio(key, vol) {
      try {
        const a = new Audio(CFG.SOUNDS[key]);
        a.volume = Math.min(1, vol);
        a.play().catch((e) => Log.ui('Audio blocked:', e.message));
      } catch (e) {
        Log.ui('Audio error', e);
      }
    },

    sink(size) {
      Log.game('Sunk, size', size);
      Effects.audio('yay', size * 0.25);
      if (typeof confetti === 'function') {
        confetti({ particleCount: size * 40, spread: 50 + size * 15, origin: { y: 0.7 } });
      }
    },

    hit() {
      const body = document.body;
      if (!body) return;
      body.classList.remove('shake');
      void body.offsetWidth;
      body.classList.add('shake');
      setTimeout(() => body.classList.remove('shake'), CFG.TIMEOUTS.SHAKE_MS);
    }
  };

  const UI = {
    show(key) {
      ['screenLobby', 'screenSetup', 'screenBattle'].forEach((name) => {
        const el = $(name);
        if (el) el.classList.toggle('active', name === key);
      });
      Log.ui('Screen →', key);
    },

    toast(text, isErr) {
      Log.ui('Toast:', text);
      const container = $('toasts');
      if (!container) return;

      const t = document.createElement('div');
      t.className = 'toast' + (isErr ? ' error' : '');
      t.textContent = text;
      container.appendChild(t);

      setTimeout(() => t.remove(), CFG.TIMEOUTS.TOAST_MS);
    },

    modal(title, text, btn, cb) {
      const modal = $('modal');
      const modalTitle = $('modalTitle');
      const modalText = $('modalText');
      const modalBtn = $('modalBtn');

      if (!modal || !modalTitle || !modalText || !modalBtn) return;

      modalTitle.textContent = title;
      modalText.textContent = text;
      modalBtn.textContent = btn;
      modalBtn.onclick = () => {
        modal.classList.remove('show');
        cb();
      };
      modal.classList.add('show');
    },

    closeAll() {
      const modal = $('modal');
      const overlayWin = $('overlayWin');
      const btnRestart = $('btnRestart');
      const rematchWait = $('rematchWait');

      if (modal) modal.classList.remove('show');
      if (overlayWin) overlayWin.classList.remove('show');
      if (btnRestart) btnRestart.hidden = false;
      if (rematchWait) rematchWait.hidden = true;
    },

    lobbyBusy(on, text = '') {
      const status = $('lobbyStatus');
      const statusText = $('lobbyStatusText');
      const btnCreate = $('btnCreate');
      const btnJoin = $('btnJoin');
      const joinInput = $('joinInput');
      const nicknameInput = $('nicknameInput');

      if (status) status.hidden = !on;
      if (statusText && text) statusText.textContent = text;

      [btnCreate, btnJoin, joinInput, nicknameInput].forEach((el) => {
        if (el) el.disabled = on;
      });
    },

    showHostCard(id) {
      const hostId = $('hostId');
      const lobbyStart = $('lobbyStart');
      const lobbyHost = $('lobbyHost');

      if (hostId) hostId.textContent = id;
      if (lobbyStart) lobbyStart.hidden = true;
      if (lobbyHost) lobbyHost.hidden = false;
    },

    setup() {
      const setupBoard = $('setupBoard');
      if (setupBoard) renderBoard(setupBoard, STATE.board, null, null, null);

      const fleetList = $('fleetList');
      if (fleetList) {
        fleetList.textContent = '';
        CFG.FLEET_DEF.forEach((d) => {
          const placed = STATE.ships.filter((s) => s.size === d.size).length;
          for (let i = 0; i < d.count; i++) {
            const it = document.createElement('div');
            it.className = 'fleet-item' + (i < placed ? '' : ' current');

            for (let j = 0; j < d.size; j++) {
              const dot = document.createElement('div');
              dot.className = 'dot';
              it.appendChild(dot);
            }

            fleetList.appendChild(it);
          }
        });
      }

      const btnReady = $('btnReady');
      if (btnReady) {
        btnReady.disabled = STATE.ready || STATE.ships.length !== CFG.FLEET_DEF.reduce((s, d) => s + d.count, 0);
      }
    },

    setupLock(locked) {
      ['btnRotate', 'btnUndo', 'btnRandom'].forEach((key) => {
        const el = $(key);
        if (el) el.disabled = locked;
      });

      const btnReady = $('btnReady');
      if (btnReady && locked) btnReady.disabled = true;

      const setupBoard = $('setupBoard');
      if (setupBoard) setupBoard.classList.toggle('locked', locked);

      const setupWait = $('setupWait');
      if (setupWait) setupWait.hidden = !(locked && !STATE.enemyReady);

      const setupControls = $('setupControls');
      if (setupControls) setupControls.hidden = locked;
    },

    lockEnemy() {
      const enemyBoard = $('enemyBoard');
      if (enemyBoard) enemyBoard.classList.add('locked');
    },

    battle() {
      const myBoard = $('myBoard');
      if (myBoard) renderBoard(myBoard, STATE.board, STATE.shotsAtMe, STATE.sunkMine, STATE.lastMine);
      if (myBoard) myBoard.classList.add('locked');

      const enemyBoard = $('enemyBoard');
      if (enemyBoard) renderBoard(enemyBoard, null, STATE.shotsAtEnemy, STATE.sunkEnemy, STATE.lastEnemy);

      const can = STATE.phase === 'battle' && STATE.myTurn && !STATE.waitingResult;
      if (enemyBoard) {
        enemyBoard.classList.toggle('locked', !can);
        enemyBoard.classList.toggle('dim', STATE.phase === 'battle' && !can);
      }

      UI.turn();
    },

    turn() {
      const el = $('turnText');
      if (!el) return;

      if (STATE.phase !== 'battle') {
        el.textContent = L.turnEnd;
        return;
      }

      el.textContent = STATE.myTurn ? `${STATE.name}, ${L.turnMine}` : `ход ${STATE.enemyName}`;
      el.style.color = STATE.myTurn ? 'var(--text)' : 'var(--muted)';
    },

    win(iWon) {
      const winTitle = $('winTitle');
      const winDesc = $('winDesc');
      const overlayWin = $('overlayWin');
      const btnRestart = $('btnRestart');
      const rematchWait = $('rematchWait');

      if (winTitle) winTitle.textContent = iWon ? L.winTitle : L.loseTitle;
      if (winDesc) winDesc.textContent = iWon ? (STATE.gender === 'f' ? L.winDescF : L.winDescM) : (STATE.gender === 'f' ? L.loseDescF : L.loseDescM);
      if (btnRestart) btnRestart.hidden = false;
      if (rematchWait) rematchWait.hidden = true;
      if (overlayWin) overlayWin.classList.add('show');

      if (!iWon) Effects.audio('sad', 1);
    },

    applyTexts() {
      document.title = L.title;

      document.querySelectorAll('[data-lang]').forEach((el) => {
        el.textContent = L[el.dataset.lang];
      });

      document.querySelectorAll('[data-lang-ph]').forEach((el) => {
        el.placeholder = L[el.dataset.langPh];
      });

      document.querySelectorAll('[data-lang-title]').forEach((el) => {
        el.title = L[el.dataset.langTitle];
      });
    },

    theme(t) {
      document.documentElement.setAttribute('data-theme', t);
      const toggle = $('themeToggle');
      if (toggle) toggle.textContent = t === 'light' ? '🌙' : '☀️';

      try {
        localStorage.setItem('theme', t);
      } catch (e) {
        Log.ui('localStorage unavailable');
      }
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    Log.ui('Init. DEBUG=', CFG.DEBUG, '| Peer lib:', typeof Peer, '| confetti:', typeof confetti);

    if (typeof Peer === 'undefined') {
      Log.net('PeerJS not loaded!');
      UI.toast(L.peerLibMissing, true);
    }

    UI.applyTexts();

    let th = 'light';
    try {
      th = localStorage.getItem('theme') || 'light';
    } catch (e) {
      th = 'light';
    }
    UI.theme(th);

    const themeToggle = $('themeToggle');
    if (themeToggle) {
      themeToggle.onclick = () => {
        const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        UI.theme(next);
      };
    }

    const btnCreate = $('btnCreate');
    if (btnCreate) {
      btnCreate.onclick = () => {
        Log.ui('[LOBBY] Create clicked');
        Game.profile();
        Net.host();
      };
    }

    const btnJoin = $('btnJoin');
    const joinInput = $('joinInput');
    if (btnJoin) {
      btnJoin.onclick = () => {
        const id = (joinInput ? joinInput.value : '').trim().toUpperCase();
        Log.ui(`[LOBBY] Join clicked, id=${id}`);

        if (id.length !== CFG.CODE_LENGTH) {
          UI.toast(L.enterCode, true);
          return;
        }

        Game.profile();
        Net.join(id);
      };
    }

    if (joinInput) {
      joinInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const id = joinInput.value.trim().toUpperCase();
          if (id.length === CFG.CODE_LENGTH) {
            Game.profile();
            Net.join(id);
          } else {
            UI.toast(L.enterCode, true);
          }
        }
      });
    }

    const btnCancelHost = $('btnCancelHost');
    if (btnCancelHost) btnCancelHost.onclick = () => Net.reset(true);

    const setupBoard = $('setupBoard');
    if (setupBoard) {
      setupBoard.onclick = (e) => {
        const cell = e.target.closest('.cell');
        if (cell) Game.setupClick(+cell.dataset.r, +cell.dataset.c);
      };
    }

    const enemyBoard = $('enemyBoard');
    if (enemyBoard) {
      enemyBoard.onclick = (e) => {
        const cell = e.target.closest('.cell');
        if (cell) Game.shoot(+cell.dataset.r, +cell.dataset.c);
      };
    }

    const btnRotate = $('btnRotate');
    if (btnRotate) btnRotate.onclick = Game.rotate;

    const btnUndo = $('btnUndo');
    if (btnUndo) btnUndo.onclick = Game.undo;

    const btnRandom = $('btnRandom');
    if (btnRandom) btnRandom.onclick = Game.random;

    const btnReady = $('btnReady');
    if (btnReady) btnReady.onclick = Game.ready;

    const btnRestart = $('btnRestart');
    if (btnRestart) btnRestart.onclick = Game.rematch;

    document.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'r' && STATE.phase === 'setup' && !STATE.ready && document.activeElement.tagName !== 'INPUT') {
        Game.rotate();
      }
    });

    window.addEventListener('error', (e) => Log.ui('Uncaught:', e.message));
  });
})();
