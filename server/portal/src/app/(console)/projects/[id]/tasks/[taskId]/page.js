// /projects/:id/tasks/:taskId — Task drill-down (portaldesignspec §3.4 module 19,
// xprojman-28). Wired against real reads: projectsApi.detail(id) already returns
// `tasks` (v030's `output_note`/`actual_hours` included), commercialApi.purchaseOrders
// for task-scoped POs, documentsApi for attachments (`entity_type='task'`, v030/
// xprojman-29). Markup tool: PDF.js + Fabric.js + Mammoth, loaded as classic <script>
// globals the same way login/page.js already loads Google Identity Services — this
// codebase's existing pattern for a third-party global, not an npm dependency here.
//
// Output/notes is editable via `PATCH /projects/:id/tasks/:taskId` (xprojman-32 §5,
// TaskProgressService.updateOfficeFields, `projects.write` — deliberately not the
// progress.tick/verify chain). That route didn't exist when this page was first
// wired; confirmed live in the route file before enabling the Save button here.
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { usePortalData } from '@/components/portal/usePortalData';
import { projectsApi, commercialApi, documentsApi } from '@/lib/api';

const PDFJS_SRC   = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const FABRIC_SRC  = 'https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.0/fabric.min.js';
const MAMMOTH_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.12.2/mammoth.browser.min.js';

const COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#a855f7','#111827'];
const SIZES  = [2, 4, 8];
const SHAPE_TOOLS = [
  { id: 'pen',      label: 'Pen' },
  { id: 'rect',     label: 'Rectangle' },
  { id: 'ellipse',  label: 'Ellipse' },
  { id: 'line',     label: 'Line' },
  { id: 'arrow',    label: 'Arrow' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'text',     label: 'Text' },
];

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.body.appendChild(s);
  });
}

function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}
function dt(v) { return v ? new Date(v).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : '—'; }
function kindOf(doc) {
  const mime = doc.mime_type || '';
  const ext = (doc.original_filename || '').split('.').pop().toLowerCase();
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'img';
  if (ext === 'docx') return 'docx';
  if (ext === 'doc') return 'doc';
  if (ext === 'dwg') return 'dwg';
  if (mime.startsWith('video/')) return 'video';
  return 'other';
}

function Progress({ pct }) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 160 }}>
      <div style={{ flex: 1, height: 8, background: 'var(--b2)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${p}%`, height: '100%', background: p === 100 ? 'var(--green)' : 'var(--brand)' }} />
      </div>
      <span style={{ fontSize: 12, color: 'var(--dim)', width: 34, textAlign: 'right' }}>{p}%</span>
    </div>
  );
}
function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{children}</div>
    </div>
  );
}
function ActionBtn({ children, onClick, disabled, title, primary }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      style={{
        padding: '6px 13px', fontSize: 12.5, fontWeight: 600, borderRadius: 6,
        border: `1px solid ${primary ? 'var(--brand)' : 'var(--b1)'}`,
        background: primary ? 'var(--brand)' : 'var(--s1)',
        color: disabled ? 'var(--dim)' : (primary ? '#fff' : 'var(--brand)'),
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
      }}>
      {children}
    </button>
  );
}

export default function TaskDetailPage() {
  const { id, taskId } = useParams();
  const project = usePortalData(() => projectsApi.detail(id), [id]);
  const posData = usePortalData(() => commercialApi.purchaseOrders(id), [id]);
  const docsData = usePortalData(() => documentsApi.list('task', taskId), [taskId]);

  const proj   = project.data?.data?.project;
  const stages = project.data?.data?.stages || [];
  const tasks  = project.data?.data?.tasks || [];
  const task   = tasks.find((t) => String(t.id) === String(taskId));
  const stage  = task ? stages.find((s) => String(s.id) === String(task.stage_id)) : null;
  const docs   = docsData.data?.data?.documents || [];
  const pos    = (posData.data?.data || []).filter((po) => String(po.task_id) === String(taskId));

  // ── attachments: upload ──────────────────────────────────────────────────
  const fileInputRef = useRef(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadErr, setUploadErr]   = useState(null);
  const onFilesPicked = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setUploadBusy(true); setUploadErr(null);
    try {
      for (const file of files) {
        await documentsApi.upload({ file, entityType: 'task', entityId: taskId, projectId: id });
      }
      await docsData.refetch();
    } catch (err) {
      setUploadErr(err?.response?.data?.message || err.message || 'Upload failed');
    } finally {
      setUploadBusy(false);
    }
  };

  // ── output / notes (PATCH /projects/:id/tasks/:taskId, xprojman-32 §5) ──────
  const [noteDraft, setNoteDraft] = useState('');
  const [noteDirty, setNoteDirty] = useState(false);
  const [noteBusy, setNoteBusy]   = useState(false);
  const [noteErr, setNoteErr]     = useState(null);
  useEffect(() => {
    if (task && !noteDirty) setNoteDraft(task.output_note || '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.output_note, task?.id]);
  const saveNote = async () => {
    setNoteBusy(true); setNoteErr(null);
    try {
      await projectsApi.patchTask(id, taskId, noteDraft);
      setNoteDirty(false);
      await project.refetch();
    } catch (err) {
      setNoteErr(err?.response?.data?.message || err.message || 'Could not save');
    } finally {
      setNoteBusy(false);
    }
  };

  // ── purchase order raise ─────────────────────────────────────────────────
  const [poOpen, setPoOpen] = useState(false);
  const [poBusy, setPoBusy] = useState(false);
  const [poErr, setPoErr]   = useState(null);
  const [poForm, setPoForm] = useState({ supplier_name: '', description: '', amount: '' });
  const raisePo = async (e) => {
    e.preventDefault();
    setPoBusy(true); setPoErr(null);
    try {
      await commercialApi.createPurchaseOrder(id, {
        task_id: taskId, stage_id: task?.stage_id || null,
        supplier_name: poForm.supplier_name, description: poForm.description,
        amount: parseFloat(poForm.amount) || 0,
      });
      setPoOpen(false);
      setPoForm({ supplier_name: '', description: '', amount: '' });
      await posData.refetch();
    } catch (err) {
      setPoErr(err?.response?.data?.message || err.message || 'Could not raise the purchase order');
    } finally {
      setPoBusy(false);
    }
  };

  // ── third-party libs (classic <script> globals, same pattern as login/page.js) ──
  const [libsReady, setLibsReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadScriptOnce(PDFJS_SRC), loadScriptOnce(FABRIC_SRC), loadScriptOnce(MAMMOTH_SRC)])
      .then(() => {
        if (cancelled) return;
        if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        setLibsReady(true);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // ── viewer / markup state ────────────────────────────────────────────────
  const [viewer, setViewer] = useState(null); // { doc, kind, name } | null
  const [viewerErr, setViewerErr] = useState(null);
  const [pageInfo, setPageInfo] = useState({ page: 1, count: 1 });
  const [activeTool, setActiveTool] = useState('pen');
  const [activeColor, setActiveColor] = useState(COLORS[0]);
  const [activeSize, setActiveSize] = useState(SIZES[1]);
  const pdfCanvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const docxPaneRef = useRef(null);
  const fabricRef = useRef(null);    // current fabric.Canvas instance
  const pdfDocRef = useRef(null);    // current pdf.js document
  const pageStatesRef = useRef({});  // per-page fabric JSON, PDF only

  const closeViewer = () => {
    if (fabricRef.current) { try { fabricRef.current.dispose(); } catch { /* already gone */ } }
    fabricRef.current = null; pdfDocRef.current = null; pageStatesRef.current = {};
    setViewer(null); setViewerErr(null);
  };

  const wireShapeDrawing = useCallback((canvas) => {
    const fabric = window.fabric;
    let drawing = null, startX = 0, startY = 0;
    canvas.on('mouse:down', (opt) => {
      if (activeTool === 'pen') return;
      const p = canvas.getPointer(opt.e);
      startX = p.x; startY = p.y;
      const common = { stroke: activeColor, strokeWidth: activeSize, fill: 'transparent', selectable: false };
      if (activeTool === 'rect') drawing = new fabric.Rect({ left: startX, top: startY, width: 1, height: 1, ...common });
      else if (activeTool === 'ellipse') drawing = new fabric.Ellipse({ left: startX, top: startY, rx: 1, ry: 1, ...common });
      else if (activeTool === 'line') drawing = new fabric.Line([startX, startY, startX, startY], { stroke: activeColor, strokeWidth: activeSize, selectable: false });
      else if (activeTool === 'arrow') drawing = new fabric.Group([
          new fabric.Line([0, 0, 0, 0], { stroke: activeColor, strokeWidth: activeSize }),
          new fabric.Triangle({ width: 6 + activeSize * 1.5, height: 8 + activeSize * 1.8, fill: activeColor, left: 0, top: 0 }),
        ], { left: startX, top: startY, selectable: false });
      else if (activeTool === 'triangle') drawing = new fabric.Triangle({ left: startX, top: startY, width: 1, height: 1, ...common });
      else if (activeTool === 'text') {
        const t = new fabric.IText('Note', { left: startX, top: startY, fill: activeColor, fontFamily: 'inherit', fontSize: 14 + activeSize * 2 });
        canvas.add(t); canvas.setActiveObject(t); t.enterEditing(); drawing = null; return;
      }
      if (drawing) canvas.add(drawing);
    });
    canvas.on('mouse:move', (opt) => {
      if (!drawing) return;
      const p = canvas.getPointer(opt.e);
      if (activeTool === 'rect' || activeTool === 'triangle') drawing.set({ width: Math.abs(p.x - startX), height: Math.abs(p.y - startY), left: Math.min(p.x, startX), top: Math.min(p.y, startY) });
      else if (activeTool === 'ellipse') drawing.set({ rx: Math.abs(p.x - startX) / 2, ry: Math.abs(p.y - startY) / 2, left: Math.min(p.x, startX), top: Math.min(p.y, startY) });
      else if (activeTool === 'line') drawing.set({ x2: p.x, y2: p.y });
      else if (activeTool === 'arrow') {
        const dx = p.x - startX, dy = p.y - startY, angle = Math.atan2(dy, dx) * 180 / Math.PI;
        const line = drawing.item(0), head = drawing.item(1);
        line.set({ x2: dx, y2: dy });
        head.set({ left: dx, top: dy, angle: angle + 90, originX: 'center', originY: 'center' });
        drawing.addWithUpdate();
      }
      canvas.requestRenderAll();
    });
    canvas.on('mouse:up', () => { drawing = null; });
  }, [activeTool, activeColor, activeSize]);

  const applyToolSettings = (canvas) => {
    canvas.isDrawingMode = activeTool === 'pen';
    if (canvas.isDrawingMode) { canvas.freeDrawingBrush.color = activeColor; canvas.freeDrawingBrush.width = activeSize; }
  };

  const renderPdfPage = useCallback((pageNum) => {
    pdfDocRef.current.getPage(pageNum).then((page) => {
      const viewport = page.getViewport({ scale: 1.2 });
      const pdfCanvas = pdfCanvasRef.current, overlayCanvas = overlayCanvasRef.current;
      pdfCanvas.width = overlayCanvas.width = viewport.width;
      pdfCanvas.height = overlayCanvas.height = viewport.height;
      page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport });

      if (fabricRef.current) { try { fabricRef.current.dispose(); } catch { /* noop */ } }
      const canvas = new window.fabric.Canvas(overlayCanvas, { width: viewport.width, height: viewport.height });
      if (pageStatesRef.current[pageNum]) canvas.loadFromJSON(pageStatesRef.current[pageNum], canvas.renderAll.bind(canvas));
      wireShapeDrawing(canvas);
      applyToolSettings(canvas);
      fabricRef.current = canvas;
      setPageInfo({ page: pageNum, count: pdfDocRef.current.numPages });
    });
  }, [wireShapeDrawing]); // eslint-disable-line react-hooks/exhaustive-deps

  const openViewer = async (doc) => {
    const kind = kindOf(doc);
    setViewerErr(null);
    if (kind === 'dwg' || kind === 'doc' || kind === 'other') {
      try {
        const blob = await documentsApi.fetchBlob(doc.document_id);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = doc.original_filename || 'file';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      } catch (err) { setViewerErr(err.message); }
      return;
    }
    if (!libsReady) { setViewerErr('Viewer libraries are still loading — try again in a second.'); return; }
    setViewer({ doc, kind, name: doc.original_filename });
    try {
      const blob = await documentsApi.fetchBlob(doc.document_id);
      if (kind === 'img') {
        const url = URL.createObjectURL(blob);
        setTimeout(() => {
          window.fabric.Image.fromURL(url, (img) => {
            const w = Math.min(img.width, 900), scale = w / img.width;
            const canvas = new window.fabric.Canvas(overlayCanvasRef.current, { width: w, height: img.height * scale, backgroundColor: '#fff' });
            img.scale(scale);
            canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas));
            wireShapeDrawing(canvas);
            applyToolSettings(canvas);
            fabricRef.current = canvas;
          });
        }, 0);
      } else if (kind === 'pdf') {
        const buf = await blob.arrayBuffer();
        window.pdfjsLib.getDocument({ data: buf }).promise.then((pdf) => {
          pdfDocRef.current = pdf; pageStatesRef.current = {};
          setTimeout(() => renderPdfPage(1), 0);
        }).catch(() => setViewerErr('Could not read that PDF'));
      } else if (kind === 'docx') {
        const buf = await blob.arrayBuffer();
        window.mammoth.convertToHtml({ arrayBuffer: buf }).then((res) => {
          if (docxPaneRef.current) docxPaneRef.current.innerHTML = res.value || '<p><em>Empty document.</em></p>';
        }).catch(() => { if (docxPaneRef.current) docxPaneRef.current.innerHTML = '<p>Could not preview this file.</p>'; });
      } else if (kind === 'video') {
        setViewer((v) => ({ ...v, url: URL.createObjectURL(blob) }));
      }
    } catch (err) { setViewerErr(err.message); }
  };

  const goPage = (delta) => {
    if (!pdfDocRef.current || !fabricRef.current) return;
    const next = pageInfo.page + delta;
    if (next < 1 || next > pdfDocRef.current.numPages) return;
    pageStatesRef.current[pageInfo.page] = fabricRef.current.toJSON();
    renderPdfPage(next);
  };
  const undo = () => {
    const c = fabricRef.current; if (!c) return;
    const objs = c.getObjects(); if (objs.length) c.remove(objs[objs.length - 1]);
  };
  const clearMarkup = () => { if (fabricRef.current) fabricRef.current.clear(); };

  useEffect(() => { if (fabricRef.current) applyToolSettings(fabricRef.current); }, [activeTool, activeColor, activeSize]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── render ────────────────────────────────────────────────────────────────
  if (project.loading && !proj) return <div style={{ padding: 20 }}><PortalEmpty message="Loading…" /></div>;
  if (project.error) return <div style={{ padding: 20 }}><PortalError message={project.error} /></div>;
  if (!proj) return <div style={{ padding: 20 }}><PortalError message="Project not found" /></div>;
  if (!task) return <div style={{ padding: 20 }}><PortalError message="Task not found on this project" /></div>;

  return (
    <div style={{ padding: 20, maxWidth: 1000 }}>
      <div style={{ marginBottom: 10 }}>
        <Link href={`/projects/${id}/field`} style={{ fontSize: 13, color: 'var(--dim)', textDecoration: 'none' }}>&larr; Back to Field</Link>
      </div>
      <div style={{ fontFamily: 'var(--fh)', fontSize: 20, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>
        {task.name}
      </div>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
        <span style={{ fontFamily: 'var(--fm)', color: 'var(--brand)' }}>{proj.code}</span> {proj.name}
        {stage ? <> &nbsp;→&nbsp; Stage {stage.seq} · {stage.name}</> : null}
      </div>

      <PortalCard>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 16 }}>
          <Field label="Assigned to">{task.assigned_to_name || '—'}</Field>
          <Field label="Start date">{task.start_date ? new Date(task.start_date).toLocaleDateString('en-AU') : '—'}</Field>
          <Field label="End date">{task.end_date ? new Date(task.end_date).toLocaleDateString('en-AU') : '—'}</Field>
          <Field label="Actual hours">{task.actual_hours != null ? task.actual_hours : '—'}</Field>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: 6 }}>Completion</div>
        <Progress pct={task.completion} />
      </PortalCard>

      <PortalCard title="Output / notes">
        <textarea
          value={noteDraft}
          onChange={(e) => { setNoteDraft(e.target.value); setNoteDirty(true); }}
          placeholder="What did this task actually produce, in the assignee's own words…"
          rows={3}
          style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--b1)', background: 'var(--s2)', color: 'var(--text)', fontSize: 14, fontFamily: 'inherit', resize: 'vertical' }}
        />
        {noteErr && <div style={{ marginTop: 8 }}><PortalError message={noteErr} /></div>}
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
          <ActionBtn primary onClick={saveNote} disabled={!noteDirty || noteBusy}>{noteBusy ? 'Saving…' : 'Save'}</ActionBtn>
          {noteDirty && !noteBusy && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Unsaved changes</span>}
        </div>
      </PortalCard>

      <PortalCard title="Purchase orders">
        {pos.length === 0 ? <PortalEmpty message="No purchase orders raised against this task." /> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ background: 'var(--s2)', borderBottom: '1px solid var(--b1)' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--dim)', fontSize: 12 }}>PO #</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--dim)', fontSize: 12 }}>Supplier</th>
                <th style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--dim)', fontSize: 12 }}>Amount</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--dim)', fontSize: 12 }}>Status</th>
              </tr></thead>
              <tbody>
                {pos.map((po) => (
                  <tr key={po.id} style={{ borderBottom: '1px solid var(--b2)' }}>
                    <td style={{ padding: '8px 10px', fontFamily: 'var(--fm)' }}>{po.po_number || po.id.slice(0, 8)}</td>
                    <td style={{ padding: '8px 10px' }}>{po.supplier_name || '—'}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'var(--fm)' }}>${Number(po.amount).toLocaleString('en-AU', { minimumFractionDigits: 2 })}</td>
                    <td style={{ padding: '8px 10px' }}><span className="badge badge-pending">{po.status || 'draft'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          {!poOpen ? (
            <ActionBtn onClick={() => setPoOpen(true)}>+ Raise purchase order</ActionBtn>
          ) : (
            <form onSubmit={raisePo} style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 380 }}>
              <input required placeholder="Supplier / subcontractor" value={poForm.supplier_name}
                onChange={(e) => setPoForm((f) => ({ ...f, supplier_name: e.target.value }))}
                style={{ padding: '8px 11px', borderRadius: 7, border: '1px solid var(--b1)', background: 'var(--s2)', color: 'var(--text)', fontSize: 13.5 }} />
              <input required placeholder="Description" value={poForm.description}
                onChange={(e) => setPoForm((f) => ({ ...f, description: e.target.value }))}
                style={{ padding: '8px 11px', borderRadius: 7, border: '1px solid var(--b1)', background: 'var(--s2)', color: 'var(--text)', fontSize: 13.5 }} />
              <input required type="number" step="0.01" min="0" placeholder="Amount (AUD, ex GST)" value={poForm.amount}
                onChange={(e) => setPoForm((f) => ({ ...f, amount: e.target.value }))}
                style={{ padding: '8px 11px', borderRadius: 7, border: '1px solid var(--b1)', background: 'var(--s2)', color: 'var(--text)', fontSize: 13.5 }} />
              {poErr && <PortalError message={poErr} />}
              <div style={{ display: 'flex', gap: 8 }}>
                <ActionBtn primary disabled={poBusy}>{poBusy ? 'Raising…' : 'Raise PO'}</ActionBtn>
                <ActionBtn onClick={() => setPoOpen(false)}>Cancel</ActionBtn>
              </div>
            </form>
          )}
        </div>
      </PortalCard>

      <PortalCard title="Attachments">
        <input ref={fileInputRef} type="file" multiple hidden
          accept=".pdf,.docx,.dwg,.png,.jpg,.jpeg,.mp4,.mov,.webm" onChange={onFilesPicked} />
        <div style={{ marginBottom: 12 }}>
          <ActionBtn onClick={() => fileInputRef.current?.click()} disabled={uploadBusy}>
            {uploadBusy ? 'Uploading…' : '+ Add file'}
          </ActionBtn>
          <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--muted)' }}>Drawings (DWG), PDF, Word (.docx), images, video.</span>
        </div>
        {uploadErr && <div style={{ marginBottom: 10 }}><PortalError message={uploadErr} /></div>}
        {docsData.error && <PortalError message={docsData.error} />}
        {docs.length === 0 ? <PortalEmpty message="No attachments yet." /> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            {docs.map((doc) => {
              const kind = kindOf(doc);
              return (
                <div key={doc.document_id} style={{ border: '1px solid var(--b1)', background: 'var(--s2)', borderRadius: 8, padding: 11 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, wordBreak: 'break-word', marginBottom: 2 }}>{doc.original_filename || '(unnamed)'}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--fm)', marginBottom: 8 }}>
                    {fmtSize(doc.size_bytes)} · {doc.uploaded_by_name || 'unknown'} · {dt(doc.created_at)}
                  </div>
                  <ActionBtn onClick={() => openViewer(doc)} disabled={!libsReady && kind !== 'dwg' && kind !== 'doc' && kind !== 'other'}>
                    {kind === 'pdf' || kind === 'img' ? 'Markup' : kind === 'docx' ? 'Preview' : kind === 'video' ? 'Play' : 'Download'}
                  </ActionBtn>
                </div>
              );
            })}
          </div>
        )}
      </PortalCard>

      {/* ── Viewer / markup overlay ─────────────────────────────────────────── */}
      {viewer && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,14,20,.88)', zIndex: 300, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', background: 'var(--s1)', borderBottom: '1px solid var(--b1)' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{viewer.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {viewer.kind === 'pdf' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--fm)', fontSize: 12.5, color: 'var(--dim)' }}>
                  <ActionBtn onClick={() => goPage(-1)}>‹</ActionBtn>
                  <span>{pageInfo.page} / {pageInfo.count}</span>
                  <ActionBtn onClick={() => goPage(1)}>›</ActionBtn>
                </div>
              )}
              <ActionBtn onClick={() => alert('Markup saved as a new attachment version (not yet wired to a save-back endpoint).')}>Save markup</ActionBtn>
              <button onClick={closeViewer} style={{ background: 'none', border: 'none', fontSize: 22, color: 'var(--muted)', cursor: 'pointer' }}>&times;</button>
            </div>
          </div>
          <div style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 26 }}>
            {viewerErr && <div style={{ color: 'var(--red)', background: 'var(--s1)', padding: 16, borderRadius: 8 }}>{viewerErr}</div>}
            {viewer.kind === 'docx' && <div ref={docxPaneRef} style={{ background: '#fff', color: '#1a1a1a', maxWidth: 760, width: '100%', padding: '40px 50px', borderRadius: 4 }}>Loading preview…</div>}
            {viewer.kind === 'video' && viewer.url && <video src={viewer.url} controls style={{ maxWidth: 900, width: '100%' }} />}
            {(viewer.kind === 'pdf' || viewer.kind === 'img') && (
              <div style={{ position: 'relative', background: '#fff', boxShadow: '0 10px 40px rgba(0,0,0,.4)' }}>
                {viewer.kind === 'pdf' && <canvas ref={pdfCanvasRef} style={{ display: 'block', position: 'absolute', top: 0, left: 0 }} />}
                <canvas ref={overlayCanvasRef} style={{ display: 'block', position: viewer.kind === 'pdf' ? 'absolute' : 'static', top: 0, left: 0 }} />
              </div>
            )}
          </div>
          {(viewer.kind === 'pdf' || viewer.kind === 'img') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 20px', background: 'var(--s1)', borderTop: '1px solid var(--b1)', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 6 }}>
                {SHAPE_TOOLS.map((t) => (
                  <button key={t.id} title={t.label} onClick={() => setActiveTool(t.id)}
                    style={{ width: 30, height: 30, borderRadius: 7, border: `1px solid ${activeTool === t.id ? 'var(--brand)' : 'var(--b1)'}`, background: activeTool === t.id ? 'var(--bdim)' : 'var(--s2)', fontSize: 11, color: 'var(--text)', cursor: 'pointer' }}>
                    {t.label[0]}
                  </button>
                ))}
              </div>
              <div style={{ width: 1, height: 24, background: 'var(--b1)' }} />
              <div style={{ display: 'flex', gap: 6 }}>
                {COLORS.map((c) => (
                  <button key={c} onClick={() => setActiveColor(c)} title={c}
                    style={{ width: 20, height: 20, borderRadius: '50%', background: c, border: activeColor === c ? '2px solid var(--text)' : '2px solid transparent', cursor: 'pointer' }} />
                ))}
              </div>
              <div style={{ width: 1, height: 24, background: 'var(--b1)' }} />
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {SIZES.map((s, i) => (
                  <button key={s} onClick={() => setActiveSize(s)} title={['Thin', 'Medium', 'Thick'][i]}
                    style={{ width: 26, height: 26, borderRadius: 7, border: `1px solid ${activeSize === s ? 'var(--brand)' : 'var(--b1)'}`, background: activeSize === s ? 'var(--bdim)' : 'var(--s2)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                    <span style={{ width: 4 + i * 4, height: 4 + i * 4, borderRadius: '50%', background: 'var(--text)' }} />
                  </button>
                ))}
              </div>
              <div style={{ width: 1, height: 24, background: 'var(--b1)' }} />
              <ActionBtn onClick={undo}>Undo</ActionBtn>
              <ActionBtn onClick={clearMarkup}>Clear</ActionBtn>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
