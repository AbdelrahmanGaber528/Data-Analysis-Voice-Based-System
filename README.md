# Voice-Based Data Analysis System (DA Voice)

A voice-driven multi-workflow AI platform built with **FastAPI**, **Faster-Whisper**, **SQLite3**, and an interactive visual dashboard.

---

## 🚀 Unified Management (Start & Down)

The [`manage.sh`](file:///home/abdelrahman/hdd/Git/cellula-tech/task05/Cellula_5Week_Abdelrahman_Gaber/voice-based-data-analysis-system/manage.sh) script controls **both Frontend and Backend together**:

| Command | Action |
|---|---|
| `./manage.sh start` (or `./manage.sh up`) | **Starts BOTH** Backend (`:5000`) & Frontend (`:3000`) |
| `./manage.sh down` (or `./manage.sh stop`) | **Stops BOTH** Backend & Frontend completely |
| `./manage.sh restart` | Cleanly stops both and brings both back up |
| `./manage.sh status` | Checks the live status & ports of both services |
| `./manage.sh logs` | Streams live logs from both Backend & Frontend |

---

## 🌐 URLs when Running

* **Frontend Dashboard**: [http://localhost:3000/](http://localhost:3000/) *(also at [http://localhost:5000/](http://localhost:5000/))*
* **Backend Health**: [http://localhost:5000/health](http://localhost:5000/health)
* **Swagger API Documentation**: [http://localhost:5000/docs](http://localhost:5000/docs)
