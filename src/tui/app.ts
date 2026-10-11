import {
  BoxRenderable, CodeRenderable, InputRenderable, InputRenderableEvents, MarkdownRenderable,
  ScrollBoxRenderable, SelectRenderable, SelectRenderableEvents, TextRenderable, createCliRenderer,
  type CliRenderer, type KeyEvent, type SyntaxStyle,
} from "@opentui/core";
import { Catalog } from "../api/catalog.ts";
import { LeetCodeClient, type ListOptions, type JudgeJob } from "../api/client.ts";
import type { Problem, ProblemPage, User } from "../api/schemas.ts";
import { loginWithBrowser } from "../auth/login.ts";
import { openEditor } from "../editor.ts";
import { saveSettings, type AppPaths, type Settings } from "../storage.ts";
import { errorMessage, isAbort } from "../utils/errors.ts";
import { openUrl, type UrlOpener } from "../utils/open-url.ts";
import {
  appendFailingTest, failingSubmissionInput, languageFiletype, loadResult, openWorkspace, prepareTestInput, readSolution, readTests,
  replaceSolution, saveResult, type SavedResult, type SolutionFiles,
} from "../workspace.ts";
import { accountLabel, formatDescription, formatResult, premiumFilterLabel, problemLabel, terminalText, verdict, type DescriptionImage } from "./format.ts";
import { colors, syntaxStyle } from "./theme.ts";
import { previewMarkdown } from "./markdown.ts";
import { ViewStateStore, type SavedViewState, type Tab } from "./view-state.ts";

const tabs: Tab[] = ["description", "solution", "tests", "results"];
const difficultyFilters: (ListOptions["difficulty"] | undefined)[] = [undefined, "EASY", "MEDIUM", "HARD"];
const statusFilters: (ListOptions["status"] | undefined)[] = [undefined, "NOT_STARTED", "TRIED", "AC"];
const premiumFilters: (ListOptions["premium"] | undefined)[] = [undefined, false, true];

export class LeetCove {
  private readonly catalog: Catalog;
  private readonly viewState: ViewStateStore;
  private readonly header: TextRenderable;
  private readonly listBox: BoxRenderable;
  private readonly menu: SelectRenderable;
  private readonly searchInput: InputRenderable;
  private readonly listInfo: TextRenderable;
  private readonly problemBox: BoxRenderable;
  private readonly tabBar: TextRenderable;
  private readonly scrolls: Record<Tab, ScrollBoxRenderable>;
  private readonly description: MarkdownRenderable;
  private readonly solution: CodeRenderable;
  private readonly tests: TextRenderable;
  private readonly results: TextRenderable;
  private readonly notice: TextRenderable;
  private readonly help: TextRenderable;
  private readonly dialog: BoxRenderable;
  private readonly dialogText: TextRenderable;
  private readonly dialogMenu: SelectRenderable;
  private readonly helpScroll: ScrollBoxRenderable;
  private readonly helpContent: TextRenderable;
  private readonly style: SyntaxStyle;
  private screen: "list" | "problem" = "list";
  private activeTab: Tab = "description";
  private searching = false;
  private dialogMode?: "language" | "images" | "help";
  private images: DescriptionImage[] = [];
  private page: ProblemPage = { total: 0, questions: [] };
  private options: ListOptions = { limit: 50, skip: 0 };
  private problem?: Problem;
  private files?: SolutionFiles;
  private savedResult?: SavedResult;
  private language: string;
  private user?: User;
  private busy = false;
  private editing = false;
  private listRequest?: AbortController;
  private operation?: AbortController;
  private activeTask?: Promise<void>;
  private readonly lifetime = new AbortController();
  private searchTimer?: ReturnType<typeof setTimeout>;
  private settings: Settings;
  private initializing = true;

  constructor(
    private readonly renderer: CliRenderer,
    private readonly client: LeetCodeClient,
    private readonly paths: AppPaths,
    settings: Settings,
    private readonly openLink: UrlOpener = openUrl,
  ) {
    this.settings = settings;
    this.language = settings.language;
    this.catalog = new Catalog(client, paths);
    this.viewState = new ViewStateStore(paths, (error) => this.setNotice(`Could not save your place: ${errorMessage(error)}`, true));
    this.style = syntaxStyle(renderer);
    const root = new BoxRenderable(renderer, { width: "100%", height: "100%", flexDirection: "column", paddingX: 1, paddingY: 1, backgroundColor: colors.background });
    this.header = new TextRenderable(renderer, { height: 2, fg: colors.accent, content: "LeetCove  /  LeetCode in your terminal" });
    this.listBox = new BoxRenderable(renderer, { flexGrow: 1, minHeight: 0, flexDirection: "column", border: true, borderColor: colors.border, backgroundColor: colors.panel, title: " Problems ", paddingX: 1 });
    this.searchInput = new InputRenderable(renderer, { width: "100%", placeholder: "Press / to search by title or number", textColor: colors.text, focusedBackgroundColor: colors.selected, cursorColor: colors.accent });
    this.listInfo = new TextRenderable(renderer, { height: 2, fg: colors.muted, content: "Loading problems…" });
    this.menu = new SelectRenderable(renderer, { flexGrow: 1, minHeight: 0, width: "100%", options: [], showDescription: false, showScrollIndicator: true, textColor: colors.text, focusedTextColor: colors.text, backgroundColor: colors.panel, focusedBackgroundColor: colors.panel, selectedBackgroundColor: colors.selected, selectedTextColor: colors.accent });
    this.listBox.add(this.searchInput);
    this.listBox.add(this.listInfo);
    this.listBox.add(this.menu);
    this.problemBox = new BoxRenderable(renderer, { visible: false, flexGrow: 1, minHeight: 0, flexDirection: "column", border: true, borderColor: colors.border, backgroundColor: colors.panel, paddingX: 1 });
    this.tabBar = new TextRenderable(renderer, { height: 2, fg: colors.accent });
    this.problemBox.add(this.tabBar);
    const makeScroll = (tab: Tab) => new ScrollBoxRenderable(renderer, { id: `view-${tab}`, flexGrow: 1, minHeight: 0, width: "100%", visible: tab === "description", contentOptions: { paddingX: 1, paddingBottom: 1 }, scrollX: tab === "solution" });
    this.scrolls = { description: makeScroll("description"), solution: makeScroll("solution"), tests: makeScroll("tests"), results: makeScroll("results") };
    this.description = new MarkdownRenderable(renderer, { width: "100%", content: "", syntaxStyle: this.style, fg: colors.text, conceal: true, internalBlockMode: "top-level", renderNode: previewMarkdown });
    this.solution = new CodeRenderable(renderer, { width: "100%", content: "", filetype: languageFiletype(this.language), syntaxStyle: this.style, fg: colors.text, wrapMode: "none", drawUnstyledText: true });
    this.tests = new TextRenderable(renderer, { width: "100%", fg: colors.text, wrapMode: "word" });
    this.results = new TextRenderable(renderer, { width: "100%", fg: colors.text, wrapMode: "word", content: formatResult() });
    this.scrolls.description.add(this.description);
    this.scrolls.solution.add(this.solution);
    this.scrolls.tests.add(this.tests);
    this.scrolls.results.add(this.results);
    for (const tab of tabs) this.problemBox.add(this.scrolls[tab]);
    this.notice = new TextRenderable(renderer, { height: 2, fg: colors.muted, wrapMode: "word", content: "Browse without login. Press a to sign in." });
    this.help = new TextRenderable(renderer, { height: 1, fg: colors.muted });
    this.dialog = new BoxRenderable(renderer, { visible: false, position: "absolute", top: 2, bottom: 2, left: 3, right: 3, zIndex: 10, border: true, borderColor: colors.accent, backgroundColor: colors.panel, padding: 1, flexDirection: "column" });
    this.dialogText = new TextRenderable(renderer, { fg: colors.text, wrapMode: "word" });
    this.dialogMenu = new SelectRenderable(renderer, { flexGrow: 1, minHeight: 0, showDescription: false, textColor: colors.text, focusedTextColor: colors.text, selectedTextColor: colors.accent, selectedBackgroundColor: colors.selected, backgroundColor: colors.panel, focusedBackgroundColor: colors.panel });
    this.helpScroll = new ScrollBoxRenderable(renderer, { visible: false, flexGrow: 1, minHeight: 0, width: "100%" });
    this.helpContent = new TextRenderable(renderer, { width: "100%", fg: colors.text, wrapMode: "word" });
    this.helpScroll.add(this.helpContent);
    this.dialog.add(this.dialogText);
    this.dialog.add(this.dialogMenu);
    this.dialog.add(this.helpScroll);
    root.add(this.header);
    root.add(this.listBox);
    root.add(this.problemBox);
    root.add(this.notice);
    root.add(this.help);
    root.add(this.dialog);
    renderer.root.add(root);
    this.bindEvents();
    this.updateChrome();
    this.menu.focus();
  }

  private bindEvents(): void {
    this.renderer.keyInput.on("keypress", this.onKey);
    this.renderer.on("frame", this.onFrame);
    this.renderer.once("destroy", () => this.dispose());
    this.menu.on(SelectRenderableEvents.ITEM_SELECTED, (index: number) => {
      const selected = this.page.questions[index];
      if (selected) void this.openProblem(selected.titleSlug);
    });
    this.menu.on(SelectRenderableEvents.SELECTION_CHANGED, () => this.rememberView());
    this.searchInput.on(InputRenderableEvents.INPUT, (value: string) => this.scheduleSearch(value));
    this.dialogMenu.on(SelectRenderableEvents.ITEM_SELECTED, (index: number) => this.selectDialogItem(index));
  }

  private selectDialogItem(index: number): void {
    if (this.dialogMode === "images") return this.selectImage(index);
    if (this.dialogMode !== "language") return;
    const language = this.problem?.codeSnippets?.[index]?.langSlug;
    this.closeDialog();
    if (language) void this.changeLanguage(language);
  }

  async initialize(slug?: string): Promise<void> {
    const saved = await this.viewState.load();
    if (this.renderer.isDestroyed) return;
    this.applySavedList(saved);
    if (saved && !slug) this.language = saved.language;
    this.updateChrome();
    await Promise.all([this.refreshList(), this.refreshUser()]);
    if (this.renderer.isDestroyed) return;
    this.restoreListSelection(saved?.list);
    await this.restoreView(slug, saved);
    if (this.renderer.isDestroyed) return;
    this.initializing = false;
    this.rememberView();
  }

  private applySavedList(saved?: SavedViewState): void {
    if (!saved) return;
    this.options = { ...saved.list.options };
    this.searchInput.value = saved.list.options.search || "";
  }

  private restoreListSelection(saved?: SavedViewState["list"]): void {
    if (!saved || !this.page.questions.length) return;
    const slugIndex = this.page.questions.findIndex((question) => question.titleSlug === saved.selectedSlug);
    const index = slugIndex >= 0 ? slugIndex : Math.min(saved.selectedIndex, this.page.questions.length - 1);
    this.menu.setSelectedIndex(index);
  }

  private async restoreView(slug?: string, saved?: SavedViewState): Promise<void> {
    if (slug) {
      await this.openProblem(slug);
      return;
    }
    if (saved?.view.screen !== "problem") return;
    const view = saved.view;
    await this.openProblem(view.slug);
    if (this.renderer.isDestroyed || this.screen !== "problem" || this.problem?.titleSlug !== view.slug) return;
    this.setTab(view.tab);
    await this.renderer.idle();
    if (this.renderer.isDestroyed) return;
    this.scrolls[view.tab].scrollTo(view.scroll);
  }

  private rememberView(): void {
    if (this.initializing || this.renderer.isDestroyed) return;
    const selectedIndex = Math.max(0, this.menu.getSelectedIndex());
    const list = {
      options: { ...this.options, skip: this.options.skip ?? 0, limit: this.options.limit ?? 50 },
      selectedIndex,
      selectedSlug: this.page.questions[selectedIndex]?.titleSlug,
    };
    const view: SavedViewState["view"] = this.screen === "problem" && this.problem ? {
      screen: "problem",
      slug: this.problem.titleSlug,
      tab: this.activeTab,
      scroll: { x: this.scrolls[this.activeTab].scrollLeft, y: this.scrolls[this.activeTab].scrollTop },
    } : { screen: "list" };
    this.viewState.remember({ version: 1, language: this.language, list, view });
  }

  private onFrame = (): void => this.rememberView();

  private async refreshUser(): Promise<void> {
    try {
      this.user = await this.client.user(this.lifetime.signal);
      this.updateChrome();
    } catch (error) {
      this.setNotice(errorMessage(error), true);
    }
  }

  private setNotice(message: string, error = false): void {
    if (this.renderer.isDestroyed) return;
    this.notice.content = terminalText(message);
    this.notice.fg = error ? colors.error : colors.muted;
  }

  private updateChrome(): void {
    if (this.renderer.isDestroyed) return;
    const account = accountLabel(this.user, this.client.session.username);
    this.header.content = terminalText(`LeetCove   /   ${account}   /   ${this.language}${this.busy ? "   /   working…" : ""}`);
    this.help.content = this.screen === "list" ? "j/k move  h/l page  Enter open  / search  d difficulty  f status  P premium  a login  ? help  q quit" : "h/l tabs  j/k scroll  i images  Ctrl+E edit  t tests  r run  s submit  f save failure  L language  x cancel  Esc back  ? help";
    this.tabBar.content = tabs.map((tab, index) => `${index + 1} ${tab === this.activeTab ? `[${tab.toUpperCase()}]` : tab}`).join("   ");
  }

  private applyPage(page: ProblemPage, offline = false): void {
    if (this.renderer.isDestroyed) return;
    this.page = page;
    this.menu.options = page.questions.map((problem) => ({ name: problemLabel(problem), description: "" }));
    const skip = this.options.skip || 0;
    const range = page.questions.length ? `${skip + 1}–${skip + page.questions.length}` : "0";
    this.listInfo.content = `${range} of ${page.total}  ·  ${premiumFilterLabel(this.options.premium)}  ·  ${this.options.difficulty || "All difficulties"}  ·  ${this.options.status || "All statuses"}${offline ? "  ·  cached/offline" : ""}\n ✓ solved    · attempted    [Premium] requires access`;
    this.listBox.title = this.options.search ? ` Search: ${terminalText(this.options.search)} ` : " Problems ";
    this.menu.setSelectedIndex(0);
  }

  private async refreshList(): Promise<void> {
    this.listRequest?.abort();
    const controller = new AbortController();
    this.listRequest = controller;
    this.setNotice("Loading problems…");
    try {
      const loaded = await this.catalog.load({ ...this.options }, controller.signal);
      if (controller.signal.aborted) return;
      this.applyPage(loaded.page, loaded.offline);
      if (this.screen === "list") this.setNotice(loaded.offline ? "Using cached problems. Press R to retry the network." : "Ready. Enter opens the selected problem.");
    } catch (error) {
      if (isAbort(error) || controller.signal.aborted) return;
      this.setNotice(errorMessage(error), true);
    }
  }

  private scheduleSearch(value: string): void {
    if (this.initializing) return;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.listRequest?.abort();
    this.options = { ...this.options, search: value.trim(), skip: 0 };
    this.searchTimer = setTimeout(() => void this.refreshList(), 250);
  }

  private beginSearch(): void {
    this.searching = true;
    this.searchInput.focus();
    this.setNotice("Type a title or problem number. Enter returns to the list; Esc leaves search.");
  }

  private endSearch(): void {
    this.searching = false;
    this.searchInput.blur();
    this.menu.focus();
  }

  private changePage(direction: number): void {
    const limit = this.options.limit || 50;
    const next = Math.max(0, (this.options.skip || 0) + direction * limit);
    if (next >= this.page.total || next === this.options.skip) return;
    this.options = { ...this.options, skip: next };
    void this.refreshList();
  }

  private cycleDifficulty(): void {
    const index = difficultyFilters.indexOf(this.options.difficulty);
    this.options = { ...this.options, difficulty: difficultyFilters[(index + 1) % difficultyFilters.length], skip: 0 };
    void this.refreshList();
  }

  private cycleStatus(): void {
    const index = statusFilters.indexOf(this.options.status);
    this.options = { ...this.options, status: statusFilters[(index + 1) % statusFilters.length], skip: 0 };
    void this.refreshList();
  }

  private cyclePremium(): void {
    const index = premiumFilters.indexOf(this.options.premium);
    this.options = { ...this.options, premium: premiumFilters[(index + 1) % premiumFilters.length], skip: 0 };
    void this.refreshList();
  }

  private perform(label: string, action: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (this.busy || this.renderer.isDestroyed) return Promise.resolve();
    this.activeTask = this.performAction(label, action);
    return this.activeTask;
  }

  private async performAction(label: string, action: (signal: AbortSignal) => Promise<void>): Promise<void> {
    this.busy = true;
    const controller = new AbortController();
    this.operation = controller;
    this.setNotice(label);
    this.updateChrome();
    try {
      await action(controller.signal);
    } catch (error) {
      this.setNotice(isAbort(error) ? "Stopped waiting. A LeetCode job already started may still finish." : errorMessage(error), !isAbort(error));
    } finally {
      this.busy = false;
      this.operation = undefined;
      this.updateChrome();
    }
  }

  async openProblem(slug: string): Promise<void> {
    await this.perform("Opening problem…", async (signal) => {
      const problem = await this.client.problem(slug, signal);
      signal.throwIfAborted();
      this.problem = problem;
      this.files = undefined;
      this.savedResult = undefined;
      this.solution.content = "";
      this.tests.content = "No editable tests are available for this problem.";
      this.results.content = formatResult();
      this.description.content = "";
      const description = formatDescription(problem);
      this.images = description.images;
      this.description.content = description.markdown;
      this.problemBox.title = terminalText(` ${problem.questionFrontendId}. ${problem.title} · ${problem.difficulty} `);
      const available = problem.codeSnippets || [];
      const language = available.find((snippet) => snippet.langSlug === this.language)?.langSlug || available[0]?.langSlug;
      if (language && problem.content) await this.loadWorkspace(language);
      signal.throwIfAborted();
      this.listBox.visible = false;
      this.problemBox.visible = true;
      this.screen = "problem";
      this.menu.blur();
      this.endSearchForProblem();
      for (const tab of tabs) this.scrolls[tab].scrollTo(0);
      this.setTab("description");
      const imageHint = this.images.length ? ` i opens ${this.images.length} description image${this.images.length === 1 ? "" : "s"}.` : "";
      this.setNotice(problem.content ? `Ctrl+E opens your solution in EDITOR. t shows editable test inputs.${imageHint}` : "This problem requires Premium access.");
    });
  }

  private endSearchForProblem(): void {
    this.searching = false;
    this.searchInput.blur();
  }

  private async loadWorkspace(language: string): Promise<void> {
    if (!this.problem) return;
    this.language = language;
    this.files = await openWorkspace(this.problem, language, this.paths, this.settings);
    this.savedResult = await loadResult(this.files);
    await this.reloadFiles();
    this.solution.filetype = languageFiletype(language);
    this.results.content = formatResult(this.savedResult);
    this.results.fg = this.savedResult && verdict(this.savedResult.result, this.savedResult.kind) === "Accepted" ? colors.success : colors.text;
  }

  private async reloadFiles(): Promise<void> {
    if (!this.files) return;
    const [code, tests] = await Promise.all([readSolution(this.files), readTests(this.files)]);
    if (this.renderer.isDestroyed) return;
    this.solution.content = terminalText(code);
    this.tests.content = terminalText(`Custom test inputs · ${this.files.tests}\n\nCtrl+E edits this file. One JSON argument per line; blank lines separate cases.\n\n${tests}`);
  }

  private setTab(tab: Tab): void {
    this.activeTab = tab;
    for (const name of tabs) {
      this.scrolls[name].visible = name === tab;
      this.scrolls[name].blur();
    }
    this.scrolls[tab].focus();
    this.updateChrome();
    this.rememberView();
  }

  private nextTab(direction: number): void {
    const index = tabs.indexOf(this.activeTab);
    this.setTab(tabs[(index + direction + tabs.length) % tabs.length] || "description");
  }

  private backToList(): void {
    if (this.busy) return;
    this.screen = "list";
    this.problemBox.visible = false;
    this.listBox.visible = true;
    this.scrolls[this.activeTab].blur();
    this.menu.focus();
    this.updateChrome();
    this.setNotice("Ready. Enter opens the selected problem.");
    this.rememberView();
  }

  private async edit(testFile = this.activeTab === "tests"): Promise<void> {
    const files = this.files;
    if (!files) return this.setNotice("No editable solution for this problem.", true);
    this.setTab(testFile ? "tests" : "solution");
    await this.perform("Opening editor…", async () => {
      this.editing = true;
      try {
        await openEditor(testFile ? files.tests : files.solution, this.settings, this.renderer);
        await this.reloadFiles();
        this.setNotice(`Reloaded ${testFile ? files.tests : files.solution}`);
      } finally {
        this.editing = false;
      }
    });
  }

  private async judge(kind: JudgeJob["kind"]): Promise<void> {
    const problem = this.problem;
    const files = this.files;
    if (!problem || !files) return;
    await this.perform(kind === "run" ? "Running custom tests…" : "Submitting to LeetCode…", async (signal) => {
      const code = await readSolution(files);
      const tests = kind === "run" ? prepareTestInput(await readTests(files), problem) : undefined;
      await this.reloadFiles();
      this.setTab("results");
      this.results.fg = colors.text;
      this.results.content = kind === "run" ? "Starting test run…" : "Starting submission…";
      const job = await this.client.start(kind, problem, this.language, code, tests, signal);
      const result = await this.client.poll(job, (state) => {
        if (this.renderer.isDestroyed) return;
        this.results.content = `${kind === "run" ? "Test run" : "Submission"} ${job.id}\n\n${state}…\n\nx stops waiting; the remote job may continue.`;
      }, signal);
      this.savedResult = await saveResult(files, kind, job.id, result, job.testInput);
      if (this.renderer.isDestroyed) return;
      const label = verdict(result, kind);
      this.results.content = formatResult(this.savedResult);
      this.results.fg = label === "Accepted" ? colors.success : colors.text;
      if (kind === "submit") await this.refreshList();
      const hint = failingSubmissionInput(this.savedResult) ? " · f saves failing input to tests.txt" : "";
      this.setNotice(`${label} · ${kind === "run" ? "Custom tests" : "Submission"} ${job.id}${hint}`);
    });
  }

  private async addFailingTest(): Promise<void> {
    const files = this.files;
    const problem = this.problem;
    const saved = this.savedResult;
    if (!files || !problem) return this.setNotice("No editable tests for this problem.", true);
    await this.perform("Saving failing test…", async () => {
      const added = await appendFailingTest(files, problem, saved);
      await this.reloadFiles();
      if (this.renderer.isDestroyed) return;
      this.setTab("tests");
      this.setNotice(`${added ? "Added failing test to" : "Failing test is already in"} ${files.tests}. Press r to run.`);
    });
  }

  private async signIn(): Promise<void> {
    await this.perform("Complete sign-in in the browser window. x cancels.", async (signal) => {
      this.client.session = await loginWithBrowser(this.paths, this.settings, signal);
      this.user = await this.client.user(signal);
      await this.refreshList();
      this.setNotice(`Signed in as ${this.user.username}.`);
    });
  }

  private showLanguages(): void {
    if (this.busy || !this.problem?.codeSnippets?.length) return;
    this.dialogMode = "language";
    this.dialog.title = " Choose solution language ";
    this.dialogText.content = "j/k select · Enter confirm · Esc cancel\nEach language has its own saved solution.\n";
    this.dialogText.visible = true;
    this.helpScroll.visible = false;
    this.dialogMenu.visible = true;
    this.dialogMenu.showDescription = false;
    this.dialogMenu.options = this.problem.codeSnippets.map((snippet) => ({ name: snippet.lang, description: "" }));
    this.dialogMenu.setSelectedIndex(Math.max(0, this.problem.codeSnippets.findIndex((snippet) => snippet.langSlug === this.language)));
    this.dialog.visible = true;
    this.dialogMenu.focus();
  }

  private showImages(): void {
    if (this.busy) return;
    const first = this.images[0];
    if (!first) return this.setNotice("No images in this problem description.");
    if (this.images.length === 1) {
      void this.openImage(first);
      return;
    }
    this.dialogMode = "images";
    this.dialog.title = " Problem images ";
    this.dialogText.content = "j/k select · Enter opens the image in your browser · Esc cancel\n";
    this.dialogText.visible = true;
    this.helpScroll.visible = false;
    this.dialogMenu.visible = true;
    this.dialogMenu.showDescription = true;
    this.dialogMenu.options = this.images.map((image, index) => ({ name: `Image ${index + 1}: ${image.label}`, description: image.url }));
    this.dialogMenu.setSelectedIndex(0);
    this.dialog.visible = true;
    this.scrolls[this.activeTab].blur();
    this.dialogMenu.focus();
  }

  private selectImage(index: number): void {
    const image = this.images[index];
    this.closeDialog();
    if (image) void this.openImage(image);
  }

  private async openImage(image: DescriptionImage): Promise<void> {
    await this.perform("Opening description image…", async () => {
      await this.openLink(image.url, this.settings);
      this.setNotice(`Opened image in your browser: ${image.label}`);
    });
  }

  private async changeLanguage(language: string): Promise<void> {
    await this.perform(`Opening ${language} solution…`, async () => {
      await this.loadWorkspace(language);
      this.settings = { ...this.settings, language };
      await saveSettings(this.paths, this.settings);
      this.setTab("solution");
      this.setNotice(`Using ${language} · ${this.files?.solution}`);
    });
  }

  private async restorePrevious(): Promise<void> {
    const files = this.files;
    const problem = this.problem;
    if (!files || !problem) return;
    await this.perform("Fetching your last submitted solution…", async (signal) => {
      const code = await this.client.previousCode(problem.titleSlug, this.language, signal);
      const backup = await replaceSolution(files, code);
      await this.reloadFiles();
      this.setTab("solution");
      this.setNotice(`Previous submission restored. Your earlier local file is backed up at ${backup}`);
    });
  }

  private showHelp(): void {
    this.dialogMode = "help";
    this.dialog.title = " LeetCove keys ";
    this.dialog.visible = true;
    this.dialogText.visible = false;
    this.dialogMenu.visible = false;
    this.helpContent.content = `PROBLEMS\n  j/k or arrows    Move selection\n  h/l              Previous / next page\n  Enter            Open problem\n  /                Search title or number\n  d                Cycle difficulty\n  f                Cycle solved / attempted status\n  P                Cycle all / free only / Premium only\n  R                Refresh problems\n\nPROBLEM\n  h/l or Tab       Switch description / solution / tests / results\n  1/2/3/4          Select a view\n  j/k, Ctrl+d/u    Scroll\n  i                Open description image (choose if there are several)\n  Ctrl+E or e      Edit solution (test file when on Tests)\n  E                Edit tests from any view\n  r                Run saved code on custom tests\n  s                Submit saved code to the full judge\n  f                Save the failed submission's input to tests.txt\n  L                Choose language\n  p                Restore last submitted code (creates a backup)\n  R                Reload local files\n  x                Stop waiting for a job\n  Esc or q         Back to problem list\n\nGLOBAL\n  a                Browser login\n  Ctrl+C           Quit\n  ?                This help\n\nEsc closes this panel. j/k scrolls this help.`;
    this.menu.blur();
    this.scrolls[this.activeTab].blur();
    this.helpScroll.visible = true;
    this.helpScroll.scrollTo(0);
    this.helpScroll.focus();
  }

  private closeDialog(): void {
    this.dialogMode = undefined;
    this.dialog.visible = false;
    this.dialogMenu.blur();
    this.helpScroll.blur();
    if (this.screen === "list") this.menu.focus();
    else this.scrolls[this.activeTab].focus();
  }

  private onKey = (key: KeyEvent): void => {
    if (key.ctrl && key.name === "c") {
      key.preventDefault();
      this.close();
      return;
    }
    if (this.editing) return;
    if (this.dialogMode) return this.handleDialogKey(key);
    if (this.searching) return this.handleSearchKey(key);
    if (key.name === "x") {
      this.operation?.abort();
      key.preventDefault();
      return;
    }
    if (key.sequence === "?") {
      this.showHelp();
      key.preventDefault();
      return;
    }
    if (key.name === "a") {
      void this.signIn();
      key.preventDefault();
      return;
    }
    if (this.screen === "list") this.handleListKey(key);
    else this.handleProblemKey(key);
  };

  private handleDialogKey(key: KeyEvent): void {
    if (this.dialogMode === "help" && key.name === "j") {
      this.helpScroll.scrollBy(1);
      key.preventDefault();
      return;
    }
    if (this.dialogMode === "help" && key.name === "k") {
      this.helpScroll.scrollBy(-1);
      key.preventDefault();
      return;
    }
    if (key.name !== "escape" && key.name !== "q" && key.sequence !== "?") return;
    this.closeDialog();
    key.preventDefault();
  }

  private handleSearchKey(key: KeyEvent): void {
    if (key.name !== "escape" && key.name !== "return") return;
    this.endSearch();
    if (this.searchTimer) clearTimeout(this.searchTimer);
    void this.refreshList();
    key.preventDefault();
  }

  private handleListKey(key: KeyEvent): void {
    if (key.sequence === "/") this.beginSearch();
    else if (key.name === "q" || key.name === "escape") this.close();
    else if (key.name === "h" || key.name === "left") this.changePage(-1);
    else if (key.name === "l" || key.name === "right") this.changePage(1);
    else if (key.name === "d" && !key.ctrl) this.cycleDifficulty();
    else if (key.name === "f") this.cycleStatus();
    else if (key.name === "p" && key.shift) this.cyclePremium();
    else if (key.name === "r" && key.shift) void this.refreshList();
    else if (key.name === "g") this.menu.setSelectedIndex(key.shift ? this.page.questions.length - 1 : 0);
    else if (key.ctrl && key.name === "d") this.menu.moveDown(10);
    else if (key.ctrl && key.name === "u") this.menu.moveUp(10);
    else return;
    key.preventDefault();
  }

  private handleProblemKey(key: KeyEvent): void {
    if (key.name === "escape" || key.name === "q") this.backToList();
    else if (key.name === "l" && key.shift) this.showLanguages();
    else if (key.name === "h" || key.name === "left") this.nextTab(-1);
    else if (key.name === "l" || key.name === "right") this.nextTab(1);
    else if (key.name === "tab") this.nextTab(key.shift ? -1 : 1);
    else if (key.name === "j" || key.name === "down") this.scrolls[this.activeTab].scrollBy(1);
    else if (key.name === "k" || key.name === "up") this.scrolls[this.activeTab].scrollBy(-1);
    else if (key.ctrl && key.name === "d") this.scrolls[this.activeTab].scrollBy(0.5, "viewport");
    else if (key.ctrl && key.name === "u") this.scrolls[this.activeTab].scrollBy(-0.5, "viewport");
    else if (key.name === "g") this.scrolls[this.activeTab].scrollTo(key.shift ? this.scrolls[this.activeTab].scrollHeight : 0);
    else if (key.name === "t") this.setTab("tests");
    else if (key.name === "v") this.setTab("solution");
    else if (key.name === "o") this.setTab("results");
    else if (key.name === "b") this.setTab("description");
    else if (key.name === "i") this.showImages();
    else if (key.name === "e") void this.edit(key.shift || this.activeTab === "tests");
    else if (key.name === "r" && key.shift) void this.perform("Reloading files…", async () => { await this.reloadFiles(); this.setNotice("Local files reloaded."); });
    else if (key.name === "r") void this.judge("run");
    else if (key.name === "s") void this.judge("submit");
    else if (key.name === "f") void this.addFailingTest();
    else if (key.name === "p") void this.restorePrevious();
    else if (/^[1-4]$/.test(key.name)) this.setTab(tabs[Number(key.name) - 1] || "description");
    else return;
    key.preventDefault();
  }

  close(): void {
    this.rememberView();
    this.dispose();
    this.renderer.destroy();
  }

  async finish(): Promise<void> {
    await this.activeTask;
    await this.viewState.flush();
  }

  private dispose(): void {
    this.lifetime.abort();
    this.listRequest?.abort();
    this.operation?.abort();
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.viewState.pause();
    this.renderer.off("frame", this.onFrame);
    this.renderer.keyInput.off("keypress", this.onKey);
  }
}

async function runTuiSession(renderer: CliRenderer, client: LeetCodeClient, paths: AppPaths, settings: Settings, slug?: string): Promise<void> {
  const app = new LeetCove(renderer, client, paths, settings);
  try {
    await app.initialize(slug);
    await new Promise<void>((resolve) => {
      if (renderer.isDestroyed) return resolve();
      renderer.once("destroy", resolve);
    });
  } finally {
    app.close();
    await app.finish();
  }
}

export async function startTui(client: LeetCodeClient, paths: AppPaths, settings: Settings, slug?: string): Promise<void> {
  const renderer = await createCliRenderer({ backgroundColor: colors.background, exitOnCtrlC: false, exitSignals: ["SIGINT", "SIGTERM", "SIGHUP"] });
  try {
    await runTuiSession(renderer, client, paths, settings, slug);
  } finally {
    renderer.destroy();
    await renderer.closed;
  }
}
