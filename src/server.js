const http = require('http');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const logos = require('./logos');
const teams = require('./teams');
const auth = require('./auth');

const PORT = parseInt(process.env.PORT || '3000', 10);
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.lua': 'text/plain; charset=utf-8',
  '.py': 'text/plain; charset=utf-8'
};

function sendJson(res, statusCode, data, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Operator-Token',
    ...extraHeaders
  });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 15 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function serveStaticFile(res, filePath) {
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      const indexPath = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(indexPath, (err2, data) => {
        if (err2) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end('404 Not Found');
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Access-Control-Allow-Origin': '*'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrl.pathname;
  const method = req.method;

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Operator-Token',
      'Access-Control-Max-Age': '86400'
    });
    return res.end();
  }

  // --- API Endpoints ---

  // Health check for Coolify & Docker
  if (pathname === '/health' && method === 'GET') {
    return sendJson(res, 200, {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: Date.now()
    });
  }

  // --- Auth Endpoints ---

  // Register
  if (pathname === '/api/auth/register' && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const result = await auth.register(body.email, body.password);
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message });
    }
  }

  // Verify email with code
  if (pathname === '/api/auth/verify' && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const result = await auth.verify(body.email, body.code);
      const cookie = auth.createSessionCookie(result.sessionToken);
      return sendJson(res, 200, result, { 'Set-Cookie': cookie });
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message });
    }
  }

  // Resend verification code
  if (pathname === '/api/auth/resend-code' && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const result = await auth.resendCode(body.email);
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message });
    }
  }

  // Login
  if (pathname === '/api/auth/login' && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const result = await auth.login(body.email, body.password);
      const cookie = auth.createSessionCookie(result.sessionToken);
      return sendJson(res, 200, result, { 'Set-Cookie': cookie });
    } catch (err) {
      return sendJson(res, 400, {
        success: false,
        error: err.message,
        unverified: Boolean(err.unverified),
        email: err.email
      });
    }
  }

  // Logout
  if (pathname === '/api/auth/logout' && method === 'POST') {
    const cookies = auth.parseCookies(req.headers['cookie']);
    if (cookies.sid) auth.logout(cookies.sid);
    const clearCookie = auth.createClearCookie();
    return sendJson(res, 200, { success: true }, { 'Set-Cookie': clearCookie });
  }

  // Current session user
  if (pathname === '/api/auth/me' && method === 'GET') {
    const user = auth.getUserFromRequest(req);
    if (!user) {
      return sendJson(res, 200, { authenticated: false, user: null });
    }
    return sendJson(res, 200, {
      authenticated: true,
      user: { id: user.id, email: user.email, isVerified: user.is_verified }
    });
  }

  // --- Logo & Team Static Assets ---
  if (pathname.startsWith('/uploads/logos/')) {
    const filename = path.basename(pathname);
    const filePath = path.join(teams.LOGOS_DIR, filename);
    return serveStaticFile(res, filePath);
  }

  // Get teams (user teams + default teams)
  if ((pathname === '/api/teams' || pathname === '/api/logos') && method === 'GET') {
    const user = auth.getUserFromRequest(req);
    const list = teams.getAllTeams(user ? user.id : null);
    return sendJson(res, 200, { success: true, teams: list, logos: list });
  }

  // Create new team (User only)
  if ((pathname === '/api/teams' || pathname === '/api/logos') && method === 'POST') {
    const user = auth.getUserFromRequest(req);
    if (!user) {
      return sendJson(res, 401, { success: false, error: 'Takım eklemek için giriş yapmalısınız.' });
    }
    try {
      const body = await parseJsonBody(req);
      body.userId = user.id;
      const newTeam = teams.saveTeam(body);
      return sendJson(res, 201, { success: true, team: newTeam, logo: newTeam });
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message });
    }
  }

  // Update existing team
  const teamPutMatch = pathname.match(/^\/api\/(?:teams|logos)\/([a-zA-Z0-9_-]+)$/);
  if (teamPutMatch && method === 'PUT') {
    const user = auth.getUserFromRequest(req);
    if (!user) {
      return sendJson(res, 401, { success: false, error: 'Giriş yapmalısınız.' });
    }
    try {
      const id = teamPutMatch[1];
      const body = await parseJsonBody(req);
      const updated = teams.updateTeam(id, body, user.id);
      return sendJson(res, 200, { success: true, team: updated, logo: updated });
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message });
    }
  }

  // Delete team
  const teamDeleteMatch = pathname.match(/^\/api\/(?:teams|logos)\/([a-zA-Z0-9_-]+)$/);
  if (teamDeleteMatch && method === 'DELETE') {
    const user = auth.getUserFromRequest(req);
    if (!user) {
      return sendJson(res, 401, { success: false, error: 'Giriş yapmalısınız.' });
    }
    try {
      const id = teamDeleteMatch[1];
      const deleted = teams.deleteTeam(id, user.id);
      if (deleted) {
        return sendJson(res, 200, { success: true });
      }
      return sendJson(res, 404, { success: false, error: 'Takım bulunamadı.' });
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message });
    }
  }

  // --- Board Endpoints ---

  // List all boards for the logged in user
  if (pathname === '/api/boards' && method === 'GET') {
    const user = auth.getUserFromRequest(req);
    if (!user) {
      return sendJson(res, 401, { success: false, error: 'Skorboardları görmek için giriş yapmalısınız.' });
    }
    const userBoards = store.getAllBoardsSummary(user.id);
    return sendJson(res, 200, userBoards);
  }

  // Create new board
  if (pathname === '/api/boards' && method === 'POST') {
    const user = auth.getUserFromRequest(req);
    if (!user) {
      return sendJson(res, 401, { success: false, error: 'Skorboard oluşturmak için giriş yapmalısınız.' });
    }
    const body = await parseJsonBody(req);
    const newBoard = store.createBoard(user.id, body);
    return sendJson(res, 201, { success: true, boardId: newBoard.id, board: newBoard });
  }

  // Delete board
  const boardDeleteMatch = pathname.match(/^\/api\/boards\/([a-zA-Z0-9_-]+)$/);
  if (boardDeleteMatch && method === 'DELETE') {
    const user = auth.getUserFromRequest(req);
    if (!user) {
      return sendJson(res, 401, { success: false, error: 'Giriş yapmalısınız.' });
    }
    const boardId = boardDeleteMatch[1];
    try {
      const deleted = store.deleteBoard(boardId, user.id);
      if (deleted) return sendJson(res, 200, { success: true });
      return sendJson(res, 404, { success: false, error: 'Skorboard bulunamadı.' });
    } catch (err) {
      return sendJson(res, 403, { success: false, error: err.message });
    }
  }

  // Get specific board by ID (Used by OBS Overlays, Spectator Screen, Admin Control)
  const boardMatch = pathname.match(/^\/api\/board\/([a-zA-Z0-9_-]+)$/);
  if (boardMatch && method === 'GET') {
    const boardId = boardMatch[1];
    const board = store.getBoard(boardId);
    if (!board) {
      return sendJson(res, 404, { success: false, error: 'Skorboard bulunamadı.' });
    }
    return sendJson(res, 200, board);
  }

  // Get specific board by Operator Token (Used by operator screen)
  const opBoardMatch = pathname.match(/^\/api\/board\/by-operator\/([a-zA-Z0-9_-]+)$/);
  if (opBoardMatch && method === 'GET') {
    const opToken = opBoardMatch[1];
    const board = store.getBoardByOperatorToken(opToken) || store.getBoard(opToken);
    if (!board) {
      return sendJson(res, 404, { success: false, error: 'Geçersiz veya süresi dolmuş operatör bağlantısı.' });
    }
    return sendJson(res, 200, { success: true, boardId: board.id, board });
  }

  // Quick status summary for OBS scripts or external integrations
  const quickStatusMatch = pathname.match(/^\/api\/board\/([a-zA-Z0-9_-]+)\/quick-status$/);
  if (quickStatusMatch && method === 'GET') {
    const rawTarget = quickStatusMatch[1];
    const board = store.getBoard(rawTarget) || store.getBoardByOperatorToken(rawTarget);
    if (!board) {
      return sendJson(res, 404, { success: false, error: 'Skorboard bulunamadı.' });
    }
    return sendJson(res, 200, {
      success: true,
      id: board.id,
      title: board.title,
      currentSet: board.currentSet,
      teamA: {
        name: board.teamA.name,
        shortName: board.teamA.shortName,
        points: board.teamA.points,
        setsWon: board.teamA.setsWon,
        isServing: board.teamA.isServing,
        timeouts: board.teamA.timeouts
      },
      teamB: {
        name: board.teamB.name,
        shortName: board.teamB.shortName,
        points: board.teamB.points,
        setsWon: board.teamB.setsWon,
        isServing: board.teamB.isServing,
        timeouts: board.teamB.timeouts
      },
      timeoutActive: Boolean(board.timeoutState && board.timeoutState.active),
      timeoutTeam: board.timeoutState ? board.timeoutState.team : null,
      courtSwapped: Boolean(board.courtSwapped),
      status: board.status
    });
  }

  // Action on board (Unified handler: supports POST with JSON body and GET/POST /api/board/:target/action/:action with query params)
  const actionMatch = pathname.match(/^\/api\/board\/([a-zA-Z0-9_-]+)\/action(?:\/([a-zA-Z0-9_-]+))?$/);
  if (actionMatch && (method === 'POST' || method === 'GET')) {
    const rawTarget = actionMatch[1];
    let action = actionMatch[2];
    let payload = {};

    if (method === 'POST') {
      const body = await parseJsonBody(req);
      if (body.action) action = body.action;
      if (body.payload && typeof body.payload === 'object') {
        payload = { ...payload, ...body.payload };
      } else if (typeof body === 'object') {
        const { action: _, ...rest } = body;
        payload = { ...payload, ...rest };
      }
    }

    // Also support query parameters (e.g. /action/point_a?amount=1)
    for (const [key, val] of reqUrl.searchParams.entries()) {
      if (key === 'action' && !action) action = val;
      else if (key === 'amount' || key === 'duration') payload[key] = parseInt(val, 10) || 1;
      else if (key !== 'key') payload[key] = val;
    }

    if (!action) {
      return sendJson(res, 400, { success: false, error: 'Eylem (action) belirtilmedi.' });
    }

    const board = store.getBoard(rawTarget) || store.getBoardByOperatorToken(rawTarget);
    if (!board) {
      return sendJson(res, 404, { success: false, error: 'Skorboard bulunamadı.' });
    }

    const boardId = board.id;
    const user = auth.getUserFromRequest(req);

    // Is the requester the logged-in owner of this board?
    const isOwner = Boolean(user && (!board.userId || board.userId === user.id));

    // Non-owners act as operators (only allowed scoring, timeouts, serves, undo, clock, set transitions)
    const result = store.executeAction(boardId, action, payload, { isOwner, isOperator: !isOwner });
    return sendJson(res, result.success ? 200 : 400, result);
  }

  // SSE Stream (Real-time live scores for OBS, live spectator, and controllers)
  const streamMatch = pathname.match(/^\/api\/board\/([a-zA-Z0-9_-]+)\/stream$/);
  if (streamMatch && method === 'GET') {
    const rawTarget = streamMatch[1];
    const board = store.getBoard(rawTarget) || store.getBoardByOperatorToken(rawTarget);
    const boardId = board ? board.id : rawTarget;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no'
    });

    store.addSseClient(boardId, res);
    return;
  }

  // --- Page Routes & Static Files ---

  // Login Page
  if (pathname === '/login' || pathname === '/login.html') {
    return serveStaticFile(res, path.join(PUBLIC_DIR, 'login.html'));
  }

  // Register Page
  if (pathname === '/register' || pathname === '/register.html') {
    return serveStaticFile(res, path.join(PUBLIC_DIR, 'register.html'));
  }

  // Verify Email Page
  if (pathname === '/verify' || pathname === '/verify.html') {
    return serveStaticFile(res, path.join(PUBLIC_DIR, 'verify.html'));
  }

  // Operator Controller Page (Simplified, password-free referee/scorer link)
  if (pathname.startsWith('/operate')) {
    return serveStaticFile(res, path.join(PUBLIC_DIR, 'operate.html'));
  }

  // Admin Control Panel (Owner Only)
  if (pathname.startsWith('/control')) {
    const user = auth.getUserFromRequest(req);
    if (!user) {
      res.writeHead(302, { 'Location': '/login' });
      return res.end();
    }
    const match = pathname.match(/^\/control\/([a-zA-Z0-9_-]+)$/);
    if (match) {
      const boardId = match[1];
      const board = store.getBoard(boardId);
      if (board && board.userId && board.userId !== user.id) {
        res.writeHead(302, { 'Location': '/' });
        return res.end();
      }
    }
    return serveStaticFile(res, path.join(PUBLIC_DIR, 'control.html'));
  }

  // OBS Overlay
  if (pathname.startsWith('/overlay')) {
    return serveStaticFile(res, path.join(PUBLIC_DIR, 'overlay.html'));
  }

  // Live Spectator / Gym Scoreboard
  if (pathname.startsWith('/live') || pathname.startsWith('/board')) {
    return serveStaticFile(res, path.join(PUBLIC_DIR, 'live.html'));
  }

  // Team & Logo Management Page
  if (pathname === '/teams' || pathname === '/teams.html' || pathname === '/logos' || pathname === '/logos.html') {
    return serveStaticFile(res, path.join(PUBLIC_DIR, 'teams.html'));
  }

  // Root / Index (Dashboard)
  if (pathname === '/' || pathname === '/index.html') {
    return serveStaticFile(res, path.join(PUBLIC_DIR, 'index.html'));
  }

  // OBS Plugin & Scripts Download
  if (pathname.startsWith('/obs/')) {
    const filename = path.basename(pathname);
    const obsFilePath = path.join(__dirname, '..', 'obs', filename);
    return serveStaticFile(res, obsFilePath);
  }

  // Static Assets (CSS, JS, Images)
  const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  const localFilePath = path.join(PUBLIC_DIR, safePath);
  serveStaticFile(res, localFilePath);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=================================================`);
  console.log(`🏐 Voleybol Skorboard Sistemi Başlatıldı (Multi-User & SQLite)`);
  console.log(`📡 Port: http://0.0.0.0:${PORT}`);
  console.log(`🏠 Ana Panel (Dashboard): http://localhost:${PORT}/`);
  console.log(`🔑 Giriş / Kayıt:        http://localhost:${PORT}/login`);
  console.log(`🎛️ Yönetici Kumandası:    http://localhost:${PORT}/control/fenerbahce`);
  console.log(`📺 OBS Overlay:          http://localhost:${PORT}/overlay/fenerbahce`);
  console.log(`🏟️ Salon Ekranı:         http://localhost:${PORT}/live/fenerbahce`);
  console.log(`=================================================`);
});
