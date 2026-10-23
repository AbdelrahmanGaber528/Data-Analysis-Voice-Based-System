#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
#  DA Voice System — Unified Process Manager
#  
#  Commands:
#    ./manage.sh start (or up)   -> Starts BOTH Backend (:5000) & Frontend (:3000)
#    ./manage.sh stop  (or down) -> Stops BOTH Backend & Frontend completely
#    ./manage.sh restart         -> Restarts both services
#    ./manage.sh status          -> Checks health and port status for both
#    ./manage.sh logs            -> Streams live logs from both
# ══════════════════════════════════════════════════════════════════════════

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$PROJECT_ROOT/src"
FRONTEND_DIR="$PROJECT_ROOT/frontend"

BACKEND_PORT=5000
FRONTEND_PORT=3000

# ── Runtime directory in /tmp (keeps project directory 100% clean of .pid and .log files) ──
RUNTIME_DIR="/tmp/da_voice_$(id -u 2>/dev/null || echo 'runtime')"
mkdir -p "$RUNTIME_DIR" 2>/dev/null

BACKEND_LOG="$RUNTIME_DIR/backend.log"
FRONTEND_LOG="$RUNTIME_DIR/frontend.log"

BACKEND_PID_FILE="$RUNTIME_DIR/backend.pid"
FRONTEND_PID_FILE="$RUNTIME_DIR/frontend.pid"

# ── Auto-Detect Virtual Environment / Python ──
if [ -f "/home/abdelrahman/hdd/Git/cellula-tech/.env/bin/python3" ]; then
    PYTHON_BIN="/home/abdelrahman/hdd/Git/cellula-tech/.env/bin/python3"
    UVICORN_BIN="/home/abdelrahman/hdd/Git/cellula-tech/.env/bin/uvicorn"
elif [ -n "$VIRTUAL_ENV" ] && [ -f "$VIRTUAL_ENV/bin/python3" ]; then
    PYTHON_BIN="$VIRTUAL_ENV/bin/python3"
    UVICORN_BIN="$VIRTUAL_ENV/bin/uvicorn"
elif command -v uvicorn &>/dev/null; then
    PYTHON_BIN="$(command -v python3)"
    UVICORN_BIN="$(command -v uvicorn)"
else
    PYTHON_BIN="$(command -v python3)"
    UVICORN_BIN="$PYTHON_BIN -m uvicorn"
fi

# ── Helper Functions ──
check_port() {
    local port=$1
    if command -v ss &>/dev/null; then
        ss -tulpn 2>/dev/null | grep -q ":${port} "
    elif command -v lsof &>/dev/null; then
        lsof -i ":${port}" &>/dev/null
    else
        fuser "${port}/tcp" &>/dev/null
    fi
}

get_pid() {
    local port=$1
    fuser "${port}/tcp" 2>/dev/null | awk '{print $1}'
}

# ═══════════════════════════════════════════════════════════════
#  START BOTH (Backend & Frontend)
# ═══════════════════════════════════════════════════════════════
start_all() {
    echo "=========================================================="
    echo "  🚀 STARTING DA VOICE SYSTEM (Backend & Frontend Both)"
    echo "=========================================================="
    echo "● Python interpreter: $PYTHON_BIN"

    # 1. Start Backend (FastAPI on Port 5000)
    if check_port "$BACKEND_PORT"; then
        echo "● Backend is ALREADY running on port ${BACKEND_PORT} (PID: $(get_pid $BACKEND_PORT))"
    else
        echo "▶ Starting Backend API (FastAPI on port ${BACKEND_PORT})..."
        cd "$SRC_DIR" || exit 1
        nohup "$UVICORN_BIN" main:app --reload --host 0.0.0.0 --port "$BACKEND_PORT" </dev/null > "$BACKEND_LOG" 2>&1 &
        local b_pid=$!
        echo "$b_pid" > "$BACKEND_PID_FILE"
        disown "$b_pid" 2>/dev/null
    fi

    # 2. Start Frontend (HTTP server on Port 3000)
    if check_port "$FRONTEND_PORT"; then
        echo "● Frontend is ALREADY running on port ${FRONTEND_PORT} (PID: $(get_pid $FRONTEND_PORT))"
    else
        echo "▶ Starting Frontend Web UI (Port ${FRONTEND_PORT})..."
        cd "$FRONTEND_DIR" || exit 1
        nohup "$PYTHON_BIN" -m http.server "$FRONTEND_PORT" --bind 0.0.0.0 </dev/null > "$FRONTEND_LOG" 2>&1 &
        local f_pid=$!
        echo "$f_pid" > "$FRONTEND_PID_FILE"
        disown "$f_pid" 2>/dev/null
    fi

    echo ""
    echo "⏳ Waiting for services to initialize (Whisper model loading)..."
    local waited=0
    while (! check_port "$BACKEND_PORT" || ! check_port "$FRONTEND_PORT") && [ $waited -lt 15 ]; do
        sleep 1
        waited=$((waited + 1))
        echo -n "."
    done
    echo ""

    echo "----------------------------------------------------------"
    local all_good=true

    if check_port "$FRONTEND_PORT"; then
        echo "  🌐 Frontend Web UI : http://localhost:${FRONTEND_PORT}/  [READY]"
    else
        echo "  ❌ Frontend Web UI : Failed to bind port ${FRONTEND_PORT} (see $FRONTEND_LOG)"
        all_good=false
    fi

    if check_port "$BACKEND_PORT"; then
        echo "  ⚙️  Backend API     : http://localhost:${BACKEND_PORT}/      [READY]"
        echo "  🩺 API Health      : http://localhost:${BACKEND_PORT}/health"
        echo "  📚 Swagger Docs    : http://localhost:${BACKEND_PORT}/docs"
    else
        echo "  ❌ Backend API     : Failed to bind port ${BACKEND_PORT} (see $BACKEND_LOG)"
        all_good=false
    fi

    echo "----------------------------------------------------------"
    if [ "$all_good" = true ]; then
        echo "✅ BOTH FRONTEND AND BACKEND ARE UP AND RUNNING!"
    else
        echo "⚠️  One or more services did not start. Check logs below:"
        tail -n 15 "$BACKEND_LOG"
    fi
    echo "=========================================================="
}

# ═══════════════════════════════════════════════════════════════
#  STOP BOTH (Backend & Frontend)
# ═══════════════════════════════════════════════════════════════
stop_all() {
    echo "=========================================================="
    echo "  🛑 STOPPING DA VOICE SYSTEM (Stopping Frontend & Backend)"
    echo "=========================================================="

    # 1. Stop Frontend
    echo "■ Stopping Frontend on port ${FRONTEND_PORT}..."
    if [ -f "$FRONTEND_PID_FILE" ]; then
        local f_pid
        f_pid=$(cat "$FRONTEND_PID_FILE")
        kill "$f_pid" 2>/dev/null
        rm -f "$FRONTEND_PID_FILE"
    fi
    fuser -k "${FRONTEND_PORT}/tcp" &>/dev/null
    sleep 0.5
    if ! check_port "$FRONTEND_PORT"; then
        echo "   ✓ Frontend (port ${FRONTEND_PORT}): STOPPED"
    else
        fuser -k -9 "${FRONTEND_PORT}/tcp" 2>/dev/null
        echo "   ✓ Frontend (port ${FRONTEND_PORT}): FORCED STOPPED"
    fi

    # 2. Stop Backend
    echo "■ Stopping Backend on port ${BACKEND_PORT}..."
    if [ -f "$BACKEND_PID_FILE" ]; then
        local b_pid
        b_pid=$(cat "$BACKEND_PID_FILE")
        kill "$b_pid" 2>/dev/null
        rm -f "$BACKEND_PID_FILE"
    fi
    fuser -k "${BACKEND_PORT}/tcp" &>/dev/null
    pkill -f "uvicorn main:app" 2>/dev/null
    sleep 0.5
    if ! check_port "$BACKEND_PORT"; then
        echo "   ✓ Backend (port ${BACKEND_PORT}): STOPPED"
    else
        fuser -k -9 "${BACKEND_PORT}/tcp" 2>/dev/null
        echo "   ✓ Backend (port ${BACKEND_PORT}): FORCED STOPPED"
    fi

    echo "----------------------------------------------------------"
    echo "✅ BOTH FRONTEND AND BACKEND ARE COMPLETELY DOWN."
    echo "=========================================================="
}

# ═══════════════════════════════════════════════════════════════
#  STATUS CHECK
# ═══════════════════════════════════════════════════════════════
status_all() {
    echo "=========================================================="
    echo "  📊 DA Voice System Status"
    echo "=========================================================="

    if check_port "$FRONTEND_PORT"; then
        local f_pid
        f_pid=$(get_pid "$FRONTEND_PORT")
        echo "● Frontend : ONLINE  | Port ${FRONTEND_PORT} (PID: ${f_pid:-running})"
        echo "             URL: http://localhost:${FRONTEND_PORT}/"
    else
        echo "○ Frontend : OFFLINE | Port ${FRONTEND_PORT} is free"
    fi

    if check_port "$BACKEND_PORT"; then
        local b_pid
        b_pid=$(get_pid "$BACKEND_PORT")
        local health
        health=$(curl -s -m 2 "http://localhost:${BACKEND_PORT}/health" 2>/dev/null)
        echo "● Backend  : ONLINE  | Port ${BACKEND_PORT} (PID: ${b_pid:-running})"
        echo "             Health: ${health:-responsive}"
        echo "             API: http://localhost:${BACKEND_PORT}/"
    else
        echo "○ Backend  : OFFLINE | Port ${BACKEND_PORT} is free"
    fi
    echo "=========================================================="
}

# ═══════════════════════════════════════════════════════════════
#  STREAM LOGS
# ═══════════════════════════════════════════════════════════════
logs_all() {
    echo "Streaming logs from Backend and Frontend. Press Ctrl+C to stop."
    echo "----------------------------------------------------------"
    tail -f "$BACKEND_LOG" "$FRONTEND_LOG" 2>/dev/null || tail -f "$BACKEND_LOG"
}

# ── ROUTER ──
case "$1" in
    start|up)
        start_all
        ;;
    stop|down)
        stop_all
        ;;
    restart)
        stop_all
        sleep 1
        start_all
        ;;
    status)
        status_all
        ;;
    logs)
        logs_all
        ;;
    *)
        echo "Usage: $0 {start|up|stop|down|restart|status|logs}"
        echo ""
        echo "Commands:"
        echo "  start (or up)   : Starts BOTH Backend (:5000) and Frontend (:3000)"
        echo "  stop  (or down) : Stops BOTH Backend and Frontend completely"
        echo "  restart         : Restarts both services"
        echo "  status          : Checks whether Backend and Frontend are alive"
        echo "  logs            : Follows logs from both services in real-time"
        exit 1
        ;;
esac
