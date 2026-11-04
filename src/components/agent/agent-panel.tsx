import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Bot, Check, Eye, EyeOff, Loader2, Send, Settings2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerTitle,
	DrawerTrigger,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/toast";
import { testConnection, type AgentUsage } from "@/lib/agent/llm";
import {
	buildHandover,
	createConversation,
	DEFAULT_TOKEN_BUDGET,
	estimateTokens,
	loadConversation,
	saveConversation,
	trimMessages,
	type AgentChatMessage,
	type AgentConversation,
} from "@/lib/agent/conversation";
import { runAgent } from "@/lib/agent/runner";
import { getDocumentSummary } from "@/lib/report/commands";
import { getCurrentReportRelativeDir, getCurrentReportRoot } from "@/lib/report/service";
import { savePreferencesNow } from "@/lib/ui-preferences";
import {
	AGENT_PROVIDERS,
	agentStore,
	getProviderPreset,
	providerRequiresKey,
	reportStore,
	supportsTools,
	type AgentProvider,
} from "@/store";
import { cn } from "@/lib/utils";

const subscribeAgent = (onStoreChange: () => void) => agentStore.subscribe(onStoreChange);
const getAgentSnapshot = () => agentStore.getSnapshot();

/** 帮助面板里的示例提示词：点一下填进输入框 */
const HELP_EXAMPLES = [
	"做一页封面：标题「2026 年第三季度经营分析」，副标题写日期，右下角放一句结论",
	"给当前页加三张数据卡片，每张一个指标名和一个数字",
	"把当前页的标题字号调大一号，整体内容往下移 40",
];

/** 能力边界：写给用户看，避免期待错 */
const HELP_CAPABILITIES = {
	can: ["加页、切页", "批量加元素（矩形 / 文本 / 形状 / 线条）", "改元素属性（位置、尺寸、颜色、字号）", "渲染当前页看效果"],
	cannot: ["插入图片（先用矩形占位，之后自己换图）", "改矩形以外的富文本（分段加粗/变色）", "表格与数据绑定", "保存、导出（这些由你点按钮，AI 不碰文件）"],
};

/** 对话区的一条记录 */
interface LogEntry {
	id: number;
	kind: "user" | "assistant" | "tool" | "image";
	text?: string;
	imageUrl?: string;
}

/**
 * AI 助手面板。
 *
 * 「发送」走的是 `runAgent`：模型可以连续调工具（加页/加元素/改属性/渲染），
 * 每一步都会在对话区留一条记录 —— 用户能看见它一步一步在做什么。
 *
 * 工具执行期间画布是锁着的（`withAgentCanvasLock`），避免整页重载打断用户操作。
 */
export function AgentPanel() {
	const settings = useSyncExternalStore(subscribeAgent, getAgentSnapshot);
	const [open, setOpen] = useState(false);
	// 默认只进去对话；缺 Key 时在抽屉打开的那一刻再摊开设置
	const [showSettings, setShowSettings] = useState(false);
	const [showKey, setShowKey] = useState(false);
	const [helpOpen, setHelpOpen] = useState(false);
	const [log, setLog] = useState<LogEntry[]>([]);
	const [draft, setDraft] = useState("");
	const [busy, setBusy] = useState(false);
	const [testing, setTesting] = useState(false);
	const [usage, setUsage] = useState<AgentUsage | null>(null);
	/** 这个报告的会话（一个报告一个会话文件） */
	const [session, setSession] = useState<AgentConversation | null>(null);
	const listRef = useRef<HTMLDivElement | null>(null);
	const nextId = useRef(0);
	/**
	 * 同步的"正在跑"标记。
	 * `busy` / `testing` 是 React 状态，要等下一次渲染才反映到按钮的 disabled 上，
	 * 连点两下就会发两次请求 —— 用 ref 才能在同一帧内挡住。
	 */
	const inFlightRef = useRef(false);

	/** 当前报告目录（读写会话文件用） */
	const resolveReportDir = async (): Promise<{ root: string; folder: string } | null> => {
		try {
			const root = await getCurrentReportRoot();
			const folder = await getCurrentReportRelativeDir();
			return { root, folder };
		} catch {
			return null;
		}
	};

	// 打开面板时把这个报告的会话读回来：一个报告只有一个会话
	useEffect(() => {
		if (!open) {
			return;
		}
		let cancelled = false;
		void (async () => {
			const dir = await resolveReportDir();
			const reportId = reportStore.state.reportId;
			const loaded = dir ? await loadConversation(dir.root, dir.folder) : null;
			if (cancelled) {
				return;
			}
			const data = loaded ?? createConversation(reportId);
			setSession(data);
			setUsage(data.usage);
			setLog(
				data.messages.map((message, index) => ({
					id: index,
					kind: message.role === "user" ? "user" : "assistant",
					text: message.content,
				})),
			);
		})();
		return () => {
			cancelled = true;
		};
	}, [open]);

	// 偏好文件是异步读的：挂载那一刻 Key 还是空的，不能在 useState 里算死。
	// 每次打开抽屉时按当前配置决定设置面板要不要摊开。
	useEffect(() => {
		if (!open) {
			return;
		}
		setShowSettings(agentStore.needsApiKey());
	}, [open]);

	const preset = getProviderPreset(settings.provider);
	const ready = agentStore.isReady();
	/** 当前服务商自己的 Key（不跟别的服务商混用） */
	const apiKey = settings.apiKeys[settings.provider] ?? "";
	const toolsOk = supportsTools(settings);

	const pushLog = (entry: Omit<LogEntry, "id">) => {
		nextId.current += 1;
		setLog((prev) => [...prev, { ...entry, id: nextId.current }]);
	};

	useEffect(() => {
		const list = listRef.current;
		if (list) {
			list.scrollTop = list.scrollHeight;
		}
	}, [log, busy]);

	const persist = () => {
		void savePreferencesNow();
	};

	const handleTest = async () => {
		if (inFlightRef.current) {
			return;
		}
		inFlightRef.current = true;
		setTesting(true);
		try {
			const reply = await testConnection();
			toast.add({
				title: "连接成功",
				description: `${settings.model} 回复：${reply.slice(0, 60)}`,
				type: "success",
			});
		} catch (error) {
			toast.add({
				title: "连接失败",
				description: error instanceof Error ? error.message : String(error),
				type: "error",
			});
		} finally {
			setTesting(false);
			inFlightRef.current = false;
		}
	};

	const handleSend = async () => {
		const text = draft.trim();
		if (!text || busy || inFlightRef.current) {
			return;
		}
		// 没配 Key 就明确提示，并把设置摊开 —— 而不是静默失败
		if (agentStore.needsApiKey()) {
			setShowSettings(true);
			toast.add({
				title: `请设置 ${preset.label} 的 API Key`,
				description: "点右上角齿轮，在「API Key」里填当前服务商的 Key",
				type: "warning",
			});
			return;
		}
		setDraft("");
		pushLog({ kind: "user", text });
		setBusy(true);

		// 预算：先裁剪再交接。裁剪够用就不换会话
		let base = session ?? createConversation(reportStore.state.reportId);
		let history: AgentChatMessage[] = base.messages;
		if (estimateTokens(history) > DEFAULT_TOKEN_BUDGET) {
			history = trimMessages(history);
			pushLog({ kind: "tool", text: "上下文过长，已裁剪较早的对话" });
		}

		const actions: { at: number; text: string }[] = [];
		try {
			const { messages } = await runAgent(
				text,
				history.map((message) => ({ role: message.role, content: message.content })),
				{
					onStep: (step) => {
						if (step.kind === "assistant") {
							pushLog({ kind: "assistant", text: step.text });
						} else if (step.kind === "tool") {
							pushLog({ kind: "tool", text: step.text });
							actions.push({ at: Date.now(), text: step.text });
						} else if (step.kind === "render") {
							pushLog({ kind: "image", imageUrl: step.imageUrl, text: step.text });
						} else if (step.kind === "usage") {
							setUsage((prev) => ({
								promptTokens: (prev?.promptTokens ?? 0) + step.usage.promptTokens,
								completionTokens: (prev?.completionTokens ?? 0) + step.usage.completionTokens,
								totalTokens: (prev?.totalTokens ?? 0) + step.usage.totalTokens,
							}));
						}
					},
				},
			);

			// 落盘：只存自然语言消息和动作摘要，不存工具原始结果
			const nextSession: AgentConversation = {
				...base,
				reportId: reportStore.state.reportId || base.reportId,
				updatedAt: Date.now(),
				usage: {
					promptTokens: (base.usage.promptTokens ?? 0) + (usage?.promptTokens ?? 0),
					completionTokens: (base.usage.completionTokens ?? 0) + (usage?.completionTokens ?? 0),
					totalTokens: (base.usage.totalTokens ?? 0) + (usage?.totalTokens ?? 0),
				},
				messages: messages
					.filter((message) => message.role === "user" || message.role === "assistant")
					.map((message) => ({ role: message.role as "user" | "assistant", content: message.content })),
				actions: [...base.actions, ...actions].slice(-200),
			};
			setSession(nextSession);
			const dir = await resolveReportDir();
			if (dir) {
				await saveConversation(dir.root, dir.folder, nextSession).catch(() => {
					// 会话存不下来不该影响编辑，静默失败
				});
			}
		} catch (error) {
			pushLog({
				kind: "tool",
				text: `调用失败：${error instanceof Error ? error.message : String(error)}`,
			});
			toast.add({
				title: "调用失败",
				description: error instanceof Error ? error.message : String(error),
				type: "error",
			});
		} finally {
			setBusy(false);
			inFlightRef.current = false;
		}
	};

	/**
	 * 重开会话：把当前会话归档，用**程序拼的交接摘要**开一段新会话。
	 * 摘要不是模型写的 —— 模型写要额外跑一轮，还容易漏掉实际做过的事。
	 */
	const handleRestart = async () => {
		const base = session ?? createConversation(reportStore.state.reportId);
		if (base.messages.length === 0) {
			return;
		}
		const handover = buildHandover(base, getDocumentSummary());
		const next: AgentConversation = {
			...createConversation(base.reportId),
			sessionIndex: base.sessionIndex + 1,
			messages: [{ role: "user", content: handover }],
			usage: base.usage,
			archives: [...base.archives, { at: Date.now(), handover }],
		};
		setSession(next);
		setLog([
			{ id: 0, kind: "tool", text: `—— 上一段会话已归档（第 ${base.sessionIndex} 段）——` },
			{ id: 1, kind: "assistant", text: handover },
		]);
		const dir = await resolveReportDir();
		if (dir) {
			await saveConversation(dir.root, dir.folder, next).catch(() => {});
		}
	};

	return (
		<Drawer swipeDirection="right" open={open} onOpenChange={setOpen}>
			<DrawerTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="gap-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
					/>
				}
			>
				<Sparkles className="size-4" />
				AI 助手
			</DrawerTrigger>

			<DrawerContent>
				<DrawerHeader>
					<DrawerTitle className="flex items-center gap-2">
						<Bot className="size-4" />
						AI 助手
					</DrawerTitle>
					<DrawerDescription>说一句话，它会直接往画布上摆东西</DrawerDescription>
				</DrawerHeader>

				<div className="flex min-h-0 flex-1 flex-col">
					{/* ── 模型设置 ───────────────────────────── */}
					<div className="shrink-0 px-4">
						{/* 模型：下拉列表，按服务商分组；选哪一项就同时切服务商 + 模型 */}
						<div className="flex items-center gap-1.5">
							<select
								aria-label="选择模型"
								value={settings.provider === "custom" ? "custom:" : `${settings.provider}:${settings.model}`}
								onChange={(event) => {
									const [provider, model] = event.target.value.split(":");
									agentStore.setProvider(provider as AgentProvider);
									if (model) {
										agentStore.setModel(model);
									}
									persist();
								}}
								className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus-visible:border-primary/60"
							>
								{AGENT_PROVIDERS.map((item) => (
									<optgroup key={item.value} label={item.label}>
										{item.models.length > 0 ? (
											item.models.map((model) => (
												<option key={model} value={`${item.value}:${model}`}>
													{model}
													{(item.noTools ?? []).includes(model) ? "（不支持工具）" : ""}
												</option>
											))
										) : (
											<option value="custom:">自定义模型…</option>
										)}
									</optgroup>
								))}
							</select>

							<Button
								type="button"
								variant={showSettings ? "secondary" : "ghost"}
								size="icon-sm"
								aria-label="模型设置"
								title="设置接口地址、API Key"
								onClick={() => setShowSettings((value) => !value)}
								className="shrink-0 text-muted-foreground"
							>
								<Settings2 className="size-3.5" />
							</Button>
							{ready && <Check className="size-3 shrink-0 text-primary" aria-label="已配置" />}
						</div>

						{showSettings && (
							<div className="mt-2 flex flex-col gap-2 rounded-lg border border-border/70 bg-background p-2.5">
								<div className="flex flex-col gap-1">
									<span className="text-xs text-muted-foreground">
										{preset.label} · 模型设置
									</span>
								</div>

								<label className="flex flex-col gap-1">
									<span className="text-xs text-muted-foreground">接口地址</span>
									<Input
										value={settings.baseUrl}
										placeholder="https://api.deepseek.com"
										className="h-7 text-xs"
										onChange={(event) => agentStore.setBaseUrl(event.target.value)}
										onBlur={persist}
									/>
								</label>

								<label className="flex flex-col gap-1">
									<span className="text-xs text-muted-foreground">模型名</span>
									<Input
										value={settings.model}
										placeholder="deepseek-chat"
										className="h-7 text-xs"
										onChange={(event) => agentStore.setModel(event.target.value)}
										onBlur={persist}
									/>
								</label>

								<label className="flex flex-col gap-1">
									<span className="text-xs text-muted-foreground">API Key</span>
									<div className="flex items-center gap-1">
										<Input
											type={showKey ? "text" : "password"}
											value={apiKey}
											placeholder={
												providerRequiresKey(settings.provider, settings.baseUrl)
													? "sk-…"
													: "本地模型可留空"
											}
											className="h-7 text-xs"
											onChange={(event) => agentStore.setApiKey(event.target.value)}
											onBlur={persist}
										/>
										<Button
											type="button"
											variant="ghost"
											size="icon-sm"
											aria-label={showKey ? "隐藏 Key" : "显示 Key"}
											onClick={() => setShowKey((value) => !value)}
											className="shrink-0 text-muted-foreground"
										>
											{showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
										</Button>
									</div>
								</label>

								<p className="text-xs leading-relaxed text-muted-foreground">
									{apiKey
										? `当前：${preset.label} · Key 已设置（长度 ${apiKey.length}）`
										: providerRequiresKey(settings.provider, settings.baseUrl)
											? `当前：${preset.label} · Key 未设置，必须先填才能发送`
											: `当前：${preset.label} · 本机地址，可以不填 Key`}
								</p>

								<p className="text-xs leading-relaxed text-muted-foreground">
									{preset.note ?? "Key 只保存在本机，不会写进报告文件"}
								</p>

								<Button
									type="button"
									size="sm"
									variant="outline"
									disabled={testing || !settings.baseUrl.trim() || !settings.model.trim()}
									onClick={() => void handleTest()}
									className="w-full justify-center"
								>
									{testing && <Loader2 className="size-3.5 animate-spin" />}
									{testing ? "测试中…" : "测试连接"}
								</Button>
							</div>
						)}
					</div>

					<Separator className="my-3" />

					{/* ── 操作记录 ─────────────────────────── */}
					<div ref={listRef} className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4">
						{log.length === 0 ? (
							<div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-border px-4 py-6 text-center">
								<Sparkles className="size-5 text-muted-foreground/70" />
								<p className="text-xs font-medium text-foreground">说一句话，它就动手改画布</p>
								<p className="text-xs leading-relaxed text-muted-foreground">
									每做一步都会列在这里；点下面的「示例提示词」看能怎么说
								</p>
								<Button
									type="button"
									size="xs"
									variant="outline"
									onClick={() => setHelpOpen(true)}
									className="mt-1"
								>
									示例提示词
								</Button>
							</div>
						) : (
							<div className="flex flex-col gap-2.5">
								{log.map((entry) => {
									if (entry.kind === "user") {
										return (
											<div key={entry.id} className="flex flex-col items-end gap-0.5">
												<span className="text-xs text-muted-foreground">我</span>
												<div className="max-w-full whitespace-pre-wrap break-words rounded-lg bg-primary/10 px-2.5 py-1.5 text-xs leading-relaxed text-foreground">
													{entry.text}
												</div>
											</div>
										);
									}
									if (entry.kind === "assistant") {
										return (
											<div key={entry.id} className="flex flex-col items-start gap-0.5">
												<span className="text-xs text-muted-foreground">助手</span>
												<div className="max-w-full whitespace-pre-wrap break-words rounded-lg border border-border/70 bg-background px-2.5 py-1.5 text-xs leading-relaxed text-foreground">
													{entry.text}
												</div>
											</div>
										);
									}
									if (entry.kind === "image") {
										return (
											<div key={entry.id} className="flex flex-col gap-1">
												<span className="text-xs text-muted-foreground">{entry.text}</span>
												<img
													src={entry.imageUrl}
													alt="页面渲染结果"
													className="w-full rounded-lg border border-border/70"
												/>
											</div>
										);
									}
									return (
										<div
											key={entry.id}
											className="flex items-center gap-1.5 text-xs text-muted-foreground"
										>
											<span aria-hidden="true" className="size-1 rounded-full bg-primary/60" />
											{entry.text}
										</div>
									);
								})}
								{busy && (
									<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
										<Loader2 className="size-3 animate-spin" />
										执行中…
									</div>
								)}
							</div>
						)}
					</div>

					{usage && (
						<p className="shrink-0 px-4 pb-1 text-xs tabular-nums text-muted-foreground">
							累计：{usage.promptTokens} + {usage.completionTokens} = {usage.totalTokens} tokens
						</p>
					)}

					{!toolsOk && (
						<p className="shrink-0 px-4 pb-1 text-xs text-muted-foreground">
							当前模型不支持工具调用，只能对话
						</p>
					)}

					{/* ── 输入 ──────────────────────────────── */}
					<div className="shrink-0 border-t border-border p-3">
						<div className="mb-2 flex items-center gap-1">
							<span className="text-xs text-muted-foreground">模式</span>
							<Button type="button" size="xs" variant="secondary" disabled>
								逐条操作
							</Button>
							<Button
								type="button"
								size="xs"
								variant="ghost"
								disabled
								title="让模型直接产出整份文档，暂未开放"
							>
								整页重做
							</Button>
						</div>
						<div className="mb-2 flex items-center gap-1.5">
							<Button
								type="button"
								size="xs"
								variant={settings.generateImages ? "secondary" : "ghost"}
								onClick={() => {
									agentStore.setGenerateImages(!settings.generateImages);
									persist();
								}}
								title={
									settings.generateImages
										? "允许模型创建图片元素（只知道文档里已有的图，猜路径会失败）"
										: "不生成图片：需要放图的位置用矩形占位，图片由你自己填 —— 更省 token，也不用模型猜媒体路径"
								}
								className={cn(
									"justify-center",
									settings.generateImages && "text-primary",
								)}
							>
								{settings.generateImages ? "生成图片：开" : "生成图片：关"}
							</Button>
							<span className="text-xs leading-tight text-muted-foreground">
								{settings.generateImages ? "会创建图片元素" : "图片位置用矩形占位，你自己填"}
							</span>
						</div>
						<div className="flex items-end gap-1.5">
							<textarea
								value={draft}
								rows={2}
								placeholder={ready ? "说说要改什么，Enter 发送" : "先在上面填好模型和 API Key"}
								onChange={(event) => setDraft(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter" && !event.shiftKey) {
										event.preventDefault();
										void handleSend();
									}
								}}
								className="thin-scrollbar min-h-[52px] w-full resize-none rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary/60"
							/>
							<Button
								type="button"
								size="icon"
								disabled={busy || !draft.trim()}
								aria-label="发送"
								onClick={() => void handleSend()}
								className="shrink-0"
							>
								<Send className="size-4" />
							</Button>
						</div>
						{log.length > 0 && (
							<div className="mt-1 flex items-center gap-1">
								<Button
									type="button"
									variant="ghost"
									size="xs"
									disabled={busy}
									onClick={() => void handleRestart()}
									title="把当前会话归档，用交接摘要开一段新会话（上下文太长时用）"
									className="text-muted-foreground hover:text-foreground"
								>
									重开会话
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="xs"
									onClick={() => {
										setLog([]);
										setUsage(null);
									}}
									className="text-muted-foreground hover:text-foreground"
								>
									清空显示
								</Button>
								{session && (
									<span className="ml-auto text-xs text-muted-foreground">
										第 {session.sessionIndex} 段 · {session.messages.length} 条 · ~
										{estimateTokens(session.messages)} tokens
									</span>
								)}
							</div>
						)}
					</div>
				</div>
			</DrawerContent>

			{/* 示例提示词与能力边界：不占对话框的位置，点按钮才出现 */}
			<Dialog open={helpOpen} onOpenChange={setHelpOpen}>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle>能这样使唤它</DialogTitle>
						<DialogDescription>点一条就填进输入框，改成你要的数字再发</DialogDescription>
					</DialogHeader>

					<div className="flex flex-col gap-2">
						{HELP_EXAMPLES.map((text) => (
							<button
								key={text}
								type="button"
								onClick={() => {
									setDraft(text);
									setHelpOpen(false);
								}}
								className="rounded-lg border border-border/70 px-2.5 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
							>
								{text}
							</button>
						))}
					</div>

					<div className="grid grid-cols-2 gap-2 text-xs">
						<div className="flex flex-col gap-1">
							<span className="font-medium text-foreground">现在能做</span>
							{HELP_CAPABILITIES.can.map((item) => (
								<span key={item} className="text-muted-foreground">
									· {item}
								</span>
							))}
						</div>
						<div className="flex flex-col gap-1">
							<span className="font-medium text-foreground">还做不了</span>
							{HELP_CAPABILITIES.cannot.map((item) => (
								<span key={item} className="text-muted-foreground">
									· {item}
								</span>
							))}
						</div>
					</div>
				</DialogContent>
			</Dialog>
		</Drawer>
	);
}
