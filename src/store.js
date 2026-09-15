const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const LEGACY_FILE = path.join(DATA_DIR, 'boards.json');

// In-memory boards cache & undo stacks
const boards = new Map();
const undoStacks = new Map();
const sseClients = new Map(); // boardId -> Set of res objects

// Preset templates
const PRESETS = {
  fenerbahce: {
    title: 'Fenerbahçe Küçük Erkek Voleybol Ligi',
    subtitle: 'Canlı Yayın',
    teamA: {
      name: 'FENERBAHÇE',
      shortName: 'FB',
      color: '#ffed00',
      color2: '#002d72',
      textColor: '#ffffff',
      accentColor: '#ffed00',
      logo: '/assets/fenerbahce.svg',
      setsWon: 0,
      points: 0,
      timeouts: 0,
      substitutions: 0,
      isServing: true
    },
    teamB: {
      name: 'RAKİP TAKIM',
      shortName: 'RAK',
      color: '#d61c35',
      color2: '#ffed00',
      textColor: '#ffffff',
      accentColor: '#d61c35',
      logo: '/assets/opponent.svg',
      setsWon: 0,
      points: 0,
      timeouts: 0,
      substitutions: 0,
      isServing: false
    },
    currentSet: 1,
    setHistory: [],
    rules: {
      maxSets: 5,
      setsToWin: 3,
      setPoints: 25,
      finalSetPoints: 15,
      winByTwo: true
    },
    courtSwapped: false,
    status: 'live',
    timeoutState: {
      active: false,
      team: null,
      duration: 30,
      startedAt: null,
      endsAt: null
    },
    setClock: {
      running: false,
      startedAt: null,
      elapsedMs: 0
    },
    bannerText: '',
    showBanner: false
  },
  generic: {
    title: 'Voleybol Müsabakası',
    subtitle: 'Canlı Yayın',
    teamA: {
      name: 'EV SAHİBİ',
      shortName: 'EV',
      color: '#1565c0',
      color2: '#ffed00',
      textColor: '#ffffff',
      accentColor: '#ffffff',
      logo: '',
      setsWon: 0,
      points: 0,
      timeouts: 0,
      substitutions: 0,
      isServing: true
    },
    teamB: {
      name: 'DEPLASMAN',
      shortName: 'DEP',
      color: '#c62828',
      color2: '#ffffff',
      textColor: '#ffffff',
      accentColor: '#ffffff',
      logo: '',
      setsWon: 0,
      points: 0,
      timeouts: 0,
      substitutions: 0,
      isServing: false
    },
    currentSet: 1,
    setHistory: [],
    rules: {
      maxSets: 5,
      setsToWin: 3,
      setPoints: 25,
      finalSetPoints: 15,
      winByTwo: true
    },
    courtSwapped: false,
    status: 'live',
    timeoutState: {
      active: false,
      team: null,
      duration: 30,
      startedAt: null,
      endsAt: null
    },
    setClock: {
      running: false,
      startedAt: null,
      elapsedMs: 0
    },
    bannerText: '',
    showBanner: false
  }
};

const CODE_CHARS = '23456789abcdefghjkmnpqrstuvwxyz';

function generate4CharCode() {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

function generateUniqueBoardId() {
  for (let i = 0; i < 1000; i++) {
    const code = generate4CharCode();
    if (!boards.has(code) && !db.getBoardFromDb(code)) {
      return code;
    }
  }
  return crypto.randomBytes(3).toString('hex').slice(0, 4);
}

function generateUniqueOperatorToken() {
  for (let i = 0; i < 1000; i++) {
    const code = generate4CharCode();
    if (!db.getBoardByOperatorToken(code)) {
      return code;
    }
  }
  return crypto.randomBytes(3).toString('hex').slice(0, 4);
}

function createDefaultBoard(id, presetKey = 'fenerbahce', userId = null) {
  const base = PRESETS[presetKey] || PRESETS.fenerbahce;
  const opToken = generateUniqueOperatorToken();
  return {
    id,
    userId,
    operatorToken: opToken,
    ...JSON.parse(JSON.stringify(base)),
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

// Load boards from SQLite & handle migration from boards.json
function initStore() {
  try {
    const dbBoards = db.getAllBoardsFromDb();
    if (dbBoards && dbBoards.length > 0) {
      for (const b of dbBoards) {
        if (!b.operatorToken) {
          b.operatorToken = generateUniqueOperatorToken();
          db.saveBoardToDb(b);
        }
        boards.set(b.id, b);
        undoStacks.set(b.id, []);
      }
    } else {
      // Check legacy boards.json
      let migrated = false;
      if (fs.existsSync(LEGACY_FILE)) {
        try {
          const raw = fs.readFileSync(LEGACY_FILE, 'utf8');
          const parsed = JSON.parse(raw);
          for (const [id, board] of Object.entries(parsed)) {
            if (!board.operatorToken) {
              board.operatorToken = crypto.randomBytes(12).toString('hex');
            }
            delete board.adminPin; // Remove PIN completely
            db.saveBoardToDb(board);
            boards.set(id, board);
            undoStacks.set(id, []);
            migrated = true;
          }
        } catch (e) {
          console.error('Error reading legacy boards.json:', e);
        }
      }

      // Ensure default / fenerbahce board exists
      if (!boards.has('fenerbahce')) {
        const fbBoard = createDefaultBoard('fenerbahce', 'fenerbahce', null);
        db.saveBoardToDb(fbBoard);
        boards.set('fenerbahce', fbBoard);
        undoStacks.set('fenerbahce', []);
      }
    }
  } catch (err) {
    console.error('Error initializing boards store:', err);
  }
}

// Run init
initStore();

function pushUndo(boardId) {
  const board = boards.get(boardId);
  if (!board) return;
  if (!undoStacks.has(boardId)) {
    undoStacks.set(boardId, []);
  }
  const stack = undoStacks.get(boardId);
  stack.push(JSON.parse(JSON.stringify(board)));
  if (stack.length > 40) {
    stack.shift();
  }
}

function getBoard(boardId) {
  if (!boardId) return null;
  if (boards.has(boardId)) {
    const board = boards.get(boardId);
    ensureSetClock(board);
    return board;
  }
  const clean = String(boardId).trim().toLowerCase();
  for (const b of boards.values()) {
    if ((b.id && b.id.toLowerCase() === clean) || (b.operatorToken && b.operatorToken.toLowerCase() === clean)) {
      ensureSetClock(b);
      return b;
    }
  }
  const fromDb = db.getBoardFromDb(clean) || db.getBoardByOperatorToken(clean);
  if (fromDb) {
    boards.set(fromDb.id, fromDb);
    undoStacks.set(fromDb.id, []);
    ensureSetClock(fromDb);
    return fromDb;
  }
  return null;
}

function getBoardByOperatorToken(token) {
  if (!token) return null;
  const clean = String(token).trim().toLowerCase();
  for (const b of boards.values()) {
    if ((b.operatorToken && b.operatorToken.toLowerCase() === clean) || (b.id && b.id.toLowerCase() === clean)) {
      ensureSetClock(b);
      return b;
    }
  }
  const fromDb = db.getBoardByOperatorToken(token) || db.getBoardFromDb(token);
  if (fromDb) {
    boards.set(fromDb.id, fromDb);
    undoStacks.set(fromDb.id, []);
    ensureSetClock(fromDb);
    return fromDb;
  }
  return null;
}

function saveBoard(board) {
  board.updatedAt = Date.now();
  boards.set(board.id, board);
  db.saveBoardToDb(board);
}

function createBoard(userId, options = {}) {
  // Always assign a fresh, unique 4-character code so repeated match titles never overwrite
  const id = (options.id && options.id.length === 4 && /^[a-z0-9]{4}$/.test(options.id) && !boards.has(options.id))
    ? options.id
    : generateUniqueBoardId();
  const presetKey = options.preset || 'fenerbahce';
  const newBoard = createDefaultBoard(id, presetKey, userId);

  if (options.title) newBoard.title = options.title;
  if (options.subtitle) newBoard.subtitle = options.subtitle;
  if (options.teamA) newBoard.teamA = { ...newBoard.teamA, ...options.teamA };
  if (options.teamB) newBoard.teamB = { ...newBoard.teamB, ...options.teamB };

  saveBoard(newBoard);
  undoStacks.set(id, []);
  return newBoard;
}

function deleteBoard(boardId, userId) {
  const board = getBoard(boardId);
  if (!board) return false;
  if (board.userId && board.userId !== userId) {
    throw new Error('Bu skorboardu silme yetkiniz yok.');
  }

  boards.delete(boardId);
  undoStacks.delete(boardId);
  db.deleteBoardFromDb(boardId, userId);
  return true;
}

function getAllBoardsSummary(userId = null) {
  if (userId) {
    return db.getBoardsByUser(userId);
  }
  const list = [];
  for (const [id, b] of boards.entries()) {
    list.push({
      id,
      name: b.title || id,
      operatorToken: b.operatorToken,
      title: b.title,
      subtitle: b.subtitle,
      teamA: { name: b.teamA.name, shortName: b.teamA.shortName, setsWon: b.teamA.setsWon, points: b.teamA.points },
      teamB: { name: b.teamB.name, shortName: b.teamB.shortName, setsWon: b.teamB.setsWon, points: b.teamB.points },
      currentSet: b.currentSet,
      status: b.status,
      updatedAt: b.updatedAt
    });
  }
  return list;
}

function getTargetPointsForSet(board, setNumber) {
  const isFinalSet = setNumber >= board.rules.maxSets;
  return isFinalSet ? board.rules.finalSetPoints : board.rules.setPoints;
}

function checkSetStatus(board) {
  const target = getTargetPointsForSet(board, board.currentSet);
  const pA = board.teamA.points;
  const pB = board.teamB.points;

  let setWinner = null;
  if (board.rules.winByTwo) {
    if (pA >= target && pA - pB >= 2) setWinner = 'teamA';
    else if (pB >= target && pB - pA >= 2) setWinner = 'teamB';
  } else {
    if (pA >= target) setWinner = 'teamA';
    else if (pB >= target) setWinner = 'teamB';
  }

  return {
    setWinner,
    isSetPointA: (pA >= target - 1 && pA > pB),
    isSetPointB: (pB >= target - 1 && pB > pA),
    isMatchPointA: (pA >= target - 1 && pA > pB && board.teamA.setsWon === board.rules.setsToWin - 1),
    isMatchPointB: (pB >= target - 1 && pB > pA && board.teamB.setsWon === board.rules.setsToWin - 1)
  };
}

const NO_UNDO_ACTIONS = ['undo', 'clock_start', 'clock_pause', 'clock_reset', 'clock_toggle'];

const OPERATOR_ALLOWED_ACTIONS = [
  'point_a',
  'point_b',
  'sub_point_a',
  'sub_point_b',
  'set_serve',
  'toggle_serve',
  'serve_a',
  'serve_b',
  'timeout_a',
  'timeout_b',
  'toggle_timeout_a',
  'toggle_timeout_b',
  'sub_timeout_a',
  'sub_timeout_b',
  'end_timeout',
  'clock_start',
  'clock_pause',
  'clock_reset',
  'clock_toggle',
  'swap_sides',
  'end_set',
  'new_set',
  'undo'
];

/**
 * Execute an action on a board.
 * authContext can be:
 * - { isOwner: true } -> full permissions
 * - { isOperator: true } -> only operator allowed actions
 */
function executeAction(boardId, action, payload = {}, authContext = { isOwner: true }) {
  const board = getBoard(boardId);
  if (!board) return { success: false, error: 'Skorboard bulunamadı.' };

  // Operator permission check
  if (authContext && authContext.isOperator && !authContext.isOwner) {
    if (!OPERATOR_ALLOWED_ACTIONS.includes(action)) {
      return { success: false, error: 'Bu işlem için yönetici yetkisi gereklidir.' };
    }
  }

  // Save to undo stack
  if (!NO_UNDO_ACTIONS.includes(action)) {
    pushUndo(boardId);
  }

  let modified = true;

  switch (action) {
    case 'point_a': {
      maybeAutoStartClock(board);
      board.teamA.points += (payload.amount || 1);
      board.teamA.isServing = true;
      board.teamB.isServing = false;
      break;
    }
    case 'point_b': {
      maybeAutoStartClock(board);
      board.teamB.points += (payload.amount || 1);
      board.teamB.isServing = true;
      board.teamA.isServing = false;
      break;
    }
    case 'sub_point_a': {
      board.teamA.points = Math.max(0, board.teamA.points - (payload.amount || 1));
      break;
    }
    case 'sub_point_b': {
      board.teamB.points = Math.max(0, board.teamB.points - (payload.amount || 1));
      break;
    }
    case 'set_points': {
      if (typeof payload.pointsA === 'number') board.teamA.points = Math.max(0, payload.pointsA);
      if (typeof payload.pointsB === 'number') board.teamB.points = Math.max(0, payload.pointsB);
      break;
    }
    case 'set_serve': {
      const team = payload.team;
      if (team === 'teamA') {
        board.teamA.isServing = true;
        board.teamB.isServing = false;
      } else if (team === 'teamB') {
        board.teamB.isServing = true;
        board.teamA.isServing = false;
      } else {
        board.teamA.isServing = !board.teamA.isServing;
        board.teamB.isServing = !board.teamA.isServing;
      }
      break;
    }
    case 'toggle_serve': {
      board.teamA.isServing = !board.teamA.isServing;
      board.teamB.isServing = !board.teamA.isServing;
      break;
    }
    case 'serve_a': {
      board.teamA.isServing = true;
      board.teamB.isServing = false;
      break;
    }
    case 'serve_b': {
      board.teamB.isServing = true;
      board.teamA.isServing = false;
      break;
    }
    case 'timeout_a': {
      if (board.teamA.timeouts < 2) {
        board.teamA.timeouts += 1;
        startTimeout(board, 'teamA', payload.duration || 30);
      }
      break;
    }
    case 'timeout_b': {
      if (board.teamB.timeouts < 2) {
        board.teamB.timeouts += 1;
        startTimeout(board, 'teamB', payload.duration || 30);
      }
      break;
    }
    case 'toggle_timeout_a': {
      if (board.timeoutState && board.timeoutState.active && board.timeoutState.team === 'teamA') {
        clearTimeoutState(board);
      } else if (board.teamA.timeouts < 2) {
        board.teamA.timeouts += 1;
        startTimeout(board, 'teamA', payload.duration || 30);
      }
      break;
    }
    case 'toggle_timeout_b': {
      if (board.timeoutState && board.timeoutState.active && board.timeoutState.team === 'teamB') {
        clearTimeoutState(board);
      } else if (board.teamB.timeouts < 2) {
        board.teamB.timeouts += 1;
        startTimeout(board, 'teamB', payload.duration || 30);
      }
      break;
    }
    case 'sub_timeout_a': {
      board.teamA.timeouts = Math.max(0, board.teamA.timeouts - 1);
      break;
    }
    case 'sub_timeout_b': {
      board.teamB.timeouts = Math.max(0, board.teamB.timeouts - 1);
      break;
    }
    case 'end_timeout': {
      clearTimeoutState(board);
      break;
    }
    case 'clock_start': {
      const clock = ensureSetClock(board);
      if (!clock.running) {
        clock.running = true;
        clock.startedAt = Date.now();
      }
      break;
    }
    case 'clock_pause': {
      const clock = ensureSetClock(board);
      if (clock.running) {
        clock.elapsedMs = getClockElapsed(clock);
        clock.running = false;
        clock.startedAt = null;
      }
      break;
    }
    case 'clock_toggle': {
      const clock = ensureSetClock(board);
      if (clock.running) {
        clock.elapsedMs = getClockElapsed(clock);
        clock.running = false;
        clock.startedAt = null;
      } else {
        clock.running = true;
        clock.startedAt = Date.now();
      }
      break;
    }
    case 'clock_reset': {
      resetSetClock(board);
      break;
    }
    case 'swap_sides': {
      board.courtSwapped = !board.courtSwapped;
      break;
    }
    case 'end_set': {
      let winner = payload.winner;
      if (!winner) {
        winner = board.teamA.points > board.teamB.points ? 'teamA' : 'teamB';
      }

      board.setHistory.push({
        set: board.currentSet,
        scoreA: board.teamA.points,
        scoreB: board.teamB.points,
        winner
      });

      if (winner === 'teamA') board.teamA.setsWon += 1;
      else if (winner === 'teamB') board.teamB.setsWon += 1;

      const setsToWin = board.rules.setsToWin || Math.ceil(board.rules.maxSets / 2);
      if (board.teamA.setsWon >= setsToWin || board.teamB.setsWon >= setsToWin) {
        board.status = 'finished';
      } else {
        board.status = 'set_break';
        board.currentSet += 1;
        board.teamA.points = 0;
        board.teamB.points = 0;
        board.teamA.timeouts = 0;
        board.teamB.timeouts = 0;
        board.teamA.substitutions = 0;
        board.teamB.substitutions = 0;
        board.courtSwapped = !board.courtSwapped;
        resetSetClock(board);
      }
      break;
    }
    case 'new_set': {
      board.status = 'live';
      break;
    }
    case 'reset_current_set': {
      board.teamA.points = 0;
      board.teamB.points = 0;
      board.teamA.timeouts = 0;
      board.teamB.timeouts = 0;
      board.teamA.substitutions = 0;
      board.teamB.substitutions = 0;
      board.status = 'live';
      resetSetClock(board);
      break;
    }
    case 'reset_match': {
      board.currentSet = 1;
      board.setHistory = [];
      board.teamA.setsWon = 0;
      board.teamA.points = 0;
      board.teamA.timeouts = 0;
      board.teamA.substitutions = 0;
      board.teamB.setsWon = 0;
      board.teamB.points = 0;
      board.teamB.timeouts = 0;
      board.teamB.substitutions = 0;
      board.status = 'live';
      board.courtSwapped = false;
      resetSetClock(board);
      board.timeoutState = {
        active: false,
        team: null,
        duration: 30,
        startedAt: null,
        endsAt: null
      };
      break;
    }
    case 'update_teams': {
      if (payload.teamA) board.teamA = { ...board.teamA, ...payload.teamA };
      if (payload.teamB) board.teamB = { ...board.teamB, ...payload.teamB };
      break;
    }
    case 'update_rules': {
      if (payload.rules) {
        board.rules = { ...board.rules, ...payload.rules };
        board.rules.setsToWin = Math.ceil(board.rules.maxSets / 2);
      }
      break;
    }
    case 'update_meta': {
      if (payload.title !== undefined) board.title = payload.title;
      if (payload.subtitle !== undefined) board.subtitle = payload.subtitle;
      if (payload.bannerText !== undefined) board.bannerText = payload.bannerText;
      if (payload.showBanner !== undefined) board.showBanner = Boolean(payload.showBanner);
      break;
    }
    case 'undo': {
      const stack = undoStacks.get(boardId);
      if (stack && stack.length > 0) {
        const previousState = stack.pop();
        previousState.setClock = board.setClock;
        boards.set(boardId, previousState);
        modified = true;
      } else {
        return { success: false, error: 'Geri alınacak hareket yok' };
      }
      break;
    }
    default: {
      return { success: false, error: `Bilinmeyen eylem: ${action}` };
    }
  }

  if (modified) {
    saveBoard(boards.get(boardId));
    broadcastBoard(boardId);
  }

  return { success: true, board: boards.get(boardId) };
}

function ensureSetClock(board) {
  if (!board.setClock) {
    board.setClock = { running: false, startedAt: null, elapsedMs: 0 };
  }
  return board.setClock;
}

function getClockElapsed(clock) {
  const base = clock.elapsedMs || 0;
  if (!clock.running || !clock.startedAt) return base;
  return base + Math.max(0, Date.now() - clock.startedAt);
}

function maybeAutoStartClock(board) {
  const clock = ensureSetClock(board);
  if (clock.running || clock.startedAt || (clock.elapsedMs || 0) > 0) return;
  clock.running = true;
  clock.startedAt = Date.now();
}

function resetSetClock(board) {
  board.setClock = { running: false, startedAt: null, elapsedMs: 0 };
}

function startTimeout(board, team, durationSeconds = 30) {
  const now = Date.now();
  board.timeoutState = {
    active: true,
    team,
    duration: durationSeconds,
    startedAt: now,
    endsAt: now + (durationSeconds * 1000)
  };
  board.status = 'timeout';

  setTimeout(() => {
    const current = boards.get(board.id);
    if (current && current.timeoutState && current.timeoutState.active && current.timeoutState.endsAt <= Date.now()) {
      clearTimeoutState(current);
      saveBoard(current);
      broadcastBoard(board.id);
    }
  }, (durationSeconds + 1) * 1000);
}

function clearTimeoutState(board) {
  board.timeoutState = {
    active: false,
    team: null,
    duration: 30,
    startedAt: null,
    endsAt: null
  };
  if (board.status === 'timeout') {
    board.status = 'live';
  }
}

function addSseClient(boardId, res) {
  if (!sseClients.has(boardId)) {
    sseClients.set(boardId, new Set());
  }
  const clientSet = sseClients.get(boardId);
  clientSet.add(res);

  const currentBoard = getBoard(boardId);
  if (currentBoard) {
    res.write(`event: state\ndata: ${JSON.stringify(currentBoard)}\n\n`);
  }

  res.on('close', () => {
    clientSet.delete(res);
  });
}

function broadcastBoard(boardId) {
  const clientSet = sseClients.get(boardId);
  if (!clientSet || clientSet.size === 0) return;

  const currentBoard = getBoard(boardId);
  if (!currentBoard) return;

  const data = `event: state\ndata: ${JSON.stringify(currentBoard)}\n\n`;
  for (const client of clientSet) {
    try {
      client.write(data);
    } catch (e) {
      clientSet.delete(client);
    }
  }
}

module.exports = {
  PRESETS,
  getBoard,
  getBoardByOperatorToken,
  saveBoard,
  createBoard,
  deleteBoard,
  getAllBoardsSummary,
  executeAction,
  addSseClient,
  broadcastBoard,
  checkSetStatus,
  OPERATOR_ALLOWED_ACTIONS
};
