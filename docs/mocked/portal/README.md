# Portal mockups — records

Static HTML design mockups, saved here per owner directive 2026-09-03
("mocked up design first before actual data wiring" / "save your mocked
pages into docs/mocked/portal folder for records"). No live wiring, no
build step — open directly in a browser. Reviewed live on claude.ai as
Artifacts first; these are the saved-for-the-record copies.

| File | Covers | Spec | Status |
|---|---|---|---|
| `project_list.html` | Organisation → Project List (alert level: % schedule vs % budget) → New Project intake (customer/brief/land) → Project Overview (client/project/site + 18-stage roadmap) → Stage → Task drill-down | `xprojman-28.md` module 18/19, `xprojman-29.md` (task cost fields) | Reviewed 2026-09-03, owner named it "project_list" |
| `defects_closeout.html` | Defects punch-list + proposed close-out panel (status/assignee/due-date) | `xprojman-28.md` module 4 | Reviewed 2026-09-03, approved |
| `task_detail.html` | Task drill-down detail: notes, attachments (DWG/PDF/DOCX/image/video), outsourced → Raise Purchase Order, and a PDF/image markup tool (7 colours, 3 pen sizes, 5 shapes, text) via PDF.js + Fabric.js + Mammoth (all CDN, open-source) | `xprojman-28.md` module 19, `docs/researchPaper/18Stage_Tasks.md` (task S16.4 used as the worked example) | Drafted 2026-09-03, pending owner review — not yet browser-verified (no live browser access this session) |

Named `project_list.html` (not `project_journey.html`) to match the name the
owner gave the published artifact, so the file on disk and the reviewed
link refer to the same thing.

## What's real vs. mocked in `project_list.html`

- **Client/Project/Site info, the 18-stage names, and task description/dates/
  assigned-to** are grounded in real schema/spec (`docs/18StageProjectMangementMatrix.md`,
  the `tasks`/`projects`/`project_stages` tables) — not invented.
- **Invoice and HR-hours-used on a task** render a "pending XP-29" placeholder,
  not fabricated numbers — that data doesn't exist at task granularity yet;
  see `xprojman-29.md`.
- **The Alert-level formula** (Budget% vs Schedule% gap, on-hold status) is a
  first proposal, not a locked decision — see `portaldesignspecification.md`
  §3.4 module 18 for the current state of that formula and what's still open
  (overdue defects / blocked hold points aren't factored in yet).
- All project/client/task names (Lakeview Estate, David & Louise Turner,
  Ridgeline Construction Group, etc.) are fictional example data.
