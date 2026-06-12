import { type ReactNode, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronRight,
  Clipboard,
  Download,
  FileSpreadsheet,
  FileText,
  GripVertical,
  Merge,
  Plus,
  Printer,
  Scissors,
  Trash2,
  UploadCloud
} from 'lucide-react';
import type { AlignRow, Article, SplitResult, Template, TemplateTrashItem, TemplateTrashUsage } from '../types';
import type { AuthSession, Role } from '../lib/apiClient';
import { HomePage } from '../components/HomePage';
import { AccountMenu, WorkbenchHeader } from '../components/WorkbenchHeader';
import { AdminPage } from './AdminPage';
import { LoginPage } from './LoginPage';
import {
  apiText,
  apiVision,
  clearTemplateTrash,
  clearStoredSession,
  deleteTemplate,
  getTemplateTrash,
  getTemplates,
  getStoredSession,
  login,
  purgeTemplateTrash,
  restoreTemplateTrash,
  saveTemplate,
  storeSession,
} from '../lib/apiClient';
import { alignArticles, articleSimilarity } from '../lib/alignment';
import { diffTexts, hasTextChange } from '../lib/diff';
import { exportInterpretationDocx } from '../lib/docxExport';
import { exportCompareExcel, type RowDiffs } from '../lib/excelExport';
import {
  buildChunkStructuredPrompt,
  buildStructuredPrompt,
  builtInTemplates,
  defaultTemplate,
  emptyReport,
  isAiSupplement,
  isReportEmpty,
  mergeReports,
  META_TEMPLATE_PROMPT,
  normalizeReport,
  parseInterpretationJson,
  splitTextForModel,
  type InterpretationReport,
  type ReportProgress
} from '../lib/interpretation';
import { parseFile, renderPdfPagesAsImages } from '../lib/parser';
import { makeArticle, splitArticles } from '../lib/splitter';

type Side = 'left' | 'right';
type Stage = 'upload' | 'adjust' | 'result';
type InterpretStage = 'upload' | 'generating' | 'review' | 'result';
type AppMode = 'compare' | 'interpret';
type RouteState = { page: 'login' | 'home' | 'compare' | 'interpret' | 'admin' };
type RouteAction = { type: 'navigate'; page: RouteState['page']; replace?: boolean } | { type: 'sync'; page: RouteState['page'] };

type DocState = {
  fileName: string;
  text: string;
  preface: string;
  articles: Article[];
  warning: string | null;
  loading: boolean;
};

type GridBox = {
  id: string;
  article: Article | null;
  moved?: boolean;
};

type SelectedBox = {
  side: Side;
  index: number;
} | null;

type DragBox = {
  side: Side;
  index: number;
} | null;

const emptyDoc: DocState = {
  fileName: '',
  text: '',
  preface: '',
  articles: [],
  warning: null,
  loading: false
};

function routeReducer(_state: RouteState, action: RouteAction): RouteState {
  return { page: action.page };
}

function initialRoute(): RouteState {
  return { page: pageFromHash() };
}

function pageFromHash(): RouteState['page'] {
  const page = window.location.hash.replace(/^#\/?/, '') as RouteState['page'];
  if (page === 'login' || page === 'home' || page === 'compare' || page === 'interpret' || page === 'admin') return page;
  return 'home';
}

export function App() {
  const [session, setSession] = useState<AuthSession | null>(() => getStoredSession());
  const [route, dispatchRoute] = useReducer(routeReducer, undefined, initialRoute);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [stage, setStage] = useState<Stage>('upload');
  const [interpretStage, setInterpretStage] = useState<InterpretStage>('upload');
  const [leftDoc, setLeftDoc] = useState<DocState>(emptyDoc);
  const [rightDoc, setRightDoc] = useState<DocState>(emptyDoc);
  const [interpretDoc, setInterpretDoc] = useState<DocState>(emptyDoc);
  const [leftBoxes, setLeftBoxes] = useState<GridBox[]>([]);
  const [rightBoxes, setRightBoxes] = useState<GridBox[]>([]);
  const [diffsByIndex, setDiffsByIndex] = useState<ReturnType<typeof diffTexts>[]>([]);
  const [selectedBox, setSelectedBox] = useState<SelectedBox>(null);
  const [dragBox, setDragBox] = useState<DragBox>(null);
  const [template, setTemplate] = useState<Template>(defaultTemplate);
  const [templates, setTemplates] = useState<Template[]>(builtInTemplates);
  const [draftReport, setDraftReport] = useState<InterpretationReport | null>(null);
  const [confirmedReport, setConfirmedReport] = useState<InterpretationReport | null>(null);
  const [reportProgress, setReportProgress] = useState<ReportProgress>({ stage: 'idle', message: '', done: 0, total: 0 });
  const [resultFilter, setResultFilter] = useState<'inserted' | 'deleted' | 'modified' | null>(null);
  const [showChangedOnly, setShowChangedOnly] = useState(false);
  const mode: AppMode = route.page === 'interpret' ? 'interpret' : 'compare';
  const showAdmin = route.page === 'admin';

  const rows = useMemo(() => rowsFromBoxes(leftBoxes, rightBoxes), [leftBoxes, rightBoxes]);
  const summary = useMemo(() => summarizeRows(rows), [rows]);
  const visibleResultRows = useMemo(
    () =>
      rows.filter((row) => {
        if (showChangedOnly && !rowHasChange(row)) return false;
        if (resultFilter === 'inserted') return row.type === 'inserted';
        if (resultFilter === 'deleted') return row.type === 'deleted';
        if (resultFilter === 'modified') return row.type === 'matched' && hasTextChange(row.left?.text ?? '', row.right?.text ?? '');
        return true;
      }),
    [resultFilter, rows, showChangedOnly]
  );
  const rowDiffs = useMemo(
    () =>
      new Map(
        rows.map((row, index) => [
          row,
          diffsByIndex[index] ?? []
        ])
      ) as RowDiffs,
    [diffsByIndex, rows]
  );

  useEffect(() => {
    const syncHash = () => dispatchRoute({ type: 'sync', page: pageFromHash() });
    window.addEventListener('hashchange', syncHash);
    return () => window.removeEventListener('hashchange', syncHash);
  }, []);

  useEffect(() => {
    const page = session ? route.page : 'login';
    const nextHash = `#/${page}`;
    if (window.location.hash !== nextHash) window.history.replaceState(null, '', nextHash);
  }, [route.page, session]);

  useEffect(() => {
    if (!session) return;
    if (route.page === 'login') {
      dispatchRoute({ type: 'navigate', page: 'home' });
      return;
    }
    if (route.page === 'admin' && session.role !== 'admin') {
      dispatchRoute({ type: 'navigate', page: 'home' });
      return;
    }
    void getTemplates(session.token)
      .then((data) => {
        setTemplates(mergeTemplates(data.templates));
      })
      .catch(() => setTemplates(builtInTemplates));
  }, [route.page, session]);

  if (!session) {
    return (
      <LoginPage
        onLogin={(next) => {
          setSession(next);
          dispatchRoute({ type: 'navigate', page: 'home' });
        }}
      />
    );
  }
  const sessionToken = session.token;
  const navigateTo = (page: RouteState['page']) => {
    dispatchRoute({ type: 'navigate', page });
    setAccountMenuOpen(false);
  };

  const logout = () => {
    clearStoredSession();
    setSession(null);
    setAccountMenuOpen(false);
    dispatchRoute({ type: 'navigate', page: 'login' });
  };

  const switchToAdminMode = async () => {
    const password = window.prompt('请输入管理员口令');
    if (!password) return;
    try {
      const next = await login('admin', password);
      setSession(next);
      setAccountMenuOpen(false);
      dispatchRoute({ type: 'navigate', page: 'home' });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '管理员口令错误，请重试。');
    }
  };

  const switchToUserMode = () => {
    const next = { ...session, role: 'user' as const };
    storeSession(next);
    setSession(next);
    setAccountMenuOpen(false);
    dispatchRoute({ type: 'navigate', page: 'home' });
  };

  const openAdminConfig = () => {
    if (session.role !== 'admin') return;
    navigateTo('admin');
  };

  const accountControl = (
    <AccountMenu
      role={session.role}
      open={accountMenuOpen}
      onToggle={() => setAccountMenuOpen((value) => !value)}
      onLogout={logout}
      onSwitchToAdmin={() => void switchToAdminMode()}
      onSwitchToUser={switchToUserMode}
      onOpenAdmin={openAdminConfig}
    />
  );

  if (route.page === 'home') {
    return (
      <HomePage
        accountControl={accountControl}
        onNavigate={(target) => {
          navigateTo(target);
        }}
      />
    );
  }

  async function handleFile(side: Side, file: File) {
    const setDoc = side === 'left' ? setLeftDoc : setRightDoc;
    setDoc((doc) => ({ ...doc, loading: true, warning: null, fileName: file.name }));
    try {
      const parsed = await parseFile(file);
      if (parsed.warning) {
        if (file.name.toLowerCase().endsWith('.pdf')) {
          try {
            setDoc((doc) => ({ ...doc, warning: '检测到扫描件或无文字层 PDF，正在调用 OCR 识别...' }));
            const pages = await renderPdfPagesAsImages(file, (current, total) => {
              setDoc((doc) => ({ ...doc, warning: `OCR 识别中：第 ${current} / ${total} 页` }));
            });
            const texts: string[] = [];
            for (let index = 0; index < pages.length; index += 1) {
              setDoc((doc) => ({ ...doc, warning: `OCR 中转请求中：第 ${index + 1} / ${pages.length} 页` }));
              const result = await apiVision({ image: pages[index] }, sessionToken);
              if (result.text) texts.push(result.text);
            }
            const text = texts.join('\n\n').trim();
            if (!text) throw new Error('OCR 未返回可用文本。');
            const split = splitArticles(text);
            finishCompareDoc(side, { fileName: file.name, text, preface: split.preface, articles: split.articles, warning: null, loading: false });
            return;
          } catch {
            setDoc({ ...emptyDoc, fileName: file.name, warning: `${parsed.warning} OCR 识别失败，请稍后重试。`, loading: false });
            return;
          }
        }
        setDoc({ ...emptyDoc, fileName: file.name, warning: parsed.warning, loading: false });
        return;
      }
      const split = splitArticles(parsed.text);
      finishCompareDoc(side, { fileName: file.name, text: parsed.text, preface: split.preface, articles: split.articles, warning: null, loading: false });
    } catch (error) {
      setDoc((doc) => ({
        ...doc,
        loading: false,
        warning: error instanceof Error ? error.message : '文件解析失败，请检查文件格式。'
      }));
    }
  }

  function finishCompareDoc(side: Side, nextDoc: DocState) {
    if (side === 'left') setLeftDoc(nextDoc);
    else setRightDoc(nextDoc);
    const nextLeft = side === 'left' ? nextDoc : leftDoc;
    const nextRight = side === 'right' ? nextDoc : rightDoc;
    if (nextLeft.articles.length && nextRight.articles.length) {
      initializeCompareGrid(alignArticles(nextLeft.articles, nextRight.articles));
    }
  }

  async function handleInterpretFile(file: File) {
    setInterpretDoc((doc) => ({ ...doc, loading: true, warning: null, fileName: file.name }));
    try {
      const parsed = await parseFile(file);
      let text = parsed.text;
      if (parsed.warning && file.name.toLowerCase().endsWith('.pdf')) {
        setInterpretDoc((doc) => ({ ...doc, warning: '检测到扫描件或无文字层 PDF，正在调用 OCR 识别...' }));
        const pages = await renderPdfPagesAsImages(file, (current, total) => {
          setInterpretDoc((doc) => ({ ...doc, warning: `OCR 识别中：第 ${current} / ${total} 页` }));
        });
        const texts: string[] = [];
        for (let index = 0; index < pages.length; index += 1) {
          setInterpretDoc((doc) => ({ ...doc, warning: `OCR 中转请求中：第 ${index + 1} / ${pages.length} 页` }));
          const result = await apiVision({ image: pages[index] }, sessionToken);
          if (result.text) texts.push(result.text);
        }
        text = texts.join('\n\n').trim();
        if (!text) throw new Error('OCR 未返回可用文本。');
      } else if (parsed.warning) {
        setInterpretDoc({ ...emptyDoc, fileName: file.name, warning: parsed.warning, loading: false });
        return;
      }
      const split = splitArticles(text);
      setInterpretDoc({ fileName: file.name, text, preface: split.preface, articles: split.articles, warning: null, loading: false });
      setDraftReport(null);
      setConfirmedReport(null);
      setReportProgress({ stage: 'idle', message: '文件已读取，请选择模板后生成解读。', done: 0, total: 0 });
      setInterpretStage('upload');
    } catch (error) {
      setInterpretDoc((doc) => ({
        ...doc,
        loading: false,
        warning: error instanceof Error ? error.message : '文件解析失败，请检查文件格式。'
      }));
    }
  }

  function initializeCompareGrid(nextRows: AlignRow[]) {
    setLeftBoxes(nextRows.map((row) => boxFromArticle(row.left, row.moved)));
    setRightBoxes(nextRows.map((row) => boxFromArticle(row.right, row.moved)));
    setDiffsByIndex([]);
    setSelectedBox(null);
    setStage('adjust');
  }

  function loadSample() {
    const left = splitArticles(SAMPLE_LEFT);
    const right = splitArticles(SAMPLE_RIGHT);
    setLeftDoc(sampleDoc('征求意见稿示例.docx', left));
    setRightDoc(sampleDoc('正式稿示例.docx', right));
    initializeCompareGrid(alignArticles(left.articles, right.articles));
  }

  function updateBox(side: Side, index: number, value: string) {
    updateBoxes(side, (boxes) => boxes.map((box, boxIndex) => (boxIndex === index ? { ...box, article: articleFromBoxText(value, box.article) } : box)));
  }

  function insertEmptyBox(position: 'above' | 'below', target = selectedBox) {
    if (!target) return;
    updateBoxes(target.side, (boxes) => {
      const next = [...boxes];
      next.splice(target.index + (position === 'below' ? 1 : 0), 0, emptyGridBox());
      return next;
    });
    setSelectedBox({ side: target.side, index: target.index + (position === 'below' ? 1 : 0) });
  }

  function deleteSelectedBox(target = selectedBox) {
    if (!target) return;
    updateBoxes(target.side, (boxes) => boxes.filter((_, index) => index !== target.index));
    setSelectedBox(null);
  }

  function moveBox(side: Side, from: number, to: number) {
    if (from === to) return;
    updateBoxes(side, (boxes) => {
      const next = [...boxes];
      const [item] = next.splice(from, 1);
      if (!item) return boxes;
      next.splice(to, 0, item);
      return next;
    });
    setSelectedBox({ side, index: to });
  }

  function updateBoxes(side: Side, updater: (boxes: GridBox[]) => GridBox[]) {
    if (side === 'left') setLeftBoxes((current) => updater(current));
    else setRightBoxes((current) => updater(current));
  }

  function confirmCompare() {
    const nextRows = rowsFromBoxes(leftBoxes, rightBoxes);
    setDiffsByIndex(recomputeDiffs(nextRows));
    setSelectedBox(null);
    setStage('result');
  }

  function realignCurrentBoxes() {
    const confirmed = window.confirm('重新自动对齐会覆盖当前手动调整，是否继续？');
    if (!confirmed) return;
    const leftArticles = leftBoxes.map((box) => normalizeBoxArticle(box)).filter((article): article is Article => Boolean(article));
    const rightArticles = rightBoxes.map((box) => normalizeBoxArticle(box)).filter((article): article is Article => Boolean(article));
    initializeCompareGrid(alignArticles(leftArticles, rightArticles));
  }

  function loadInterpretSample() {
    const split = splitArticles(SAMPLE_RIGHT);
    setInterpretDoc(sampleDoc('国家网络安全事件报告管理办法示例.docx', split));
    setDraftReport(null);
    setConfirmedReport(null);
    setReportProgress({ stage: 'idle', message: '示例文本已载入，请选择模板后生成解读。', done: 0, total: 0 });
    setInterpretStage('upload');
  }

  async function generateInterpretReport() {
    const text = interpretDoc.text.trim();
    if (!text) return;
    setInterpretStage('generating');
    setDraftReport(null);
    setConfirmedReport(null);
    setReportProgress({ stage: 'extracting', message: '正在准备结构化抽取...', done: 0, total: 1 });
    try {
      const chunks = splitTextForModel(text);
      let report: InterpretationReport;
      if (chunks.length > 1) {
        const partialReports: InterpretationReport[] = [];
        setReportProgress({ stage: 'extracting', message: '文档较长，正在分段抽取结构化 JSON...', done: 0, total: chunks.length });
        for (let index = 0; index < chunks.length; index += 1) {
          partialReports.push(await extractStructuredJson(buildChunkStructuredPrompt(template, chunks[index], index, chunks.length)));
          setReportProgress({ stage: 'extracting', message: '文档较长，正在分段抽取结构化 JSON...', done: index + 1, total: chunks.length });
        }
        setReportProgress({ stage: 'merging', message: '正在合并分段 JSON...', done: chunks.length, total: chunks.length });
        report = mergeReports(partialReports);
      } else {
        report = await extractStructuredJson(buildStructuredPrompt(template, text));
      }
      setDraftReport(report);
      setReportProgress({ stage: 'review', message: '结构化 JSON 已生成，请人工核查。', done: 1, total: 1 });
      setInterpretStage('review');
    } catch (error) {
      setReportProgress({
        stage: 'error',
        message: error instanceof Error ? error.message : '结构化抽取失败，请稍后重试。',
        done: 0,
        total: 0
      });
      setInterpretStage('upload');
    }
  }

  async function extractStructuredJson(prompt: string): Promise<InterpretationReport> {
    const call = async (content: string) => {
      const result = await apiText({ messages: [{ role: 'user', content }], temperature: 0.1 }, sessionToken);
      return parseInterpretationJson(extractMessageContent(result));
    };
    const retryPrompt = `${prompt}\n\n上次输出不符合要求。请严格只返回一个 JSON 对象，且必须使用给定的板块字段结构（标题/速览/出台背景与意义/适用范围与义务主体/框架结构/核心要点解读/重点义务清单/关键时间节点与行动清单/新旧变化/法律责任与罚则/参考案例/合规建议），不要 markdown 围栏，不要解释。`;
    try {
      const first = await call(prompt);
      // 合法 JSON 但结构跑偏/几乎为空 → 用强约束重试一次，保留较优结果，避免静默白板。
      if (!isReportEmpty(first)) return first;
      const second = await call(retryPrompt);
      return isReportEmpty(second) ? first : second;
    } catch {
      return call(retryPrompt);
    }
  }

  function confirmInterpretReport(nextReport: InterpretationReport) {
    const normalized = normalizeReport(nextReport);
    setDraftReport(normalized);
    setConfirmedReport(normalized);
    setReportProgress({ stage: 'done', message: '报告已确认。', done: 1, total: 1 });
    setInterpretStage('result');
  }

  return (
    <main className="app-shell">
      <WorkbenchHeader
        mode={mode}
        showAdmin={showAdmin}
        stepIndicator={
          !showAdmin && mode === 'compare' && stage !== 'upload' ? (
            <CompareStepIndicator current={stage === 'result' ? 'result' : 'adjust'} />
          ) : !showAdmin && mode === 'interpret' ? (
            <InterpretStepIndicator current={interpretStage} />
          ) : null
        }
        accountControl={accountControl}
        onHome={() => {
          navigateTo('home');
        }}
        onModeChange={(nextMode) => {
          navigateTo(nextMode);
        }}
      />

      {showAdmin && session.role === 'admin' ? (
        <AdminPage token={session.token} />
      ) : mode === 'interpret' ? (
        <InterpretationWorkspace
          token={sessionToken}
          doc={interpretDoc}
          stage={interpretStage}
          template={template}
          templates={templates}
          draftReport={draftReport}
          confirmedReport={confirmedReport}
          progress={reportProgress}
          onFile={handleInterpretFile}
          onLoadSample={loadInterpretSample}
          onTemplateChange={setTemplate}
          onGenerateReport={generateInterpretReport}
          onDraftReportChange={setDraftReport}
          onConfirmReport={confirmInterpretReport}
          onBackToSettings={() => setInterpretStage('upload')}
          onBackToReview={() => {
            if (confirmedReport) setDraftReport(confirmedReport);
            setInterpretStage('review');
          }}
          onSaveTemplate={async (nextTemplate) => {
            const result = await saveTemplate(sessionToken, nextTemplate);
            setTemplates(mergeTemplates(result.templates));
            setTemplate(mergeTemplates(result.templates).find((item) => item.id === nextTemplate.id) ?? nextTemplate);
          }}
          onDeleteTemplate={async (id, author) => {
            const result = await deleteTemplate(sessionToken, id, author);
            const next = mergeTemplates(result.templates);
            setTemplates(next);
            if (template.id === id) setTemplate(next[0] ?? defaultTemplate);
          }}
          onTemplatesChange={(nextTemplates) => setTemplates(mergeTemplates(nextTemplates))}
          sessionRole={session.role}
        />
      ) : (
        <>

      {stage === 'upload' && (
        <>
          <section className="actionbar">
            <button className="ghost" onClick={loadSample}>
              载入示例文本
            </button>
          </section>
          <section className="workspace">
            <UploadPanel side="left" title="征求意见稿" doc={leftDoc} onFile={handleFile} />
            <UploadPanel side="right" title="正式稿" doc={rightDoc} onFile={handleFile} />
          </section>
        </>
      )}

      {stage === 'adjust' && (
        <section className="compare-adjust-page" onClick={() => setSelectedBox(null)}>
          <section className="compare-adjust-intro">
            <p>核对自动切分与对齐，可编辑、插删、拖动；满意后生成对比。</p>
            <div className="compare-adjust-actions">
              <button className="ghost pill-ghost" onClick={() => setStage('upload')}>返回上传</button>
            </div>
            <div className="compare-column-labels">
              <span>征求意见稿</span>
              <span>正式稿</span>
            </div>
          </section>
          <AlignmentGrid
            mode="adjust"
            rows={rows}
            allRows={rows}
            rowDiffs={rowDiffs}
            selected={selectedBox}
            dragBox={dragBox}
            onSelect={setSelectedBox}
            onTextChange={updateBox}
            onInsertBox={(side, index, position) => {
              insertEmptyBox(position, { side, index });
            }}
            onDeleteBox={(side, index) => {
              deleteSelectedBox({ side, index });
            }}
            onDragStart={setDragBox}
            onDropBox={(side, index) => {
              if (dragBox?.side === side) moveBox(side, dragBox.index, index);
              setDragBox(null);
            }}
          />
          <section className="compare-confirm-bar">
            <button className="ghost pill-ghost" onClick={realignCurrentBoxes}>重新自动对齐</button>
            <button className="primary compare-main-cta" onClick={confirmCompare}>
              确定，生成对比
              <ChevronRight size={16} />
            </button>
          </section>
        </section>
      )}

      {stage === 'result' && (
        <>
          <section className="compare-result-summary">
            <div className="summary result-summary">
              <button className={resultFilter === 'inserted' ? 'active' : ''} onClick={() => setResultFilter((current) => (current === 'inserted' ? null : 'inserted'))}>新增 {summary.inserted}</button>
              <button className={resultFilter === 'deleted' ? 'active' : ''} onClick={() => setResultFilter((current) => (current === 'deleted' ? null : 'deleted'))}>删除 {summary.deleted}</button>
              <button className={resultFilter === 'modified' ? 'active' : ''} onClick={() => setResultFilter((current) => (current === 'modified' ? null : 'modified'))}>修改 {summary.modified}</button>
              <button className={!resultFilter ? 'active-muted' : ''} onClick={() => setResultFilter(null)}>全部 {rows.length}</button>
            </div>
            <label className="toggle result-toggle">
              <input type="checkbox" checked={showChangedOnly} onChange={(event) => setShowChangedOnly(event.target.checked)} />
              只看有改动的
            </label>
          </section>
          <AlignmentGrid
            mode="result"
            rows={visibleResultRows}
            allRows={rows}
            rowDiffs={rowDiffs}
            selected={selectedBox}
            dragBox={dragBox}
            onSelect={setSelectedBox}
            onTextChange={updateBox}
            onInsertBox={() => undefined}
            onDeleteBox={() => undefined}
            onDragStart={setDragBox}
            onDropBox={(side, index) => {
              if (dragBox?.side === side) moveBox(side, dragBox.index, index);
              setDragBox(null);
            }}
          />
          <section className="compare-confirm-bar result-action-bar">
            <button className="ghost pill-ghost" onClick={() => setStage('adjust')}>← 返回上一步</button>
            <button
              className="ghost pill-ghost"
              onClick={() =>
                void exportCompareExcel(rows, rowDiffs, {
                  leftTitle: '征求稿标题',
                  rightTitle: '正式稿标题',
                  leftFileName: leftDoc.fileName,
                  rightFileName: rightDoc.fileName
                })
              }
            >
              <FileSpreadsheet size={16} />
              导出 Excel
            </button>
            <button className="ghost pill-ghost" onClick={() => window.print()}>
              <Printer size={16} />
              打印 PDF
            </button>
          </section>
        </>
      )}
        </>
      )}
    </main>
  );
}

function CompareStepIndicator({ current }: { current: 'adjust' | 'result' }) {
  return (
    <div className="compare-step-indicator" aria-label="对比步骤">
      <span className={current === 'adjust' ? 'current' : ''}>① 核对与调整</span>
      <span className="dash">——</span>
      <span className={current === 'result' ? 'current' : ''}>② 对比</span>
    </div>
  );
}

function InterpretStepIndicator({ current }: { current: InterpretStage }) {
  const active = current === 'result' ? 'report' : current === 'review' ? 'review' : current === 'generating' ? 'template' : 'upload';
  return (
    <div className="compare-step-indicator interpret-step-indicator" aria-label="解读步骤">
      <span className={active === 'upload' ? 'current' : ''}>上传</span>
      <span className="dash">→</span>
      <span className={active === 'template' ? 'current' : ''}>选模板</span>
      <span className="dash">→</span>
      <span className={active === 'review' ? 'current' : ''}>③ 校对</span>
      <span className="dash">→</span>
      <span className={active === 'report' ? 'current' : ''}>④ 报告</span>
    </div>
  );
}

function UploadPanel({
  side,
  title,
  doc,
  onFile
}: {
  side: Side;
  title: string;
  doc: DocState;
  onFile: (side: Side, file: File) => void;
}) {
  return (
    <section className="upload-card">
      <div className="upload-heading">
        <FileText size={22} />
        <div>
          <h2>{title}</h2>
          <p>支持 .docx / 带文字层 PDF</p>
        </div>
      </div>
      <label className="dropzone">
        <UploadCloud size={42} />
        <span>{doc.loading ? '正在解析...' : '点击选择文件'}</span>
        <small>{doc.fileName || '文件仅在浏览器本地解析，不上传服务器'}</small>
        <input
          type="file"
          accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onFile(side, file);
          }}
        />
      </label>
      {doc.warning && <p className="warning">{doc.warning}</p>}
      {!!doc.articles.length && <p className="success">已识别 {doc.articles.length} 条条文，上传两份后会自动进入对齐网格。</p>}
    </section>
  );
}

function InterpretationWorkspace({
  token,
  sessionRole,
  doc,
  stage,
  template,
  templates,
  draftReport,
  confirmedReport,
  progress,
  onFile,
  onLoadSample,
  onTemplateChange,
  onGenerateReport,
  onDraftReportChange,
  onConfirmReport,
  onBackToSettings,
  onBackToReview,
  onSaveTemplate,
  onDeleteTemplate,
  onTemplatesChange
}: {
  token: string;
  sessionRole: Role;
  doc: DocState;
  stage: InterpretStage;
  template: Template;
  templates: Template[];
  draftReport: InterpretationReport | null;
  confirmedReport: InterpretationReport | null;
  progress: ReportProgress;
  onFile: (file: File) => void;
  onLoadSample: () => void;
  onTemplateChange: (template: Template) => void;
  onGenerateReport: () => Promise<void>;
  onDraftReportChange: (report: InterpretationReport | null) => void;
  onConfirmReport: (report: InterpretationReport) => void;
  onBackToSettings: () => void;
  onBackToReview: () => void;
  onSaveTemplate: (template: Template) => Promise<void>;
  onDeleteTemplate: (id: string, author: string) => Promise<void>;
  onTemplatesChange: (templates: Template[]) => void;
}) {
  const [view, setView] = useState<'report' | 'templates' | 'guide'>('report');
  const showLocalToolbar = !(view === 'report' && stage === 'review');

  return (
    <section className="interpret-workspace">
      {showLocalToolbar && (
        <div className="result-toolbar">
          <div className="segmented view-tabs">
            <button className={view === 'report' ? 'selected' : ''} onClick={() => setView('report')}>生成报告</button>
            <button className={view === 'templates' ? 'selected' : ''} onClick={() => setView('templates')}>模板管理</button>
            <button className={view === 'guide' ? 'selected' : ''} onClick={() => setView('guide')}>制作模板教程</button>
          </div>
          {view === 'report' && (
            <>
              <button
                className="ghost"
                onClick={() => void navigator.clipboard.writeText(JSON.stringify(confirmedReport ?? draftReport ?? emptyReport(), null, 2))}
                disabled={!draftReport && !confirmedReport}
              >
                <Clipboard size={16} />
                复制 JSON
              </button>
              <button
                className="ghost"
                onClick={() => void exportInterpretationDocx(confirmedReport ?? draftReport ?? emptyReport(), `${doc.fileName || '法规解读报告'}-解读报告.docx`)}
                disabled={!confirmedReport && stage !== 'result'}
              >
                <Download size={16} />
                导出 Word
              </button>
              <button className="primary" onClick={() => window.print()} disabled={!confirmedReport}>
                <Printer size={16} />
                打印 / 存为 PDF
              </button>
            </>
          )}
        </div>
      )}

      {view === 'report' && (
        <ReportGenerator
          doc={doc}
          stage={stage}
          template={template}
          templates={templates}
          draftReport={draftReport}
          confirmedReport={confirmedReport}
          progress={progress}
          onFile={onFile}
          onLoadSample={onLoadSample}
          onTemplateChange={onTemplateChange}
          onGenerateReport={onGenerateReport}
          onDraftReportChange={onDraftReportChange}
          onConfirmReport={onConfirmReport}
          onBackToSettings={onBackToSettings}
          onBackToReview={onBackToReview}
        />
      )}
      {view === 'templates' && (
        <TemplateManager
          templates={templates}
          currentTemplate={template}
          token={token}
          sessionRole={sessionRole}
          onTemplateChange={onTemplateChange}
          onSaveTemplate={onSaveTemplate}
          onDeleteTemplate={onDeleteTemplate}
          onTemplatesChange={onTemplatesChange}
        />
      )}
      {view === 'guide' && <TemplateGuide />}
    </section>
  );
}

function ReportGenerator({
  doc,
  stage,
  template,
  templates,
  draftReport,
  confirmedReport,
  progress,
  onFile,
  onLoadSample,
  onTemplateChange,
  onGenerateReport,
  onDraftReportChange,
  onConfirmReport,
  onBackToSettings,
  onBackToReview
}: {
  doc: DocState;
  stage: InterpretStage;
  template: Template;
  templates: Template[];
  draftReport: InterpretationReport | null;
  confirmedReport: InterpretationReport | null;
  progress: ReportProgress;
  onFile: (file: File) => void;
  onLoadSample: () => void;
  onTemplateChange: (template: Template) => void;
  onGenerateReport: () => Promise<void>;
  onDraftReportChange: (report: InterpretationReport | null) => void;
  onConfirmReport: (report: InterpretationReport) => void;
  onBackToSettings: () => void;
  onBackToReview: () => void;
}) {
  const isGenerating = stage === 'generating';
  if (stage === 'review' && draftReport) {
    return (
      <ReviewEditor
        report={draftReport}
        docName={doc.fileName}
        templateName={template.name}
        onChange={onDraftReportChange}
        onBack={() => {
          onDraftReportChange(null);
          onBackToSettings();
        }}
        onRegenerate={() => void onGenerateReport()}
        onConfirm={() => onConfirmReport(draftReport)}
      />
    );
  }
  if (stage === 'result' && confirmedReport) {
    return <StructuredReportView report={confirmedReport} onBackToReview={onBackToReview} />;
  }
  return (
    <>
      <section className="report-setup">
        <section className="upload-card">
          <div className="upload-heading">
            <FileText size={22} />
            <div>
              <h2>上传单份法规/标准</h2>
              <p>支持 docx、文字层 PDF；扫描件 PDF 会走 Worker OCR。</p>
            </div>
          </div>
          <label className="dropzone">
            <UploadCloud size={42} />
            <span>{doc.loading ? '正在解析...' : '点击选择文件'}</span>
            <small>{doc.fileName || '全文会在浏览器内提取，再经 Worker 调用 MiniMax 生成报告'}</small>
            <input
              type="file"
              accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onFile(file);
              }}
            />
          </label>
          <div className="upload-actions">
            <button className="ghost" onClick={onLoadSample}>载入示例文本</button>
            {doc.text && <span>{doc.text.length.toLocaleString()} 字 · 已识别 {doc.articles.length} 条</span>}
          </div>
          {doc.warning && <p className="warning">{doc.warning}</p>}
        </section>

        <section className="template-picker-card">
          <div className="upload-heading">
            <BookOpen size={22} />
            <div>
              <h2>选择解读模板</h2>
              <p>{template.description || '模板决定报告结构、写作口径和详略。'}</p>
            </div>
          </div>
          <label className="field">
            <span>模板</span>
            <select
              value={template.id}
              onChange={(event) => {
                const next = templates.find((item) => item.id === event.target.value);
                if (next) onTemplateChange(next);
              }}
            >
              {templates.map((item) => (
                <option value={item.id} key={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
          <div className="template-meta">
            <span>适用范围：{template.scope || '未填写'}</span>
            {template.builtin && <span>内置模板</span>}
          </div>
          <button className="primary block-save" onClick={() => void onGenerateReport()} disabled={!doc.text || isGenerating}>
            {isGenerating ? '抽取中...' : '生成结构化 JSON'}
          </button>
          {progress.message && (
            <div className={`progress-card ${progress.stage === 'error' ? 'error' : ''}`}>
              <strong>{progress.message}</strong>
              {progress.total > 1 && <span>{progress.done} / {progress.total}</span>}
            </div>
          )}
        </section>
      </section>

      {isGenerating ? (
        <section className="empty-report">
          <h2>正在抽取结构化 JSON</h2>
          <p>AI 输出会先进入人工核查页，确认后才渲染 HTML 和 Word。</p>
        </section>
      ) : (
        <section className="empty-report">
          <h2>结构化法规解读</h2>
          <p>上传文件并选择模板后，点击“生成结构化 JSON”。核查修改后可生成 HTML 页面并导出 Word。</p>
        </section>
      )}
    </>
  );
}

const REVIEW_SECTIONS: Array<{ key: keyof InterpretationReport; title: string; hint: string }> = [
  { key: '速览', title: '速览', hint: '发布机关、日期、文号、效力层级、章条规模、核心数字。' },
  { key: '出台背景与意义', title: '出台背景与意义', hint: '核对背景表述是否区分文档原文与 AI 补充。' },
  { key: '适用范围与义务主体', title: '适用范围与义务主体', hint: '确认适用对象、主体分级和定位是否准确。' },
  { key: '框架结构', title: '框架结构', hint: '法规结构、章节逻辑和条文骨架。' },
  { key: '核心要点解读', title: '核心要点解读', hint: '每个要点应包含条款、解读和影响。' },
  { key: '重点义务清单', title: '重点义务清单', hint: '主体、义务和条款出处逐项核对。' },
  { key: '关键时间节点与行动清单', title: '关键时间节点与行动清单', hint: '时间节点、依据和截止要求。' },
  { key: '新旧变化', title: '新旧变化', hint: '新增、删除、修改及对应条款。' },
  { key: '法律责任与罚则', title: '法律责任与罚则', hint: '违法情形、处罚和条款出处。' },
  { key: '参考案例', title: '参考案例', hint: 'AI 补充内容必须人工核实。' },
  { key: '合规建议', title: '合规建议', hint: '输出可执行、可检查的建议。' }
];

function ReviewEditor({
  report,
  docName,
  templateName,
  onChange,
  onBack,
  onRegenerate,
  onConfirm
}: {
  report: InterpretationReport;
  docName: string;
  templateName: string;
  onChange: (report: InterpretationReport) => void;
  onBack: () => void;
  onRegenerate: () => void;
  onConfirm: () => void;
}) {
  const [activeSection, setActiveSection] = useState<string>(String(REVIEW_SECTIONS[0].key));
  const [verifiedAiPaths, setVerifiedAiPaths] = useState<Set<string>>(() => new Set());
  const editableReport = report;
  const aiSupplementPaths = useMemo(() => collectAiSupplementPaths(editableReport), [editableReport]);
  const pendingAiCount = aiSupplementPaths.filter((path) => !verifiedAiPaths.has(path)).length;
  const verifiedAiCount = aiSupplementPaths.length - pendingAiCount;
  const canConfirm = pendingAiCount === 0;
  const markAllAiVerified = () => {
    setVerifiedAiPaths(new Set(aiSupplementPaths));
  };

  useEffect(() => {
    const nodes = REVIEW_SECTIONS.map((section) => document.getElementById(reviewSectionId(section.key))).filter((node): node is HTMLElement => Boolean(node));
    if (!nodes.length) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top))[0];
        if (visible?.target.id) setActiveSection(visible.target.id.replace('review-', ''));
      },
      { rootMargin: '-18% 0px -65% 0px', threshold: [0, 0.2, 0.6] }
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setVerifiedAiPaths((current) => {
      const valid = new Set(aiSupplementPaths);
      const next = new Set([...current].filter((path) => valid.has(path)));
      return next.size === current.size ? current : next;
    });
  }, [aiSupplementPaths]);

  const updateSection = (key: keyof InterpretationReport, value: unknown) => {
    onChange(normalizeReport({ ...editableReport, [key]: value }));
  };

  const regenerate = () => {
    if (window.confirm('重新解读会覆盖当前校对编辑内容，是否继续？')) onRegenerate();
  };
  const changeTemplate = () => {
    if (window.confirm('返回模板选择会放弃当前校对编辑内容，是否继续？')) onBack();
  };

  return (
    <section className="review-editor">
      <header className="review-meta">
        <div>
          <h2>{editableReport.标题 || '法规解读校对'}</h2>
          <p>
            {docName || '未命名文档'} · 所用模板
            <button className="template-inline-link" onClick={changeTemplate}>「{templateName || '法规通用解读'}」</button>
          </p>
        </div>
        <div className="review-check-progress">
          <span>待核对 {pendingAiCount} 项 / 已核对 {verifiedAiCount} 项</span>
          {!!aiSupplementPaths.length && <AiBadge />}
          {pendingAiCount > 0 && (
            <button className="ai-verify-all-button" type="button" onClick={markAllAiVerified}>
              全部标记已核对
            </button>
          )}
        </div>
      </header>

      <div className="review-layout">
        <aside className="review-toc" aria-label="校对目录">
          {REVIEW_SECTIONS.map((section, index) => (
            <button
              key={section.key}
              className={activeSection === String(section.key) ? 'active' : ''}
              onClick={() => document.getElementById(reviewSectionId(section.key))?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              <span>{String(index + 1).padStart(2, '0')}</span>
              {section.title}
            </button>
          ))}
        </aside>
        <div className="review-main">
          <section className="review-section-card title-card" id="review-title">
            <div className="review-card-head">
              <div>
                <h3>报告标题</h3>
                <p>用于最终 HTML 与 Word 报告的标题。</p>
              </div>
            </div>
            <JsonEditor value={editableReport.标题} label="标题" onChange={(value) => updateSection('标题', value)} />
          </section>
          {REVIEW_SECTIONS.map((section, index) => {
            const value = editableReport[section.key];
            const supplemented = isAiSupplement(value);
            return (
              <section
                className={`review-section-card ${supplemented ? 'ai-supplement' : ''} ${isEmptyReviewValue(value) ? 'empty-review-section' : ''}`}
                id={reviewSectionId(section.key)}
                key={section.key}
                style={{ ['--row-stagger' as string]: `${Math.min(index, 14) * 30}ms` }}
              >
                <div className="review-card-head">
                  <div>
                    <h3>{section.title}</h3>
                    <p>{section.hint}</p>
                  </div>
                  {supplemented && <AiBadge />}
                </div>
                {isEmptyReviewValue(value) && <p className="empty-section-note">（无内容，可补充）</p>}
                <JsonEditor
                  value={value}
                  label={String(section.key)}
                  path={String(section.key)}
                  verifiedAiPaths={verifiedAiPaths}
                  onVerifyAiPath={(path) =>
                    setVerifiedAiPaths((current) => {
                      const next = new Set(current);
                      const relatedPaths = relatedAiSupplementPaths(path, aiSupplementPaths);
                      if (next.has(path)) relatedPaths.forEach((item) => next.delete(item));
                      else relatedPaths.forEach((item) => next.add(item));
                      return next;
                    })
                  }
                  onChange={(next) => updateSection(section.key, next)}
                />
              </section>
            );
          })}
        </div>
      </div>
      <section className="compare-confirm-bar review-action-bar">
        <button className="ghost pill-ghost" onClick={onBack}>返回</button>
        <button className="ghost pill-ghost" onClick={regenerate}>重新解读</button>
        <button className="primary compare-main-cta" onClick={onConfirm} disabled={!canConfirm} title={!canConfirm ? '请先逐项核对所有 AI 补充内容' : undefined}>
          确认，生成报告
          <ChevronRight size={16} />
        </button>
      </section>
    </section>
  );
}

function AiBadge() {
  return <span className="ai-review-badge">AI补充·需核实</span>;
}

function reviewSectionId(key: keyof InterpretationReport) {
  return `review-${String(key)}`;
}

function isEmptyReviewValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return !value.trim();
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).every(isEmptyReviewValue);
  return false;
}

function collectAiSupplementPaths(value: unknown, path = 'root'): string[] {
  const paths: string[] = [];
  if (!value || typeof value !== 'object') return paths;
  if (isDirectAiSupplement(value)) paths.push(path);
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      paths.push(...collectAiSupplementPaths(item, `${path}.${index}`));
    });
    return paths;
  }
  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
    paths.push(...collectAiSupplementPaths(item, `${path}.${key}`));
  });
  return [...new Set(paths)];
}

function relatedAiSupplementPaths(path: string, aiSupplementPaths: string[]): string[] {
  return aiSupplementPaths.filter((item) => item === path || item.startsWith(`${path}.`) || path.startsWith(`${item}.`));
}

function isDirectAiSupplement(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).some((item) => typeof item === 'string' && item.includes('AI补充'));
}

function AiVerificationControl({
  path,
  verified,
  onToggle
}: {
  path: string;
  verified: boolean;
  onToggle: (path: string) => void;
}) {
  return (
    <button className={`ai-verify-button ${verified ? 'verified' : ''}`} type="button" onClick={() => onToggle(path)}>
      {verified ? '已核对' : '确认已核对'}
    </button>
  );
}

function StructuredReportView({
  report,
  onBackToReview
}: {
  report: InterpretationReport;
  onBackToReview: () => void;
}) {
  const countdown = effectiveDateCountdown(report.速览.施行日期);
  const timeline = [...report.关键时间节点与行动清单].sort((a, b) => urgencyScore(a.截止) - urgencyScore(b.截止));
  const obligationsBySubject = groupBySubject(report.重点义务清单);
  useEffect(() => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>('.reveal-card'));
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view');
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.12 }
    );
    cards.forEach((card, index) => {
      card.style.setProperty('--row-stagger', `${Math.min(index, 12) * 55}ms`);
      observer.observe(card);
    });
    return () => observer.disconnect();
  }, []);
  return (
    <section className="structured-report infographic-report">
      <article className="report-page infographic-page">
        <header className="report-hero infographic-hero reveal-card">
          <span className="report-brand-mark">明文 · 法规解读</span>
          <h1>{report.标题 || '法规解读报告'}</h1>
          <p>基于结构化 JSON 校对结果生成，供合规团队阅读、打印与归档。</p>
        </header>

        <section className="infographic-overview reveal-card">
          <article className="countdown-card">
            <span>距施行</span>
            <strong>{countdown?.replace(/^距施行还有\s*/, '').replace(/^已施行\s*/, '已施行 ') || '未明确'}</strong>
            <em>{report.速览.施行日期 || '施行日期未明确'}</em>
          </article>
          {overviewInfoItem('发布机关', report.速览.发布机关)}
          {overviewInfoItem('发布日期', report.速览.发布日期)}
          {overviewInfoItem('文号', report.速览.文号)}
          {overviewInfoItem('效力层级', report.速览.效力层级)}
          {overviewInfoItem('章条规模', report.速览.章条规模)}
          {!!report.速览.核心数字.length &&
            report.速览.核心数字.map((item, index) => overviewInfoItem(item.标签 || `核心数字 ${index + 1}`, item.值, 'metric'))}
          {!!report.速览.上位法依据.length && overviewInfoItem('上位法依据', report.速览.上位法依据.join(' / '))}
        </section>

        {report.出台背景与意义?.正文 && <InfographicTextSection title="出台背景与意义" text={report.出台背景与意义.正文} source={report.出台背景与意义.来源} />}
        {report.适用范围与义务主体 && (
          <section className="report-section infographic-section reveal-card">
            <SectionTitle index="01" title="适用范围与义务主体" />
            {report.适用范围与义务主体.适用范围 && <p className="section-lead">{report.适用范围与义务主体.适用范围}</p>}
            {!!report.适用范围与义务主体.义务主体.length && (
              <div className="subject-grid infographic-subjects">
                {report.适用范围与义务主体.义务主体.map((item, index) => (
                  <article key={index}>
                    <strong>{item.主体}</strong>
                    {item.影响等级 && <span className={`impact-badge level-${item.影响等级}`}>{item.影响等级}</span>}
                    <p>{item.定位}</p>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
        {report.框架结构 && <InfographicTextSection index="02" title="框架结构" text={report.框架结构} />}
        <InsightCards index="03" title="核心要点解读" rows={report.核心要点解读} />
        {!!report.重点义务清单.length && (
          <section className="report-section infographic-section reveal-card">
            <SectionTitle index="04" title="重点义务清单" />
            <div className="obligation-groups">
              {Object.entries(obligationsBySubject).map(([subject, items]) => (
                <article key={subject}>
                  <h3>{subject}</h3>
                  {items.map((item, index) => (
                    <p key={index}><span>{item.条款出处 || '条款未明'}</span>{item.义务}</p>
                  ))}
                </article>
              ))}
            </div>
          </section>
        )}
        {!!timeline.length && (
          <section className="report-section infographic-section reveal-card">
            <SectionTitle index="05" title="关键时间节点与行动清单" />
            <div className="report-timeline">
              {timeline.map((item, index) => (
                <article key={index}>
                  <strong>{item.截止 || '期限未明确'}</strong>
                  <h3>{item.事项}</h3>
                  <span>{item.依据}</span>
                </article>
              ))}
            </div>
          </section>
        )}
        <InfographicList index="06" title="新旧变化" rows={report.新旧变化} fields={['类型', '说明', '条款']} variant="changes" />
        <InfographicList index="07" title="法律责任与罚则" rows={report.法律责任与罚则} fields={['情形', '处罚', '条款']} variant="penalty" />
        <InfographicList index="08" title="参考案例" rows={report.参考案例} fields={['案例', '触犯条款', '结果']} variant="cases" />
        {!!report.合规建议.length && (
          <section className="report-section infographic-section reveal-card">
            <SectionTitle index="09" title="合规建议" />
            <ol className="advice-list">{report.合规建议.map((item, index) => <li key={index}>{item}</li>)}</ol>
          </section>
        )}
      </article>
      <section className="compare-confirm-bar result-action-bar report-action-bar">
        <button className="ghost pill-ghost" onClick={onBackToReview}>← 返回</button>
        <button className="ghost pill-ghost" onClick={() => void exportInterpretationDocx(report, `${report.标题 || '法规解读报告'}.docx`)}>
          <Download size={16} />
          导出 Word
        </button>
        <button className="ghost pill-ghost" onClick={() => window.print()}>
          <Printer size={16} />
          打印 PDF
        </button>
      </section>
    </section>
  );
}

function JsonEditor({
  value,
  onChange,
  label,
  path = label ?? 'root',
  verifiedAiPaths,
  onVerifyAiPath
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  label?: string;
  path?: string;
  verifiedAiPaths?: Set<string>;
  onVerifyAiPath?: (path: string) => void;
}) {
  if (Array.isArray(value)) {
    return (
      <section className="json-node array-node">
        {label && <h3>{label}</h3>}
        {value.map((item, index) => (
          <div className={`array-item ${isAiSupplement(item) ? 'ai-supplement' : ''}`} key={index}>
            <div className="array-item-head">
              <strong>第 {index + 1} 项</strong>
              <button className="danger-link" onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}>删除</button>
            </div>
            <JsonEditor
              label={label}
              path={`${path}.${index}`}
              verifiedAiPaths={verifiedAiPaths}
              onVerifyAiPath={onVerifyAiPath}
              value={item}
              onChange={(next) => onChange(value.map((current, itemIndex) => (itemIndex === index ? next : current)))}
            />
          </div>
        ))}
        <button className="ghost" onClick={() => onChange([...value, emptyValueForArray(value, label)])}>新增一项</button>
      </section>
    );
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const needsVerification = isDirectAiSupplement(value);
    return (
      <section className={`json-node object-node ${isAiSupplement(value) ? 'ai-supplement' : ''}`}>
        {(label || needsVerification) && (
          <div className="object-node-head">
            {label && <h3>{label}</h3>}
            {needsVerification && verifiedAiPaths && onVerifyAiPath && (
              <AiVerificationControl path={path} verified={verifiedAiPaths.has(path)} onToggle={onVerifyAiPath} />
            )}
          </div>
        )}
        {entries.map(([key, item]) => (
          <label className="json-field" key={key}>
            <span>{key}</span>
            <JsonEditor
              label={key}
              path={`${path}.${key}`}
              verifiedAiPaths={verifiedAiPaths}
              onVerifyAiPath={onVerifyAiPath}
              value={item}
              onChange={(next) => onChange({ ...(value as Record<string, unknown>), [key]: next })}
            />
          </label>
        ))}
      </section>
    );
  }
  return (
    <textarea
      className="json-scalar"
      value={value == null ? '' : String(value)}
      placeholder="空"
      onChange={(event) => onChange(event.target.value.trim() ? event.target.value : null)}
    />
  );
}

function TextSection({ title, text, source }: { title: string; text: string; source?: string | null }) {
  return (
    <section className="report-section">
      <h2>{title}</h2>
      {source && !source.includes('AI补充') && <span className="source-badge">{source}</span>}
      <p>{text}</p>
    </section>
  );
}

function CardList({ title, rows, fields }: { title: string; rows: object[]; fields: string[] }) {
  const visibleRows = rows.filter((row) => fields.some((field) => valueText((row as Record<string, unknown>)[field])));
  if (!visibleRows.length) return null;
  return (
    <section className="report-section">
      <h2>{title}</h2>
      <div className="report-card-list">
        {visibleRows.map((row, index) => (
          <article key={index}>
            {fields.map((field) => {
              const value = valueText((row as Record<string, unknown>)[field]);
              if (!value) return null;
              return (
                <div key={field}>
                  <span>{field}</span>
                  <p>{value}</p>
                </div>
              );
            })}
          </article>
        ))}
      </div>
    </section>
  );
}

function SectionTitle({ index, title }: { index: string; title: string }) {
  return (
    <div className="infographic-title">
      <span>{index}</span>
      <h2>{title}</h2>
    </div>
  );
}

function overviewInfoItem(label: string, value: string | null | undefined, variant?: 'metric') {
  if (!value) return null;
  return (
    <article className={variant === 'metric' ? 'metric-card' : ''}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function InfographicTextSection({ index = '00', title, text, source }: { index?: string; title: string; text: string; source?: string | null }) {
  if (!text) return null;
  return (
    <section className="report-section infographic-section reveal-card">
      <SectionTitle index={index} title={title} />
      <p className="section-lead">{text}</p>
    </section>
  );
}

function InsightCards({ index, title, rows }: { index: string; title: string; rows: InterpretationReport['核心要点解读'] }) {
  const visible = rows.filter((row) => valueText(row.标题) || valueText(row.解读) || valueText(row.影响));
  if (!visible.length) return null;
  return (
    <section className="report-section infographic-section reveal-card">
      <SectionTitle index={index} title={title} />
      <div className="insight-grid">
        {visible.map((row, itemIndex) => (
          <article key={itemIndex}>
            <span className="card-number">{String(itemIndex + 1).padStart(2, '0')}</span>
            {row.原条款 && <em>{row.原条款}</em>}
            <h3>{row.标题 || '核心要点'}</h3>
            {row.解读 && <p>{row.解读}</p>}
            {row.影响 && <strong>{row.影响}</strong>}
          </article>
        ))}
      </div>
    </section>
  );
}

function InfographicList({ index, title, rows, fields, variant }: { index: string; title: string; rows: object[]; fields: string[]; variant: 'changes' | 'penalty' | 'cases' }) {
  const visibleRows = rows.filter((row) => fields.some((field) => valueText((row as Record<string, unknown>)[field])));
  if (!visibleRows.length) return null;
  return (
    <section className={`report-section infographic-section reveal-card ${variant}`}>
      <SectionTitle index={index} title={title} />
      <div className="infographic-list">
        {visibleRows.map((row, rowIndex) => (
          <article key={rowIndex}>
            {fields.map((field) => {
              const value = valueText((row as Record<string, unknown>)[field]);
              if (!value) return null;
              return (
                <div key={field}>
                  <span>{field}</span>
                  <p>{value}</p>
                </div>
              );
            })}
          </article>
        ))}
      </div>
    </section>
  );
}

function groupBySubject(rows: InterpretationReport['重点义务清单']) {
  return rows.reduce<Record<string, InterpretationReport['重点义务清单']>>((acc, row) => {
    const subject = row.主体 || '未明确主体';
    acc[subject] = [...(acc[subject] ?? []), row];
    return acc;
  }, {});
}

function urgencyScore(value: string | null) {
  if (!value) return Number.POSITIVE_INFINITY;
  const hour = value.match(/(\d+)\s*小时/);
  if (hour) return Number(hour[1]) / 24;
  const day = value.match(/(\d+)\s*(?:日|天)/);
  if (day) return Number(day[1]);
  const date = parseDate(value);
  if (!date) return Number.POSITIVE_INFINITY;
  return date.getTime();
}

function overviewItem(label: string, value: string | null | undefined, extra?: string | null) {
  if (!value && !extra) return null;
  return (
    <article>
      <span>{label}</span>
      <strong>{value || '未明确'}</strong>
      {extra && <em>{extra}</em>}
    </article>
  );
}

function effectiveDateCountdown(value: string | null): string | null {
  if (!value) return null;
  const date = parseDate(value);
  if (!date) return null;
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((target - start) / 86_400_000);
  if (days > 0) return `距施行还有 ${days} 天`;
  if (days === 0) return '今日施行';
  return `已施行 ${Math.abs(days)} 天`;
}

function parseDate(value: string): Date | null {
  const normalized = value.trim();
  const chinese = normalized.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (chinese) return new Date(Number(chinese[1]), Number(chinese[2]) - 1, Number(chinese[3]));
  const iso = normalized.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  return null;
}

function emptyValueForArray(items: unknown[], label?: string): unknown {
  const sample = items.find((item) => item && typeof item === 'object');
  if (!sample || Array.isArray(sample)) return emptyValueByLabel(label);
  return Object.fromEntries(Object.keys(sample as Record<string, unknown>).map((key) => [key, null]));
}

function emptyValueByLabel(label?: string): unknown {
  switch (label) {
    case '上位法依据':
    case '合规建议':
      return '';
    case '核心数字':
      return { 标签: null, 值: null };
    case '义务主体':
      return { 主体: null, 影响等级: null, 定位: null };
    case '核心要点解读':
      return { 标题: null, 原条款: null, 解读: null, 影响: null };
    case '重点义务清单':
      return { 主体: null, 义务: null, 条款出处: null };
    case '关键时间节点与行动清单':
      return { 事项: null, 依据: null, 截止: null };
    case '新旧变化':
      return { 类型: null, 说明: null, 条款: null };
    case '法律责任与罚则':
      return { 情形: null, 处罚: null, 条款: null };
    case '参考案例':
      return { 案例: null, 触犯条款: null, 结果: null, 来源: 'AI补充·需核实' };
    default:
      return '';
  }
}

function valueText(value: unknown): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(valueText).filter(Boolean).join('；');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value).trim();
}

function TemplateManager({
  templates,
  currentTemplate,
  token,
  sessionRole,
  onTemplateChange,
  onSaveTemplate,
  onDeleteTemplate,
  onTemplatesChange
}: {
  templates: Template[];
  currentTemplate: Template;
  token: string;
  sessionRole: Role;
  onTemplateChange: (template: Template) => void;
  onSaveTemplate: (template: Template) => Promise<void>;
  onDeleteTemplate: (id: string, author: string) => Promise<void>;
  onTemplatesChange: (templates: Template[]) => void;
}) {
  const [draft, setDraft] = useState<Template>(() => templateDraft(currentTemplate));
  const [saving, setSaving] = useState(false);
  const [trash, setTrash] = useState<{ items: TemplateTrashItem[]; usage: TemplateTrashUsage } | null>(null);
  const [trashMessage, setTrashMessage] = useState('');

  useEffect(() => {
    setDraft(templateDraft(currentTemplate));
  }, [currentTemplate]);

  async function saveDraft() {
    if (!draft.name.trim() || !draft.prompt.trim()) return;
    const author = promptRequiredAuthor('请输入署名（必填），同事会在模板列表中看到：');
    if (!author) return;
    setSaving(true);
    try {
      const next: Template = {
        ...draft,
        id: draft.builtin ? `tpl-${Date.now()}` : draft.id || `tpl-${Date.now()}`,
        name: draft.name.trim(),
        description: draft.description.trim(),
        scope: draft.scope.trim(),
        prompt: draft.prompt.trim(),
        author,
        builtin: false
      };
      await onSaveTemplate(next);
      setDraft(templateDraft(next));
    } finally {
      setSaving(false);
    }
  }

  async function removeTemplate(id: string) {
    const author = promptRequiredAuthor('请输入署名（必填），用于回收站记录：');
    if (!author) return;
    await onDeleteTemplate(id, author);
    if (sessionRole === 'admin') void refreshTrash();
  }

  async function refreshTrash() {
    setTrashMessage('');
    try {
      setTrash(await getTemplateTrash(token));
    } catch (error) {
      setTrashMessage(error instanceof Error ? error.message : '回收站读取失败');
    }
  }

  async function restoreTrashItem(id: string) {
    const result = await restoreTemplateTrash(token, id);
    setTrash({ items: result.items, usage: result.usage });
    onTemplatesChange(result.templates);
  }

  async function purgeTrashItem(id: string) {
    const result = await purgeTemplateTrash(token, id);
    setTrash(result);
  }

  async function clearTrash() {
    if (!window.confirm('确定永久清空回收站？此操作不可恢复。')) return;
    setTrash(await clearTemplateTrash(token));
  }

  return (
    <section className="template-manager">
      <aside className="template-list">
        <button className="ghost" onClick={() => setDraft(emptyTemplateDraft())}>新建模板</button>
        {templates.map((item) => (
          <article className={item.id === currentTemplate.id ? 'selected-template' : ''} key={item.id}>
            <button onClick={() => onTemplateChange(item)}>
              <strong>{item.name}</strong>
              <span>{templateMetaLine(item)}</span>
              <small>{item.scope || item.description || '未填写说明'}</small>
            </button>
            {!item.builtin && (
              <button className="danger-link" onClick={() => void removeTemplate(item.id)}>删除</button>
            )}
          </article>
        ))}
      </aside>
      <div className="template-editor-stack">
        <section className="template-form">
          <h2>{draft.builtin ? '复制内置模板' : draft.id ? '编辑自定义模板' : '新建模板'}</h2>
          <label className="field">
            <span>名称</span>
            <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </label>
          <label className="field">
            <span>说明</span>
            <input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
          </label>
          <label className="field">
            <span>适用范围</span>
            <input value={draft.scope} onChange={(event) => setDraft({ ...draft, scope: event.target.value })} />
          </label>
          <label className="field">
            <span>解读风格说明</span>
            <textarea
              value={draft.prompt}
              onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
              placeholder="只写“怎么解读”：角色设定、解读视角、详略与侧重（对哪些板块更着重）、语气。输出结构与 JSON 格式由系统固定，无需在此描述字段或要求格式。"
            />
          </label>
          <p className="empty-section-note">模板只决定“解读风格”；速览/义务/罚则等板块结构与报告版式由系统统一保证，改这里不会让 HTML/Word 渲染错位。</p>
          {draft.builtin && <p className="warning">内置模板不能直接修改；保存后会生成一份自定义模板。</p>}
          <button className="primary block-save" onClick={() => void saveDraft()} disabled={saving || !draft.name.trim() || !draft.prompt.trim()}>
            {saving ? '保存中...' : '保存模板'}
          </button>
        </section>
        {sessionRole === 'admin' && (
          <section className="template-trash-panel">
            <div className="settings-title">
              <div>
                <h3>模板回收站</h3>
                <p>删除模板和编辑前版本会进入回收站，可恢复或永久清理。</p>
              </div>
              <div className="template-trash-actions">
                <button className="ghost pill-ghost" onClick={() => void refreshTrash()}>刷新</button>
                <button className="danger-link" onClick={() => void clearTrash()} disabled={!trash?.items.length}>清空回收站</button>
              </div>
            </div>
            <TrashUsageBar usage={trash?.usage} />
            {trashMessage && <p className="warning">{trashMessage}</p>}
            <div className="template-trash-list">
              {(trash?.items ?? []).map((item) => (
                <article key={item.id}>
                  <div>
                    <strong>{item.template.name}</strong>
                    <span>{item.reason === 'deleted' ? '删除' : '编辑历史'} · {item.template.author} · {formatDateTime(item.removedAt)} · 操作人 {item.removedBy}</span>
                  </div>
                  <button className="ghost pill-ghost" onClick={() => void restoreTrashItem(item.id)}>恢复</button>
                  <button className="danger-link" onClick={() => void purgeTrashItem(item.id)}>清除</button>
                </article>
              ))}
              {trash && !trash.items.length && <p className="empty-section-note">回收站为空。</p>}
              {!trash && <button className="ghost pill-ghost" onClick={() => void refreshTrash()}>查看回收站</button>}
            </div>
          </section>
        )}
      </div>
    </section>
  );
}

function TemplateGuide() {
  return (
    <section className="guide-page">
      <h2>如何制作一个好用的解读模板</h2>
      <ol>
        <li>先收集几份你认可的优秀解读范文，最好来自本所过往成果或客户认可的报告。</li>
        <li>把范文粘给 AI，让它提炼这些范文共同的视角、详略和语气（输出结构由系统固定，无需提炼）。</li>
        <li>把 AI 输出的“解读风格说明”粘到模板管理里的“解读风格说明”框。</li>
        <li>用同一份法规试跑，觉得不准就只改这段解读风格，不需要改代码，也不会影响报告版式。</li>
      </ol>
      <div className="meta-prompt-card">
        <div>
          <h3>提炼模板用元提示词</h3>
          <button className="ghost" onClick={() => void navigator.clipboard.writeText(META_TEMPLATE_PROMPT)}>
            <Clipboard size={16} />
            一键复制
          </button>
        </div>
        <pre>{META_TEMPLATE_PROMPT}</pre>
      </div>
    </section>
  );
}

function promptRequiredAuthor(message: string): string | null {
  const author = window.prompt(message)?.trim() ?? '';
  if (!author) {
    window.alert('署名不能为空。');
    return null;
  }
  return author;
}

function templateMetaLine(template: Template): string {
  return `${template.author || '未署名'} · 创建 ${formatDateTime(template.createdAt)} · 更新 ${formatDateTime(template.updatedAt)}`;
}

function formatDateTime(value?: string): string {
  if (!value) return '时间未明';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function TrashUsageBar({ usage }: { usage?: TemplateTrashUsage }) {
  const percent = usage?.percent ?? 0;
  return (
    <div className={`trash-usage ${percent >= 80 ? 'danger' : ''}`}>
      <div>
        <span>回收站用量</span>
        <strong>{usage ? `${percent.toFixed(2)}% · ${usage.count} 条` : '未读取'}</strong>
      </div>
      <div className="trash-usage-track">
        <span style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
      {percent >= 80 && <p>回收站接近容量上限，请清理不需要的历史版本。</p>}
    </div>
  );
}

function ArticleList({
  title,
  side,
  split,
  onChange
}: {
  title: string;
  side: Side;
  split: DocState;
  onChange: (articles: Article[]) => void;
}) {
  const refs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  function updateArticle(index: number, patch: Partial<Article>) {
    const next = split.articles.map((article, itemIndex) => (itemIndex === index ? { ...article, ...patch } : article));
    onChange(next);
  }

  function addAfter(index: number) {
    const next = [...split.articles];
    next.splice(index + 1, 0, makeArticle(null, '', split.articles[index]?.chapter ?? null));
    onChange(next);
  }

  function removeAt(index: number) {
    onChange(split.articles.filter((_, itemIndex) => itemIndex !== index));
  }

  function mergeWithNext(index: number) {
    const current = split.articles[index];
    const nextItem = split.articles[index + 1];
    if (!current || !nextItem) return;
    const next = [...split.articles];
    next.splice(index, 2, {
      ...current,
      text: `${current.text}\n${nextItem.number ? `${nextItem.number} ` : ''}${nextItem.text}`.trim(),
      raw: `${current.raw}\n${nextItem.raw}`
    });
    onChange(next);
  }

  function splitAtCursor(index: number) {
    const article = split.articles[index];
    const textarea = refs.current[article.id];
    if (!article || !textarea) return;
    const position = textarea.selectionStart;
    const before = article.text.slice(0, position).trim();
    const after = article.text.slice(position).trim();
    if (!before || !after) return;
    const next = [...split.articles];
    next.splice(index, 1, { ...article, text: before, raw: before }, makeArticle(null, after, article.chapter));
    onChange(next);
  }

  return (
    <section className="article-panel">
      <div className="panel-title">
        <h2>{title}</h2>
        <span>{split.articles.length} 条</span>
      </div>
      {split.preface && (
        <details className="preface">
          <summary>前言/元数据</summary>
          <pre>{split.preface}</pre>
        </details>
      )}
      <div className="article-stack">
        {split.articles.map((article, index) => (
          <article className="article-card" key={article.id}>
            <div className="article-tools">
              <input
                aria-label={`${side}-${index}-number`}
                value={article.number ?? ''}
                placeholder="条号"
                onChange={(event) => updateArticle(index, { number: event.target.value || null })}
              />
              <button title="在下方新增一条" onClick={() => addAfter(index)}>
                <Plus size={15} />
              </button>
              <button title="从光标处拆分" onClick={() => splitAtCursor(index)}>
                <Scissors size={15} />
              </button>
              <button title="合并下一条" onClick={() => mergeWithNext(index)} disabled={index === split.articles.length - 1}>
                <Merge size={15} />
              </button>
              <button title="删除本条" onClick={() => removeAt(index)}>
                <Trash2 size={15} />
              </button>
            </div>
            {article.chapter && <div className="chapter-chip">{article.chapter}</div>}
            <textarea
              ref={(node) => {
                refs.current[article.id] = node;
              }}
              value={article.text}
              onChange={(event) => updateArticle(index, { text: event.target.value, raw: event.target.value })}
              rows={Math.max(4, Math.min(10, article.text.split('\n').length + 2))}
            />
          </article>
        ))}
      </div>
    </section>
  );
}

function AlignmentGrid({
  mode,
  rows,
  allRows,
  rowDiffs,
  selected,
  dragBox,
  onSelect,
  onTextChange,
  onInsertBox,
  onDeleteBox,
  onDragStart,
  onDropBox
}: {
  mode: 'adjust' | 'result';
  rows: AlignRow[];
  allRows: AlignRow[];
  rowDiffs: RowDiffs;
  selected: SelectedBox;
  dragBox: DragBox;
  onSelect: (box: SelectedBox) => void;
  onTextChange: (side: Side, index: number, value: string) => void;
  onInsertBox: (side: Side, index: number, position: 'above' | 'below') => void;
  onDeleteBox: (side: Side, index: number) => void;
  onDragStart: (box: DragBox) => void;
  onDropBox: (side: Side, index: number) => void;
}) {
  return (
    <section className={`grid-editor ${mode === 'adjust' ? 'adjust-grid-editor' : 'result-grid-editor'}`}>
      {mode === 'result' && (
        <div className="grid-head">
          <div>征求意见稿</div>
          <div>正式稿</div>
        </div>
      )}
      <div
        className="grid-editor-inner"
        onClick={(event) => {
          if (mode === 'adjust') event.stopPropagation();
        }}
      >
        {rows.map((row) => {
        const index = allRows.indexOf(row);
        const diffs = rowDiffs.get(row) ?? [];
        return (
          <div className="grid-row" key={`grid-${index}`}>
            <EditableGridBox
              mode={mode}
              side="left"
              index={index}
              row={row}
              diffs={diffs}
              selected={selected?.side === 'left' && selected.index === index}
              dragging={dragBox?.side === 'left' && dragBox.index === index}
              onSelect={onSelect}
              onTextChange={onTextChange}
              onInsertBox={onInsertBox}
              onDeleteBox={onDeleteBox}
              onDragStart={onDragStart}
              onDropBox={onDropBox}
            />
            <EditableGridBox
              mode={mode}
              side="right"
              index={index}
              row={row}
              diffs={diffs}
              selected={selected?.side === 'right' && selected.index === index}
              dragging={dragBox?.side === 'right' && dragBox.index === index}
              onSelect={onSelect}
              onTextChange={onTextChange}
              onInsertBox={onInsertBox}
              onDeleteBox={onDeleteBox}
              onDragStart={onDragStart}
              onDropBox={onDropBox}
            />
          </div>
        );
        })}
      </div>
    </section>
  );
}

function EditableGridBox({
  mode,
  side,
  index,
  row,
  diffs,
  selected,
  dragging,
  onSelect,
  onTextChange,
  onInsertBox,
  onDeleteBox,
  onDragStart,
  onDropBox
}: {
  mode: 'adjust' | 'result';
  side: Side;
  index: number;
  row: AlignRow;
  diffs: ReturnType<typeof diffTexts>;
  selected: boolean;
  dragging: boolean;
  onSelect: (box: SelectedBox) => void;
  onTextChange: (side: Side, index: number, value: string) => void;
  onInsertBox: (side: Side, index: number, position: 'above' | 'below') => void;
  onDeleteBox: (side: Side, index: number) => void;
  onDragStart: (box: DragBox) => void;
  onDropBox: (side: Side, index: number) => void;
}) {
  const article = side === 'left' ? row.left : row.right;
  const editable = mode === 'adjust';
  const displayNumber = article?.number ?? (article ? '未识别条号' : '');
  return (
    <article
      className={`grid-box ${mode === 'result' ? 'readonly-box' : ''} ${selected ? 'selected' : ''} ${dragging ? 'dragging' : ''} ${article ? '' : 'empty-box'} ${editable ? 'editable-box' : ''}`}
      style={{ ['--row-stagger' as string]: `${Math.min(index, 18) * 30}ms` }}
      onClick={() => {
        if (editable) onSelect({ side, index });
      }}
      onDragOver={(event) => {
        if (editable) event.preventDefault();
      }}
      onDrop={() => {
        if (editable) onDropBox(side, index);
      }}
    >
      {editable ? (
        <>
          <button
            type="button"
            className="drag-handle"
            title="拖动框格"
            aria-label="拖动框格"
            draggable
            onClick={(event) => {
              event.stopPropagation();
              onSelect({ side, index });
            }}
            onDragStart={(event) => {
              event.stopPropagation();
              onDragStart({ side, index });
            }}
          >
            <GripVertical size={16} />
          </button>
          {selected && (
            <div className={`box-action-popover ${side === 'right' ? 'right-side' : ''}`}>
              <button type="button" onClick={() => onInsertBox(side, index, 'above')}>↑ 上方插入</button>
              <button type="button" onClick={() => onInsertBox(side, index, 'below')}>↓ 下方插入</button>
              <button type="button" onClick={() => onDeleteBox(side, index)}>删除</button>
            </div>
          )}
          {displayNumber && <span className="box-number-label">{displayNumber}</span>}
          <textarea
            value={article ? articleBoxText(article) : ''}
            onChange={(event) => onTextChange(side, index, event.target.value)}
            rows={Math.max(3, Math.min(8, (article?.text ?? '').split('\n').length + 1))}
          />
        </>
      ) : (
        <div className="readonly-content">
          {row.moved && article && <span className="move-tag inline">位置调整</span>}
          {article ? diffPreview(side, row, diffs) : null}
        </div>
      )}
    </article>
  );
}

function diffPreview(side: Side, row: AlignRow, diffs: ReturnType<typeof diffTexts>) {
  const article = side === 'left' ? row.left : row.right;
  if (!article) return null;
  if (row.type === 'inserted' && side === 'right') return <span className="insert-text">{articleBoxText(article)}</span>;
  if (row.type === 'deleted' && side === 'left') return <span className="delete-text">{articleBoxText(article)}</span>;
  if (row.type !== 'matched') return <span>{articleBoxText(article)}</span>;
  return (
    <>
      {diffs.map((part, partIndex) => {
        if (part.op === 0) return <span key={partIndex}>{part.text}</span>;
        if (side === 'left' && part.op === -1) return <span className="delete-text" key={partIndex}>{part.text}</span>;
        if (side === 'right' && part.op === 1) return <span className="insert-text" key={partIndex}>{part.text}</span>;
        return null;
      })}
    </>
  );
}

function summarizeRows(rows: AlignRow[]) {
  return rows.reduce(
    (acc, row) => {
      if (row.type === 'inserted') acc.inserted += 1;
      if (row.type === 'deleted') acc.deleted += 1;
      if (row.type === 'matched' && hasTextChange(row.left?.text ?? '', row.right?.text ?? '')) acc.modified += 1;
      return acc;
    },
    { inserted: 0, deleted: 0, modified: 0 }
  );
}

function rowHasChange(row: AlignRow) {
  if (row.type !== 'matched') return true;
  return hasTextChange(row.left?.text ?? '', row.right?.text ?? '') || Boolean(row.moved);
}

function rowsFromBoxes(leftBoxes: GridBox[], rightBoxes: GridBox[]): AlignRow[] {
  const length = Math.max(leftBoxes.length, rightBoxes.length);
  const rows: AlignRow[] = [];
  for (let index = 0; index < length; index += 1) {
    const left = normalizeBoxArticle(leftBoxes[index]);
    const right = normalizeBoxArticle(rightBoxes[index]);
    if (left && right) {
      rows.push({
        left,
        right,
        type: 'matched',
        similarity: articleSimilarity(left, right),
        moved: Boolean(leftBoxes[index]?.moved || rightBoxes[index]?.moved)
      });
    } else if (left) {
      rows.push({ left, right: null, type: 'deleted', similarity: 0 });
    } else if (right) {
      rows.push({ left: null, right, type: 'inserted', similarity: 0 });
    } else {
      rows.push({ left: null, right: null, type: 'matched', similarity: 1 });
    }
  }
  return rows;
}

function recomputeDiffs(rows: AlignRow[]): ReturnType<typeof diffTexts>[] {
  return rows.map((row) => (row.type === 'matched' && row.left && row.right ? diffTexts(row.left.text, row.right.text) : []));
}

function boxFromArticle(article: Article | null, moved = false): GridBox {
  return { id: crypto.randomUUID(), article, moved };
}

function emptyGridBox(): GridBox {
  return { id: crypto.randomUUID(), article: null };
}

function normalizeBoxArticle(box: GridBox | undefined): Article | null {
  if (!box?.article?.text.trim()) return null;
  return box.article;
}

function articleBoxText(article: Article): string {
  return [article.number, article.text].filter(Boolean).join('\n');
}

function articleFromBoxText(value: string, previous: Article | null): Article | null {
  const text = value.trim();
  if (!text) return null;
  const match = text.match(/^\s*(第[一二三四五六七八九十百千零〇\d]+条)\s*/);
  const number = match?.[1] ?? previous?.number ?? null;
  const body = match ? text.slice(match[0].length).trim() : text;
  return {
    id: previous?.id ?? crypto.randomUUID(),
    number,
    chapter: previous?.chapter ?? null,
    text: body,
    raw: text
  };
}

function extractMessageContent(result: unknown): string {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return '';
  const value = result as { choices?: Array<{ message?: { content?: string } }>; content?: string; text?: string };
  return value.choices?.[0]?.message?.content ?? value.content ?? value.text ?? JSON.stringify(result);
}

function sampleDoc(fileName: string, split: SplitResult): DocState {
  return { fileName, text: documentTextFromSplit(split), preface: split.preface, articles: split.articles, warning: null, loading: false };
}

function mergeTemplates(remoteTemplates: Template[]): Template[] {
  const now = new Date().toISOString();
  const validRemote = remoteTemplates
    .filter((item) => item && item.id && item.name && item.prompt)
    .map((item) => ({
      ...item,
      author: item.author || '历史模板',
      createdAt: item.createdAt || now,
      updatedAt: item.updatedAt || item.createdAt || now,
      builtin: Boolean(item.builtin) && builtInTemplates.some((builtIn) => builtIn.id === item.id) ? true : false
    }));
  const custom = validRemote.filter((item) => !builtInTemplates.some((builtIn) => builtIn.id === item.id));
  return [...builtInTemplates, ...custom];
}

function templateDraft(template: Template): Template {
  return { ...template };
}

function emptyTemplateDraft(): Template {
  return {
    id: '',
    name: '',
    description: '',
    scope: '',
    prompt: '',
    builtin: false,
    author: '',
    createdAt: '',
    updatedAt: ''
  };
}

function documentTextFromSplit(split: SplitResult): string {
  return [
    split.preface,
    ...split.articles.map((article) => [article.chapter, article.number, article.text].filter(Boolean).join('\n'))
  ]
    .filter(Boolean)
    .join('\n\n');
}

const SAMPLE_LEFT = `
国家网络安全事件报告管理办法
征求意见稿

第一章 总则
第一条 为规范网络安全事件报告工作，保障网络运行安全，制定本办法。
第二条 网络运营者在中华人民共和国境内报告网络安全事件，适用本办法。

第二章 报告要求
第七条 网络运营者应当建立网络安全事件报告机制。
第八条 网络运营者发现网络安全事件后，应当及时向网信部门报告。
第九条 本办法自公布之日起施行。
`;

const SAMPLE_RIGHT = `
国家网络安全事件报告管理办法
正式稿

第一章 总则
第一条 为规范网络安全事件报告工作，保障网络运行安全和数据安全，制定本办法。
第二条 网络运营者在中华人民共和国境内报告网络安全事件，适用本办法。

第二章 报告要求
第七条 网络运营者应当建立健全网络安全事件报告机制。
第八条 国家网信部门可以要求网络运营者补充报告有关情况。
第九条 网络运营者发现网络安全事件后，应当立即向网信部门报告。
第十条 本办法自公布之日起施行。
`;
