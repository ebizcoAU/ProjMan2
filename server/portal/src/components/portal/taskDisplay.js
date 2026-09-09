// Owner report 2026-09-08: task titles showing "S1.4 S1.4 Confirm lot/plan…" —
// some task rows' `name` already carries its own leading Sx.x code (a data-entry
// artifact, not something every call site should have to work around itself).
// Strip it defensively wherever code and name are displayed together, so a fix
// here covers every place `t.code`/`t.name` are shown side by side, regardless
// of why a given row's `name` carries it.
export function taskDisplayName(task) {
  const code = task?.code;
  const name = task?.name || '';
  if (code && name.startsWith(code)) {
    return name.slice(code.length).replace(/^[\s:.\-–—]+/, '');
  }
  return name;
}
