import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Bot, Check, ChevronDown, Eye, EyeOff, Loader2, Send, Sparkles } from "lucide-react";
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
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/toast";
import { testConnection, type AgentMessage, type AgentUsage } from "@/lib/agent";
import { runAgent } from "@/lib/agent-runner";
import { savePreferencesNow } from "@/lib/ui-preferences";
import {
	AGENT_PROVIDERS,
	agentStore,
	getProviderPreset,
	supportsTools,
	type AgentProvider,
} from "@/store";
import { cn } from "@/lib/utils";

const subscribeAgent = (onStoreChange: () => void) => agentStore.subscribe(onStoreChange);
const getAgentSnapshot = () => agentStore.getSnapshot();

/** 空状态时给的示例，点一下填进输入框 */
const SUGGESTIONS = [
	"做一页封面：标题「季度经营分析」，副标题写 2026 Q3，背景用浅灰渐变",
	"这一页太空了，加一张数据卡片：标题 + 三个关键指标",
	"把当前页所有文本改成深色、字号加大一号",
];

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
	const [showSettings, setShowSettings] = useState(!agentStore.isReady());
	const [showKey, setShowKey] = useState(false);
	/** 给模型的对话历史（不含 system，每轮重新拼） */
	const [conversation, setConversation] = useState<AgentMessage[]>([]);
	const [log, setLog] = useState<LogEntry[]>([]);
	const [draft, setDraft] = useState("");
	const [busy, setBusy] = useState(false);
	const [testing, setTesting] = useState(false);
	const [usage, setUsage] = useState<AgentUsage | null>(null);
	const listRef = useRef<HTMLDivElement | null>(null);
	const nextId = useRef(0);

	const preset = getProviderPreset(settings.provider);
	const ready = agentStore.isReady();
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
		}
	};

	const handleSend = async () => {
		const text = draft.trim();
		if (!text || busy) {
			return;
		}
		setDraft("");
		pushLog({ kind: "user", text });
		setBusy(true);
		try {
			const { messages } = await runAgent(text, conversation, {
				onStep: (step) => {
					if (step.kind === "assistant") {
						pushLog({ kind: "assistant", text: step.text });
					} else if (step.kind === "tool") {
						pushLog({ kind: "tool", text: step.text });
					} else if (step.kind === "render") {
						pushLog({ kind: "image", imageUrl: step.imageUrl, text: step.text });
					} else if (step.kind === "usage") {
						setUsage(step.usage);
					}
				},
			});
			setConversation(messages);
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
						<button
							type="button"
							onClick={() => setShowSettings((value) => !value)}
							className="flex w-full items-center justify-between rounded-lg border border-border/70 bg-background px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/60"
						>
							<span className="flex items-center gap-1.5">
								<span className="font-medium text-foreground">{preset.label}</span>
								<span className="truncate">{settings.model || "未选择模型"}</span>
								{ready && <Check className="size-3 text-primary" aria-label="已配置" />}
							</span>
							<ChevronDown
								className={cn("size-3 transition-transform", showSettings && "rotate-180")}
							/>
						</button>

						{showSettings && (
							<div className="mt-2 flex flex-col gap-2 rounded-lg border border-border/70 bg-background p-2.5">
								<div className="flex flex-col gap-1">
									<span className="text-xs text-muted-foreground">服务商</span>
									<div className="grid grid-cols-3 gap-1">
										{AGENT_PROVIDERS.map((item) => (
											<Button
												key={item.value}
												type="button"
												size="xs"
												variant={settings.provider === item.value ? "secondary" : "ghost"}
												onClick={() => {
													agentStore.setProvider(item.value as AgentProvider);
													persist();
												}}
												className={cn(
													"justify-center",
													settings.provider === item.value && "text-primary",
												)}
											>
												{item.label.split("（")[0]}
											</Button>
										))}
									</div>
								</div>

								<label className="flex flex-col gap-1">
									<span className="text-xs text-muted-foreground">接口地址</span>
									<Input
										value={settings.baseUrl}
										placeholder="https://api.deepseek.com/v1"
										className="h-7 text-xs"
										onChange={(event) => agentStore.setBaseUrl(event.target.value)}
										onBlur={persist}
									/>
								</label>

								<div className="flex flex-col gap-1">
									<span className="text-xs text-muted-foreground">模型</span>
									{preset.models.length > 0 ? (
										<div className="flex flex-wrap gap-1">
											{preset.models.map((model) => {
												const blocked = (preset.noTools ?? []).includes(model);
												return (
													<Button
														key={model}
														type="button"
														size="xs"
														variant={settings.model === model ? "secondary" : "ghost"}
														onClick={() => {
															agentStore.setModel(model);
															persist();
														}}
														className={cn(
															"justify-center",
															settings.model === model && "text-primary",
														)}
														title={blocked ? "该模型不支持工具调用，只能聊天" : undefined}
													>
														{model}
														{blocked && <span className="text-muted-foreground">·无工具</span>}
													</Button>
												);
											})}
										</div>
									) : (
										<Input
											value={settings.model}
											placeholder="例如 llama3.1 / gpt-4o-mini"
											className="h-7 text-xs"
											onChange={(event) => agentStore.setModel(event.target.value)}
											onBlur={persist}
										/>
									)}
								</div>

								<label className="flex flex-col gap-1">
									<span className="text-xs text-muted-foreground">API Key</span>
									<div className="flex items-center gap-1">
										<Input
											type={showKey ? "text" : "password"}
											value={settings.apiKey}
											placeholder="sk-…"
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
									{preset.note ?? "Key 只保存在本机，不会写进报告文件"}
								</p>

								<Button
									type="button"
									size="sm"
									variant="outline"
									disabled={!ready || testing}
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
							<div className="flex flex-col gap-2">
								<div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-border px-4 py-6 text-center">
									<Sparkles className="size-5 text-muted-foreground/70" />
									<p className="text-xs font-medium text-foreground">试试这样说</p>
									<p className="text-xs leading-relaxed text-muted-foreground">
										它会直接改画布，每做一步都会列在这里
									</p>
								</div>
								{SUGGESTIONS.map((text) => (
									<button
										key={text}
										type="button"
										onClick={() => setDraft(text)}
										className="rounded-lg border border-border/70 px-2.5 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
									>
										{text}
									</button>
								))}
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
								disabled={!ready || busy || !draft.trim()}
								aria-label="发送"
								onClick={() => void handleSend()}
								className="shrink-0"
							>
								<Send className="size-4" />
							</Button>
						</div>
						{log.length > 0 && (
							<Button
								type="button"
								variant="ghost"
								size="xs"
								onClick={() => {
									setLog([]);
									setConversation([]);
									setUsage(null);
								}}
								className="mt-1 text-muted-foreground hover:text-foreground"
							>
								清空对话
							</Button>
						)}
					</div>
				</div>
			</DrawerContent>
		</Drawer>
	);
}
